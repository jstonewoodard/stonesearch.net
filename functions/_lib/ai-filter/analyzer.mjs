/* Orchestrator — ESM, runs in Cloudflare Workers / Pages Functions.
   Differences from api/ai-filter/index.js:
     - ESM imports
     - Web Crypto (crypto.subtle.digest) for content hashing
     - Cache adapter accepts either an in-memory Map or a Cloudflare KV
       binding. KV gives cross-isolate cache hits.
*/

import { scorePage } from './scorer.mjs';
import { fetchPage, extractText, extractImages } from './fetcher.mjs';
import { verifyProvenance } from './backends.mjs';

const DEFAULT_OPTIONS = {
  skipImages: false,
  maxImages: 5,
  fetchTimeoutMs: 4000,
  detectorTimeoutMs: 2500,
  imageConcurrency: 5,
  cacheTtlSeconds: 7 * 24 * 60 * 60,
};

// Names of mock backends. Used by strict mode to decide whether the
// configured detectors count as "real" or not. Keep in sync with the
// `name` field on each backend export.
const MOCK_BACKEND_NAMES = new Set(['text-mock', 'image-mock']);

function isMock(backend) {
  return !backend || MOCK_BACKEND_NAMES.has(backend.name);
}

import { THRESHOLDS } from './scorer.mjs';

/**
 * createAnalyzer
 * @param {object} deps
 * @param {object} [deps.textBackend]
 * @param {object} [deps.imageBackend]
 * @param {object} [deps.cache]       — cache adapter
 * @param {boolean} [deps.strict]     — fail-loud when both backends are mocks
 *                                      (returns aiScore: null + verdict: 'CLEAN'
 *                                      + 'no-real-backend:strict-mode' warning).
 *                                      Production callers should pass true.
 */
export function createAnalyzer({ textBackend, imageBackend, cache, strict = false } = {}) {
  const _cache = cache || new MemoryCache();

  async function analyze(input, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const warnings = [];

    // 0. Strict-mode short-circuit: no real detector configured
    if (strict && isMock(textBackend) && isMock(imageBackend)) {
      return {
        aiScore: null,
        verdict: 'CLEAN',
        modality: { text: null, image: null },
        weights: { text: 0, image: 0 },
        override: null,
        base_score: 0,
        thresholds: THRESHOLDS,
        url: input.url,
        provenance: [],
        warnings: ['no-real-backend:strict-mode'],
        cache: 'miss',
        source: 'no-detector',
      };
    }

    // 1. Fetch + extract
    let text = input.text;
    let images = input.images;

    if (input.url && (text == null || images == null)) {
      const fetched = await fetchPage(input.url, { timeoutMs: opts.fetchTimeoutMs });
      if (fetched.ok) {
        if (text == null)   text = extractText(fetched.html);
        if (images == null) images = extractImages(fetched.html, input.url, { maxImages: opts.maxImages });
        if (fetched.truncated) warnings.push('fetch:truncated');
      } else {
        warnings.push(`fetch-failed:${fetched.status}:${fetched.error || ''}`);
      }
    }

    if (!text || text.length < 20) {
      const fallback = [input.title, input.snippet].filter(Boolean).join('\n\n');
      if (fallback) {
        text = fallback;
        warnings.push('text-fallback:title+snippet');
      }
    }
    if (!images) images = [];
    if (opts.skipImages) images = [];

    // 2. Cache lookup
    const contentHash = await hashContent(text, images);
    const cacheKey = await makeKey(input.url || '', contentHash);
    const cached = await _cache.get(cacheKey);
    if (cached) return { ...cached, cache: 'hit' };

    // 3. Provenance pass
    const provenanceResults = await Promise.all(images.map(verifyProvenance));
    const imagesWithProvenance = images.map((img, i) => ({
      ...img,
      c2pa: provenanceResults[i].c2pa || null,
      provenance_status: provenanceResults[i].status,
    }));

    // 4. Text detection
    let textResult = null;
    if (textBackend && text) {
      try {
        const r = await withTimeout(textBackend.detect(text), opts.detectorTimeoutMs);
        if (r.score != null) {
          textResult = {
            score: r.score,
            confidence: r.confidence ?? 0.5,
            chars: text.length,
            // Prefer the winning detector's own name over the chain wrapper's name.
            backend: r.backend || textBackend.name || 'text',
          };
        } else {
          warnings.push(`text-detector:no-score:${r.error || r.skipped || ''}`);
        }
      } catch (err) {
        warnings.push(`text-detector:error:${err.message}`);
      }
    }

    // 5. Image detection (concurrent)
    let imageResults = [];
    if (imageBackend && imagesWithProvenance.length > 0) {
      imageResults = await mapWithConcurrency(
        imagesWithProvenance, opts.imageConcurrency,
        async (img) => {
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
              ai_score: 0, confidence: 0,
              area_px: img.area_px || 200_000, c2pa: img.c2pa,
              url: img.url, error: true,
            };
          }
        }
      );
    }

    // 6. Score
    const result = scorePage({ text: textResult, images: imageResults });

    // 7. Envelope + cache write
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
      // Source = 'mock' iff the winning text detector was the mock.
      source: textResult?.backend === 'text-mock' ? 'mock' : 'live',
    };

    await _cache.set(cacheKey, envelope, opts.cacheTtlSeconds);
    return envelope;
  }

  return { analyze, cache: _cache };
}

// ============================================================
// Cache adapters
// ============================================================

export class MemoryCache {
  constructor() { this.map = new Map(); }
  async get(key) {
    const e = this.map.get(key);
    if (!e || e.expiresAt < Date.now()) { this.map.delete(key); return null; }
    return e.value;
  }
  async set(key, value, ttlSeconds) {
    this.map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

/** Cloudflare KV-backed cache. Pass env.CACHE binding from a Pages Function. */
export function kvCache(kv) {
  return {
    async get(key) {
      const raw = await kv.get(key);
      return raw ? JSON.parse(raw) : null;
    },
    async set(key, value, ttlSeconds) {
      await kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSeconds) });
    },
  };
}

// ============================================================
// helpers — Web Crypto + concurrency
// ============================================================

async function hashContent(text, images) {
  const imgUrls = (images || []).map(i => i.url).sort().join(',');
  return sha256(`${text || ''}|${imgUrls}`);
}

async function makeKey(url, contentHash) {
  return sha256(`${url}:${contentHash}`);
}

async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
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
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = idx++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    }
  );
  await Promise.all(workers);
  return results;
}
