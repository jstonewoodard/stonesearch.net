/* ============================================================
   Stone Search — AI Content Filter: pure scoring math (ESM)
   ------------------------------------------------------------
   ESM port of api/ai-filter/scorer.js. Pure functions only,
   runs identically in Node, Cloudflare Pages Functions, and
   Cloudflare Workers.

   IMPORTANT: keep this file in sync with api/ai-filter/scorer.js.
   The math is duplicated only because the two runtimes need
   different module systems. All constants and formulas must
   match exactly so dev (local Node) and prod (Pages Function)
   produce identical scores for identical inputs.

   See docs/Stone_Search_AI_Filter_Spec.docx section 4.
   ============================================================ */

// Verdict thresholds (spec §4.7):
//   page_score > 25          -> BLOCK
//   10 <= score <= 25        -> WARN_HIGH
//   0  <  score <  10        -> WARN_LOW
//   score == 0               -> CLEAN
export const THRESHOLDS = Object.freeze({
  BLOCK: 25,
  WARN_HIGH: 10,
  WARN_LOW: 0,
});

// Calibration constants (spec §4.4 / §4.6).
export const CHARS_PER_IMAGE = 500;
export const W_TEXT_MIN = 0.30;
export const W_TEXT_MAX = 0.85;
export const STRONG_SIGNAL_THRESHOLD = 90;
export const STRONG_SIGNAL_FLOOR = 80;

const IMAGE_AREA_MIN = 10_000;
const IMAGE_AREA_MAX = 2_000_000;
const IMAGE_MEAN_WEIGHT = 0.7;
const IMAGE_MAX_WEIGHT  = 0.3;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function applyProvenance(rawScore, c2pa) {
  if (!c2pa) return rawScore;
  if (c2pa.generative_ai_origin) return Math.max(rawScore, 90);
  if (c2pa.camera_capture_chain) return Math.min(rawScore, 30);
  return rawScore;
}

export function aggregateImages(images) {
  if (!images || images.length === 0) {
    return { score: 0, confidence: 0, count: 0, max_effective: 0 };
  }
  let weightSum = 0, weightedScoreSum = 0, confidenceSum = 0, maxEffective = 0;
  for (const img of images) {
    const effective = applyProvenance(img.ai_score, img.c2pa);
    const w = clamp(img.area_px || 0, IMAGE_AREA_MIN, IMAGE_AREA_MAX);
    weightSum += w;
    weightedScoreSum += effective * w;
    confidenceSum += (img.confidence ?? 0.5);
    if (effective > maxEffective) maxEffective = effective;
  }
  const meanImg = weightSum > 0 ? weightedScoreSum / weightSum : 0;
  const score = IMAGE_MEAN_WEIGHT * meanImg + IMAGE_MAX_WEIGHT * maxEffective;
  const confidence = confidenceSum / images.length;
  return { score, confidence, count: images.length, max_effective: maxEffective };
}

export function computeWeights({ text_chars, n_images }) {
  if (n_images === 0 && text_chars > 0) return { text: 1, image: 0 };
  if (text_chars === 0 && n_images > 0) return { text: 0, image: 1 };
  if (text_chars === 0 && n_images === 0) return { text: 0, image: 0 };
  const w_text = clamp(
    text_chars / (text_chars + CHARS_PER_IMAGE * n_images),
    W_TEXT_MIN, W_TEXT_MAX
  );
  return { text: w_text, image: 1 - w_text };
}

export function dampen(score, confidence) {
  return score * (0.5 + 0.5 * clamp(confidence ?? 0, 0, 1));
}

export function verdictFor(pageScore) {
  if (pageScore > THRESHOLDS.BLOCK) return 'BLOCK';
  if (pageScore >= THRESHOLDS.WARN_HIGH) return 'WARN_HIGH';
  if (pageScore > THRESHOLDS.WARN_LOW) return 'WARN_LOW';
  return 'CLEAN';
}

export function scorePage({ text, images } = {}) {
  const textScoreRaw = text?.score ?? 0;
  const textConf     = text?.confidence ?? 0;
  const textChars    = text?.chars ?? 0;
  const imageAgg     = aggregateImages(images || []);

  const weights = computeWeights({ text_chars: textChars, n_images: imageAgg.count });
  const textEff  = dampen(textScoreRaw, textConf);
  const imageEff = dampen(imageAgg.score, imageAgg.confidence);
  const base = weights.text * textEff + weights.image * imageEff;

  const hardMax = Math.max(textEff, imageAgg.max_effective);
  let pageScore = base;
  let override = null;
  if (hardMax >= STRONG_SIGNAL_THRESHOLD) {
    pageScore = Math.max(base, STRONG_SIGNAL_FLOOR);
    if (pageScore > base) override = 'STRONG_SIGNAL_FLOOR';
  }
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
