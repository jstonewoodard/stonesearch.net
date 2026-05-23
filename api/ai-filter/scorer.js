/* ============================================================
   Stone Search — AI Content Filter: pure scoring math
   ------------------------------------------------------------
   No I/O, no side effects. Given detector outputs, returns the
   final page score, the verdict tier, and a full breakdown for
   audit / UI tooltips. Easy to unit-test.

   See Stone_Search_AI_Filter_Spec.docx section 4 for the math.
   ============================================================ */

'use strict';

// Verdict thresholds — single source of truth.
// Per spec section 4.7:
//   page_score > 25          -> BLOCK
//   10 <= score <= 25        -> WARN_HIGH
//   0  <  score <  10        -> WARN_LOW
//   score == 0               -> CLEAN
const THRESHOLDS = Object.freeze({
  BLOCK: 25,
  WARN_HIGH: 10,
  WARN_LOW: 0,
});

// Calibration constants (spec section 4.4 / 4.6).
const CHARS_PER_IMAGE = 500;     // image weight in chars-equivalent
const W_TEXT_MIN = 0.30;
const W_TEXT_MAX = 0.85;
const STRONG_SIGNAL_THRESHOLD = 90;
const STRONG_SIGNAL_FLOOR = 80;

// Image aggregation: per-image weight is clamped pixel area.
const IMAGE_AREA_MIN = 10_000;       // 100x100
const IMAGE_AREA_MAX = 2_000_000;    // 1414x1414
const IMAGE_MEAN_WEIGHT = 0.7;
const IMAGE_MAX_WEIGHT  = 0.3;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Apply C2PA provenance overrides to a raw image score.
 * spec section 4.2
 */
function applyProvenance(rawScore, c2pa) {
  if (!c2pa) return rawScore;
  if (c2pa.generative_ai_origin) return Math.max(rawScore, 90);
  if (c2pa.camera_capture_chain) return Math.min(rawScore, 30);
  return rawScore;
}

/**
 * Aggregate a list of per-image detector results into a single
 * image-modality score for the page.
 *
 * Each item:
 *   { ai_score: number 0-100, confidence: number 0-1,
 *     area_px: number, c2pa?: {generative_ai_origin?, camera_capture_chain?} }
 */
function aggregateImages(images) {
  if (!images || images.length === 0) {
    return { score: 0, confidence: 0, count: 0, max_effective: 0 };
  }

  let weightSum = 0;
  let weightedScoreSum = 0;
  let confidenceSum = 0;
  let maxEffective = 0;

  for (const img of images) {
    const effective = applyProvenance(img.ai_score, img.c2pa);
    const w = clamp(img.area_px || 0, IMAGE_AREA_MIN, IMAGE_AREA_MAX);
    weightSum += w;
    weightedScoreSum += effective * w;
    confidenceSum += (img.confidence ?? 0.5);
    maxEffective = Math.max(maxEffective, effective);
  }

  const meanImg = weightSum > 0 ? weightedScoreSum / weightSum : 0;
  const score = IMAGE_MEAN_WEIGHT * meanImg + IMAGE_MAX_WEIGHT * maxEffective;
  const confidence = confidenceSum / images.length;

  return { score, confidence, count: images.length, max_effective: maxEffective };
}

/**
 * Compute modality weights from content volume.
 * spec section 4.4
 */
function computeWeights({ text_chars, n_images }) {
  if (n_images === 0 && text_chars > 0) return { text: 1, image: 0 };
  if (text_chars === 0 && n_images > 0) return { text: 0, image: 1 };
  if (text_chars === 0 && n_images === 0) return { text: 0, image: 0 };

  const w_text = clamp(
    text_chars / (text_chars + CHARS_PER_IMAGE * n_images),
    W_TEXT_MIN,
    W_TEXT_MAX
  );
  return { text: w_text, image: 1 - w_text };
}

/** Confidence dampening (spec section 4.5). */
function dampen(score, confidence) {
  return score * (0.5 + 0.5 * clamp(confidence ?? 0, 0, 1));
}

/** Map a numeric page score to a verdict tier (spec section 4.7). */
function verdictFor(pageScore) {
  if (pageScore > THRESHOLDS.BLOCK)     return 'BLOCK';
  if (pageScore >= THRESHOLDS.WARN_HIGH) return 'WARN_HIGH';
  if (pageScore >  THRESHOLDS.WARN_LOW)  return 'WARN_LOW';
  return 'CLEAN';
}

/**
 * Main entrypoint.
 *
 * Inputs:
 *   text:   { score: 0-100, confidence: 0-1, chars: number, backend: string } | null
 *   images: array<image> | null     // see aggregateImages for shape
 *
 * Returns a full audit envelope. See spec section 5.1 for the response shape.
 */
function scorePage({ text, images } = {}) {
  const textScoreRaw  = text?.score ?? 0;
  const textConf      = text?.confidence ?? 0;
  const textChars     = text?.chars ?? 0;
  const imageAgg      = aggregateImages(images || []);

  const weights = computeWeights({ text_chars: textChars, n_images: imageAgg.count });

  const textEff  = dampen(textScoreRaw,  textConf);
  const imageEff = dampen(imageAgg.score, imageAgg.confidence);

  const base = weights.text * textEff + weights.image * imageEff;

  const hardMax = Math.max(textEff, imageAgg.max_effective);
  let pageScore = base;
  let override = null;
  if (hardMax >= STRONG_SIGNAL_THRESHOLD) {
    pageScore = Math.max(base, STRONG_SIGNAL_FLOOR);
    if (pageScore > base) override = 'STRONG_SIGNAL_FLOOR';
  }

  // Clamp for safety and round to one decimal.
  pageScore = Math.round(clamp(pageScore, 0, 100) * 10) / 10;

  return {
    aiScore: pageScore,
    verdict: verdictFor(pageScore),
    modality: {
      text: text ? {
        score: round1(textScoreRaw),
        score_effective: round1(textEff),
        confidence: round2(textConf),
        chars: textChars,
        backend: text.backend || null,
      } : null,
      image: imageAgg.count > 0 ? {
        score: round1(imageAgg.score),
        score_effective: round1(imageEff),
        confidence: round2(imageAgg.confidence),
        count: imageAgg.count,
        max_effective: round1(imageAgg.max_effective),
      } : null,
    },
    weights: { text: round2(weights.text), image: round2(weights.image) },
    override,
    base_score: round1(base),
    thresholds: THRESHOLDS,
  };
}

function round1(x) { return Math.round(x * 10) / 10; }
function round2(x) { return Math.round(x * 100) / 100; }

module.exports = {
  scorePage,
  verdictFor,
  aggregateImages,
  computeWeights,
  applyProvenance,
  dampen,
  THRESHOLDS,
  // Constants exported for tuning / tests:
  CHARS_PER_IMAGE,
  W_TEXT_MIN,
  W_TEXT_MAX,
  STRONG_SIGNAL_THRESHOLD,
  STRONG_SIGNAL_FLOOR,
};
