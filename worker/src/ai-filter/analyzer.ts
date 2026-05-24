/* Orchestrator — Worker runtime (TypeScript).
   Wires fetcher → provenance → detectors → scorer → cache.
   Supports either an in-memory cache (default) or a Cloudflare KV
   binding via kvCache(env.CACHE).

   Mirrors functions/_lib/ai-filter/analyzer.mjs exactly. Differences:
     - typed
     - imports TypeScript siblings

   See docs/Stone_Search_AI_Filter_Spec.docx section 3.
*/

import { scorePage, PageScoreEnvelope, TextSignal, ImageSignal } from './scorer.js';
import { fetchPage, extractText, extractImages, ImageRef } from './fetcher.js';
import {
  TextDetector,
  ImageDetector,
  verifyProvenance,
  ProvenanceResult,
  ImageRefForDetector,
} from './backends.js';

export interface AnalyzeInput {
  url?: string;
  title?: string;
  snippet?: string;
  text?: string;
  images?: ImageRefForDetector[];
}

export interface AnalyzeOptions {
  skipImages?: boolean;
  maxImages?: number;
  fetchTimeoutMs?: number;
  detectorTimeoutMs?: number;
  imageConcurrency?: number;
  cacheTtlSeconds?: number;
}

export interface CacheAdapter {
  get(key: string): Promise<AnalysisEnvelope | null>;
  set(key: string, value: AnalysisEnvelope, ttlSeconds: number): Promise<void>;
}

export interface AnalysisEnvelope extends PageScoreEnvelope {
  url?: string;
  provenance: Array<{ url?: string; status: string; origin: string | null; signer: string | null }>;
  warnings: string[];
  cache: 'hit' | 'miss';
  source: string;
}

const DEFAULT_OPTIONS: Required<AnalyzeOptions> = {
  skipImages: false,
  maxImages: 5,
  fetchTimeoutMs: 4000,
  detectorTimeoutMs: 2500,
  imageConcurrency: 5,
  cacheTtlSeconds: 7 * 24 * 60 * 60,
};

export interface Analyzer {
  analyze(input: AnalyzeInput, options?: AnalyzeOptions): Promise<AnalysisEnvelope>;
  cache: CacheAdapter;
}

export function createAnalyzer(deps: {
  textBackend?: TextDetector;
  imageBackend?: ImageDetector;
  cache?: CacheAdapter;
}): Analyzer {
  const _cache = deps.cache ?? new MemoryCache();
  const textBackend = deps.textBackend;
  const imageBackend = deps.imageBackend;

  async function analyze(input: AnalyzeInput, options: AnalyzeOptions = {}): Promise<AnalysisEnvelope> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const warnings: string[] = [];

    // 1. Fetch + extract
    let text: string | undefined = input.text;
    let images: ImageRefForDetector[] | undefined = input.images;

    if (input.url && (text == null || images == null)) {
      const fetched = await fetchPage(input.url, { timeoutMs: opts.fetchTimeoutMs });
      if (fetched.ok) {
        if (text == null)   text = extractText(fetched.html);
        if (images == null) images = (extractImages(fetched.html, input.url, { maxImages: opts.maxImages }) as ImageRef[]) as ImageRefForDetector[];
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
    const contentHash = await hashContent(text ?? '', images);
    const cacheKey = await makeKey(input.url || '', contentHash);
    const cached = await _cache.get(cacheKey);
    if (cached) return { ...cached, cache: 'hit' };

    // 3. Provenance pass
    const provenanceResults: ProvenanceResult[] = await Promise.all(images.map(verifyProvenance));
    const imagesWithProvenance = images.map((img, i): ImageRefForDetector & { c2pa: ProvenanceResult['c2pa']; provenance_status: string } => ({
      ...img,
      c2pa: provenanceResults[i].c2pa,
      provenance_status: provenanceResults[i].status,
    }));

    // 4. Text detection
    let textResult: TextSignal | null = null;
    if (textBackend && text) {
      try {
        const r = await withTimeout(textBackend.detect(text), opts.detectorTimeoutMs);
        if (r.score != null) {
          textResult = {
            score: r.score,
            confidence: r.confidence ?? 0.5,
            chars: text.length,
            backend: textBackend.name || r.backend || 'text',
          };
        } else {
          warnings.push(`text-detector:no-score:${r.error || r.skipped || ''}`);
        }
      } catch (err) {
        warnings.push(`text-detector:error:${(err as Error).message}`);
      }
    }

    // 5. Image detection
    let imageResults: ImageSignal[] = [];
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
              c2pa: img.c2pa ?? null,
              url: img.url,
            } as ImageSignal;
          } catch (err) {
            warnings.push(`image-detector:error:${img.url}:${(err as Error).message}`);
            return {
              ai_score: 0, confidence: 0,
              area_px: img.area_px || 200_000, c2pa: img.c2pa ?? null,
              url: img.url,
            } as ImageSignal;
          }
        }
      );
    }

    // 6. Score
    const result = scorePage({ text: textResult, images: imageResults });

    // 7. Envelope + cache write
    const envelope: AnalysisEnvelope = {
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
      source: textBackend?.name === 'text-mock' ? 'mock' : 'live',
    };

    await _cache.set(cacheKey, envelope, opts.cacheTtlSeconds);
    return envelope;
  }

  return { analyze, cache: _cache };
}

// ============================================================
// Cache adapters
// ============================================================

export class MemoryCache implements CacheAdapter {
  private map = new Map<string, { value: AnalysisEnvelope; expiresAt: number }>();
  async get(key: string): Promise<AnalysisEnvelope | null> {
    const e = this.map.get(key);
    if (!e || e.expiresAt < Date.now()) { this.map.delete(key); return null; }
    return e.value;
  }
  async set(key: string, value: AnalysisEnvelope, ttlSeconds: number): Promise<void> {
    this.map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

/** Cloudflare KV-backed cache. Pass env.CACHE from the Worker. */
export function kvCache(kv: KVNamespace): CacheAdapter {
  return {
    async get(key: string): Promise<AnalysisEnvelope | null> {
      const raw = await kv.get(key);
      return raw ? (JSON.parse(raw) as AnalysisEnvelope) : null;
    },
    async set(key: string, value: AnalysisEnvelope, ttlSeconds: number): Promise<void> {
      await kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSeconds) });
    },
  };
}

// ============================================================
// helpers
// ============================================================

async function hashContent(text: string, images: ImageRefForDetector[]): Promise<string> {
  const imgUrls = (images || []).map(i => i.url ?? '').sort().join(',');
  return sha256Hex(`${text || ''}|${imgUrls}`);
}

async function makeKey(url: string, contentHash: string): Promise<string> {
  return sha256Hex(`${url}:${contentHash}`);
}

async function sha256Hex(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout-${ms}ms`)), ms);
    promise.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); }
    );
  });
}

async function mapWithConcurrency<T, R>(
  items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
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
