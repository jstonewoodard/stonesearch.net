/* ============================================================
   Stone Search — AI Content Filter: orchestrator
   ------------------------------------------------------------
   Public entrypoint. Given a search result, run the full
   pipeline and return the analysis envelope (spec §5.1).

   Pipeline:
     1. fetch HTML        (fetcher.fetchPage)
     2. extract text+imgs (fetcher.extractText / extractImages)
     3. provenance pass   (provenance.verify per image)
     4. text detection    (textBackend.detect)
     5. image detection   (imageBackend.detect per image, parallel)
     6. scoring           (scorer.scorePage)
     7. cache write

   Each backend is pluggable — pass them in via createAnalyzer().
   ============================================================ */

'use strict';

const crypto = require('crypto');
const { scorePage } = require('./scorer.js');
const { TtlCache } = require('./cache.js');
const fetcher = require('./fetcher.js');
const provenance = require('./backends/provenance-c2pa.js');

const DEFAULT_OPTIONS = {
  skipImages: false,
  maxImages: 5,
  fetchTimeoutMs: 4000,
  detectorTimeoutMs: 2000,
  imageConcurrency: 5,
};

// Names of mock backends. Used by strict mode to decide whether the
// configured detectors count as "real" or not. Keep in sync with the
// `name` field on each backend export.
const MOCK_BACKEND_NAMES = new Set(['text-mock', 'image-mock']);

function isMock(backend) {
  return !backend || MOCK_BACKEND_NAMES.has(backend.name);
}

/**
 * createAnalyzer
 *
 * Options:
 *   textBackend, imageBackend  — Detector instances
 *   cache                       — cache adapter (TtlCache, kvCache, etc.)
 *   strict                      — if true, return null + 'no-real-backend'
 *                                 warning when BOTH text + image backends
 *                                 are mocks. Default: false (back-compat).
 *                                 Production callers should pass strict: true
 *                                 unless they have explicitly opted into mocks.
 */
function createAnalyzer({ textBackend, imageBackend, cache, strict = false } = {}) {
  const _cache = cache || new TtlCache();

  async function analyze(input, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const warnings = [];

    // --- 0. Strict-mode short-circuit --------------------------------------
    // Per the policy decision documented in the spec follow-up: if no real
    // detector is configured, return null rather than a misleading mock
    // score. The front-end MUST treat aiScore: null as "not analyzed."
    if (strict && isMock(textBackend) && isMock(imageBackend)) {
      return {
        aiScore: null,
        verdict: 'CLEAN',
        modality: { text: null, image: null },
        weights: { text: 0, image: 0 },
        override: null,
        base_score: 0,
        thresholds: require('./scorer.js').THRESHOLDS,
        url: input.url,
        provenance: [],
        warnings: ['no-real-backend:strict-mode'],
        cache: 'miss',
        source: 'no-detector',
      };
    }

    // --- 1. Fetch + extract -------------------------------------------------
    let text = input.text;
    let images = input.images;

    if (input.url && (text == null || images == null)) {
      const fetched = await fetcher.fetchPage(input.url, { timeoutMs: opts.fetchTimeoutMs });
      if (fetched.ok) {
        if (text == null)   text = fetcher.extractText(fetched.html);
        if (images == null) images = fetcher.extractImages(fetched.html, input.url, { maxImages: opts.maxImages });
      } else {
        warnings.push(`fetch-failed:${fetched.status}:${fetched.error || ''}`);
      }
    }

    // Fall back to title+snippet text if body extraction failed.
    if (!text || text.length < 20) {
      const fallback = [input.title, input.snippet].filter(Boolean).join('\n\n');
      if (fallback) {
        text = fallback;
        warnings.push('text-fallback:title+snippet');
      }
    }
    if (!images) images = [];
    if (opts.skipImages) images = [];

    // --- 2. Cache lookup ---------------------------------------------------
    const contentHash = hashContent(text, images);
    const cacheKey = TtlCache.key({ url: input.url || '', contentHash });
    const cached = _cache.get(cacheKey);
    if (cached) {
      return { ...cached, cache: 'hit' };
    }

    // --- 3. Provenance pass -------------------------------------------------
    const provenanceResults = await Promise.all(
      images.map(img => provenance.verify(img))
    );
    // Annotate each image with its c2pa fact so the scorer can apply overrides.
    const imagesWithProvenance = images.map((img, i) => ({
      ...img,
      c2pa: provenanceResults[i].c2pa || null,
      provenance_status: provenanceResults[i].status,
    }));

    // --- 4. Text detection -------------------------------------------------
    let textResult = null;
    if (textBackend && text) {
      try {
        const r = await withTimeout(textBackend.detect(text), opts.detectorTimeoutMs);
        if (r.score != null) {
          textResult = {
            score: r.score,
            confidence: r.confidence ?? 0.5,
            chars: text.length,
            // Prefer the winning detector's own name (e.g. 'text-heuristic',
            // 'hf-text:...') over the wrapper's name (e.g. 'chain:foo->bar').
            backend: r.backend || textBackend.name || 'text',
          };
        } else {
          warnings.push(`text-detector:no-score:${r.error || r.skipped || ''}`);
        }
      } catch (err) {
        warnings.push(`text-detector:error:${err.message}`);
      }
    }

    // --- 5. Image detection (parallel, with concurrency cap) ---------------
    let imageResults = [];
    if (imageBackend && imagesWithProvenance.length > 0) {
      imageResults = await mapWithConcurrency(
        imagesWithProvenance,
        opts.imageConcurrency,
        async (img) => {
          // C2PA short-circuit: spec §4.2 + §6.2. If we already have a
          // verified provenance fact, we still call the detector for
          // audit, but the score below will be overridden by applyProvenance.
          try {
            const r = await withTimeout(imageBackend.detect(img), opts.detectorTimeoutMs);
            return {
              ai_score: r.score ?? 0,
              confidence: r.confidence ?? 0.5,
              area_px: img.area_px || 200_000,
              c2pa: img.c2pa,
              url: img.url,
              backend: imageBackend.name || r.backend || 'image',
            };
          } catch (err) {
            warnings.push(`image-detector:error:${img.url}:${err.message}`);
            return {
              ai_score: 0,
              confidence: 0,
              area_px: img.area_px || 200_000,
              c2pa: img.c2pa,
              url: img.url,
              error: true,
            };
          }
        }
      );
    }

    // --- 6. Score ----------------------------------------------------------
    const result = scorePage({ text: textResult, images: imageResults });

    // --- 7. Assemble envelope ----------------------------------------------
    const envelope = {
      ...result,
      url: input.url,
      provenance: provenanceResults.map((pr, i) => ({
        url: imagesWithProvenance[i]?.url,
        status: pr.status,
        origin: pr.origin,
        signer: pr.signer,
      })),
      warnings,
      cache: 'miss',
      // Source = 'mock' iff the WINNING text detector was the mock (chain
      // wrappers don't count). Live otherwise.
      source: textResult?.backend === 'text-mock' ? 'mock' : 'live',
    };

    _cache.set(cacheKey, envelope);
    return envelope;
  }

  return { analyze, cache: _cache };
}

// ----- helpers ---------------------------------------------------------------
function hashContent(text, images) {
  const h = crypto.createHash('sha256');
  h.update(text || '');
  h.update('|');
  h.update((images || []).map(i => i.url).sort().join(','));
  return h.digest('hex');
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout-${ms}ms`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); },
                 e => { clearTimeout(t); reject(e); });
  });
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = { createAnalyzer };
