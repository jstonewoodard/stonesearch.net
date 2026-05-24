/* Detector backends — Worker runtime (TypeScript).
   Same logic as functions/_lib/ai-filter/backends.mjs.
*/

export type Modality = 'text' | 'image';

export interface DetectorResult {
  score: number | null;
  confidence: number;
  backend?: string;
  raw?: unknown;
  error?: string;
  skipped?: string;
}

export interface TextDetector {
  name: string;
  modality: 'text';
  detect(text: string, opts?: { timeoutMs?: number }): Promise<DetectorResult>;
}

export interface ImageRefForDetector {
  url?: string;
  area_px?: number;
  manifest?: { signer?: string };
}

export interface ImageDetector {
  name: string;
  modality: 'image';
  detect(imageRef: ImageRefForDetector): Promise<DetectorResult>;
}

// ---------- text: deterministic mock ----------
export const textMock: TextDetector = {
  name: 'text-mock',
  modality: 'text',
  async detect(text: string): Promise<DetectorResult> {
    const seed = String(text || '').slice(0, 4096);
    const score = mockTextScore(seed);
    const confidence = Math.round((0.6 + 0.4 * Math.abs(score - 50) / 50) * 100) / 100;
    return { score, confidence, backend: 'text-mock', raw: { seed_len: seed.length } };
  },
};

function mockTextScore(seedStr: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const r = (h % 10000) / 10000;
  if (r < 0.60) return Math.round((r / 0.60) * 5 * 10) / 10;
  if (r < 0.85) return Math.round((5 + ((r - 0.60) / 0.25) * 20) * 10) / 10;
  return Math.round((25 + ((r - 0.85) / 0.15) * 70) * 10) / 10;
}

// ---------- text: Hive ----------
export function makeTextHive(apiKey: string | undefined): TextDetector {
  return {
    name: 'hive-text',
    modality: 'text',
    async detect(text: string, opts: { timeoutMs?: number } = {}): Promise<DetectorResult> {
      const timeoutMs = opts.timeoutMs ?? 2500;
      if (!apiKey) return { score: null, confidence: 0, backend: 'hive-text', skipped: 'no-api-key' };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch('https://api.thehive.ai/api/v2/task/sync', {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text_data: text }),
        });
        const json: any = await r.json();
        const e = extractHiveScore(json);
        return { score: e.score, confidence: e.confidence, raw: json, backend: 'hive-text' };
      } catch (err) {
        return { score: null, confidence: 0, error: (err as Error).message, backend: 'hive-text' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function extractHiveScore(json: any): { score: number | null; confidence: number } {
  try {
    const out = json?.status?.[0]?.response?.output?.[0];
    const cls = out?.classes || [];
    const ai = cls.find((c: any) => /ai|generated|machine/i.test(c.class));
    if (ai && typeof ai.score === 'number') {
      const score = Math.round(ai.score * 1000) / 10;
      const confidence = Math.min(1, Math.abs(ai.score - 0.5) * 2 + 0.5);
      return { score, confidence };
    }
  } catch { /* ignore */ }
  return { score: null, confidence: 0 };
}

// ---------- image: deterministic mock ----------
export const imageMock: ImageDetector = {
  name: 'image-mock',
  modality: 'image',
  async detect(imageRef: ImageRefForDetector): Promise<DetectorResult> {
    const seed = String(imageRef?.url || '');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    const r = (h % 10000) / 10000;
    let score: number;
    if (r < 0.50)      score = (r / 0.50) * 8;
    else if (r < 0.80) score = 8 + ((r - 0.50) / 0.30) * 22;
    else               score = 30 + ((r - 0.80) / 0.20) * 65;
    score = Math.round(score * 10) / 10;
    const confidence = Math.round((0.55 + 0.4 * Math.abs(score - 50) / 50) * 100) / 100;
    return { score, confidence, backend: 'image-mock' };
  },
};

// ---------- provenance (C2PA) ----------
const KNOWN_GENERATIVE_SIGNERS = new Set<string>([
  'Adobe Firefly','OpenAI DALL-E','OpenAI','Midjourney','Stability AI','Leonardo.Ai','Google ImageFX',
]);
const KNOWN_CAPTURE_SIGNERS = new Set<string>([
  'Sony Alpha','Leica M11','Nikon Z9','Canon EOS R5','iPhone Camera','Truepic',
]);

export interface ProvenanceResult {
  status: 'verified' | 'unsigned' | 'unknown-signer';
  origin: 'generative' | 'capture' | null;
  signer: string | null;
  c2pa?: { generative_ai_origin?: boolean; camera_capture_chain?: boolean };
}

export async function verifyProvenance(imageRef: ImageRefForDetector): Promise<ProvenanceResult> {
  const m = imageRef?.manifest;
  if (!m || !m.signer) return { status: 'unsigned', origin: null, signer: null };
  if (KNOWN_GENERATIVE_SIGNERS.has(m.signer)) {
    return { status: 'verified', origin: 'generative', signer: m.signer, c2pa: { generative_ai_origin: true } };
  }
  if (KNOWN_CAPTURE_SIGNERS.has(m.signer)) {
    return { status: 'verified', origin: 'capture', signer: m.signer, c2pa: { camera_capture_chain: true } };
  }
  return { status: 'unknown-signer', origin: null, signer: m.signer };
}
