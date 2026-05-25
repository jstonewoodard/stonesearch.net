/* Detector backends — ESM, runs in Workers.
   Provides: text-mock, text-hive, image-mock, provenance.
   Vendor backends (Sightengine, GPTZero, etc.) drop in behind
   the same Detector shape: { name, modality, detect(input) }.
*/

// ---------- text: deterministic mock ----------
export const textMock = {
  name: 'text-mock',
  modality: 'text',
  async detect(text) {
    const seed = String(text || '').slice(0, 4096);
    const score = mockTextScore(seed);
    const confidence = Math.round((0.6 + 0.4 * Math.abs(score - 50) / 50) * 100) / 100;
    return { score, confidence, backend: 'text-mock', raw: { seed_len: seed.length } };
  },
};

function mockTextScore(seedStr) {
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
export function makeTextHive(apiKey) {
  return {
    name: 'hive-text',
    modality: 'text',
    async detect(text, { timeoutMs = 2500 } = {}) {
      if (!apiKey) return { score: null, confidence: 0, backend: 'hive-text', skipped: 'no-api-key' };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch('https://api.thehive.ai/api/v2/task/sync', {
          method: 'POST', signal: ctrl.signal,
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text_data: text }),
        });
        const json = await r.json();
        const e = extractHiveScore(json);
        return { score: e.score, confidence: e.confidence, raw: json, backend: 'hive-text' };
      } catch (err) {
        return { score: null, confidence: 0, error: err.message, backend: 'hive-text' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function extractHiveScore(json) {
  try {
    const out = json?.status?.[0]?.response?.output?.[0];
    const cls = out?.classes || [];
    const ai = cls.find(c => /ai|generated|machine/i.test(c.class));
    if (ai && typeof ai.score === 'number') {
      const score = Math.round(ai.score * 1000) / 10;
      const confidence = Math.min(1, Math.abs(ai.score - 0.5) * 2 + 0.5);
      return { score, confidence };
    }
  } catch (_) {}
  return { score: null, confidence: 0 };
}

// ---------- text: Hugging Face Inference API ----------
// Free-tier real text detector. Default model:
// Hello-SimpleAI/chatgpt-detector-roberta (ChatGPT-era output).
const HF_DEFAULT_MODEL = 'Hello-SimpleAI/chatgpt-detector-roberta';
const HF_AI_LABEL_RX = /ai|fake|machine|generated|chatgpt|gpt/i;

export function makeTextHuggingFace(apiToken, modelName) {
  const model = modelName || HF_DEFAULT_MODEL;
  return {
    name: `hf-text:${model}`,
    modality: 'text',
    async detect(text, { timeoutMs = 4000 } = {}) {
      if (!apiToken) return { score: null, confidence: 0, backend: this.name, skipped: 'no-api-token' };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
            'x-wait-for-model': 'true',
          },
          body: JSON.stringify({ inputs: String(text || '').slice(0, 6000) }),
        });
        const json = await r.json();
        const extracted = extractHFScore(json);
        if (extracted.score == null) {
          return { score: null, confidence: 0, backend: this.name, raw: json,
                   error: extracted.error || 'unparsed-response' };
        }
        return { score: extracted.score, confidence: extracted.confidence, raw: json, backend: this.name };
      } catch (err) {
        return { score: null, confidence: 0, error: err.message, backend: this.name };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function extractHFScore(json) {
  if (json && json.error) return { score: null, confidence: 0, error: json.error };
  const inner = Array.isArray(json) && Array.isArray(json[0]) ? json[0]
              : Array.isArray(json) ? json
              : null;
  if (!inner) return { score: null, confidence: 0, error: 'unexpected-shape' };
  let pAI = null;
  for (const cls of inner) {
    if (typeof cls?.score !== 'number') continue;
    if (HF_AI_LABEL_RX.test(String(cls.label))) pAI = cls.score;
  }
  if (pAI == null) return { score: null, confidence: 0, error: 'no-ai-label-found' };
  const score = Math.round(pAI * 1000) / 10;
  const confidence = Math.min(1, Math.abs(pAI - 0.5) * 2 + 0.5);
  return { score, confidence };
}

// ---------- image: deterministic mock ----------
export const imageMock = {
  name: 'image-mock',
  modality: 'image',
  async detect(imageRef) {
    const seed = String(imageRef?.url || '');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    const r = (h % 10000) / 10000;
    let score;
    if (r < 0.50)      score = (r / 0.50) * 8;
    else if (r < 0.80) score = 8 + ((r - 0.50) / 0.30) * 22;
    else               score = 30 + ((r - 0.80) / 0.20) * 65;
    score = Math.round(score * 10) / 10;
    const confidence = Math.round((0.55 + 0.4 * Math.abs(score - 50) / 50) * 100) / 100;
    return { score, confidence, backend: 'image-mock' };
  },
};

// ---------- provenance (C2PA) ----------
const KNOWN_GENERATIVE_SIGNERS = new Set([
  'Adobe Firefly','OpenAI DALL-E','OpenAI','Midjourney','Stability AI','Leonardo.Ai','Google ImageFX',
]);
const KNOWN_CAPTURE_SIGNERS = new Set([
  'Sony Alpha','Leica M11','Nikon Z9','Canon EOS R5','iPhone Camera','Truepic',
]);

export async function verifyProvenance(imageRef) {
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
