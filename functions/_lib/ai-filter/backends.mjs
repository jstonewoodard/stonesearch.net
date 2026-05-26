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

// ---------- text: in-Worker heuristic ensemble ----------
// Path 1 of the in-house detection stack. Pure JS, zero dependencies,
// zero marginal cost. See api/ai-filter/backends/text-heuristic.js for
// full doc and signal weights — math is byte-identical.

const HEUR_LLM_TELLS = Object.freeze([
  'delve','delving','tapestry','landscape','realm','embark','embarking',
  'leverage','leveraging','harness','harnessing','foster','fostering',
  'robust','comprehensive','intricate','intricacies','profound',
  'multifaceted','paradigm','holistic','navigate','navigating',
  'underscore','underscores','underscoring','pivotal','crucial',
  'invaluable','meticulous','meticulously','streamline','streamlining',
  "it's important to note","it's worth noting","it's worth mentioning",
  'in this article','in this post',"let's dive","let's explore",
  'navigate the landscape','in the realm of','in the world of',
  'harness the power','foster a sense','play a crucial role',
  'a testament to','stand the test of time',"in today's digital age",
  'in conclusion','to summarize','in summary',
  'certainly!','absolutely!','great question',"i'd be happy to help",
  "here's a",'here are some',
]);
const HEUR_CONCLUSION = Object.freeze([
  'in conclusion','to summarize','to conclude','in summary','overall,',
  'ultimately,','to wrap up','in closing','final thoughts','all in all','to sum up',
]);
const HEUR_TRANSITION = Object.freeze([
  'however','moreover','furthermore','additionally','consequently','therefore',
  'thus','hence','indeed','notably','specifically','particularly','similarly',
  'likewise','nonetheless','nevertheless','subsequently','accordingly',
]);
const HEUR_HEDGING = Object.freeze([
  "it's worth noting","it's important to note",'that said','having said that',
  'with that in mind',"it's important to remember",'keep in mind',
  'on the other hand',"while it's true",
]);
const HEUR_WEIGHTS = Object.freeze({
  llmTells: 0.25, burstiness: 0.15, emDash: 0.15, conclusion: 0.10,
  starterRepeat: 0.10, transition: 0.10, parallelism: 0.05, hedging: 0.05, vocab: 0.05,
});
const heurClamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const heurEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function heurSents(t) {
  return String(t).split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 0);
}
function heurWords(t) { return String(t).toLowerCase().match(/[a-z0-9'\-]+/g) || []; }

export function detectTextHeuristic(text) {
  const t = String(text || '');
  const tl = t.toLowerCase();
  const sents = heurSents(t);
  const wl = heurWords(t);
  const wc = wl.length;
  const signals = {
    llmTells: (() => {
      if (wc === 0) return 0;
      let hits = 0;
      for (const tell of HEUR_LLM_TELLS) {
        const m = tl.match(new RegExp(`(?:^|[^a-z])${heurEsc(tell)}(?:[^a-z]|$)`, 'g'));
        if (m) hits += m.length;
      }
      return heurClamp((hits / wc) * 1000 / 5, 0, 1);
    })(),
    burstiness: (() => {
      if (sents.length < 4) return 0;
      const L = sents.map(s => (s.match(/\S+/g) || []).length);
      const m = L.reduce((a,b)=>a+b,0)/L.length;
      const v = L.reduce((a,b)=>a+(b-m)**2,0)/L.length;
      return heurClamp(1 - (Math.sqrt(v) - 3) / 10, 0, 1);
    })(),
    emDash: (() => {
      if (wc === 0) return 0;
      const m = t.match(/—|–|--/g);
      return heurClamp(((m ? m.length : 0) / wc * 1000 - 2) / 16, 0, 1);
    })(),
    conclusion: (() => {
      let h = 0; for (const m of HEUR_CONCLUSION) if (tl.indexOf(m) !== -1) h++;
      return heurClamp(h / 2, 0, 1);
    })(),
    starterRepeat: (() => {
      if (sents.length < 5) return 0;
      const st = {};
      for (const s of sents) {
        const f = (s.match(/^\S+/) || [''])[0].toLowerCase();
        if (f) st[f] = (st[f] || 0) + 1;
      }
      const counts = Object.values(st);
      if (!counts.length) return 0;
      return heurClamp((Math.max(...counts) / sents.length - 0.10) / 0.20, 0, 1);
    })(),
    transition: (() => {
      if (wc === 0) return 0;
      let h = 0;
      for (const w of HEUR_TRANSITION) {
        const m = tl.match(new RegExp(`(?:^|[^a-z])${w}(?:[^a-z]|$)`, 'g'));
        if (m) h += m.length;
      }
      return heurClamp((h / wc * 100) / 2, 0, 1);
    })(),
    parallelism: (() => {
      const lines = t.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length < 4) return 0;
      let li = 0;
      for (const l of lines) if (/^(\d+\.\s|[-*•·]\s)/.test(l)) li++;
      return heurClamp((li / lines.length) / 0.30, 0, 1);
    })(),
    hedging: (() => {
      let h = 0; for (const ph of HEUR_HEDGING) if (tl.indexOf(ph) !== -1) h++;
      return heurClamp(h / 3, 0, 1);
    })(),
    vocab: (() => {
      if (wl.length < 50) return 0;
      let lw = 0; for (const w of wl) if (w.length >= 7) lw++;
      return heurClamp((lw / wl.length - 0.20) / 0.15, 0, 1);
    })(),
  };
  let agg = 0; for (const k of Object.keys(HEUR_WEIGHTS)) agg += signals[k] * HEUR_WEIGHTS[k];
  const score = Math.round(agg * 1000) / 10;
  const lc = heurClamp(t.length / 2000, 0.4, 1.0);
  const sv = Object.values(signals);
  const sm = sv.reduce((a,b)=>a+b,0)/sv.length;
  const svar = sv.reduce((a,b)=>a+(b-sm)**2,0)/sv.length;
  const agreement = heurClamp(1 - Math.sqrt(svar) * 2, 0, 1);
  const confidence = Math.round((lc * (0.7 + 0.3 * agreement)) * 100) / 100;
  return { score, confidence, signals };
}

export const textHeuristic = {
  name: 'text-heuristic',
  modality: 'text',
  async detect(text) {
    const r = detectTextHeuristic(text);
    return {
      score: r.score,
      confidence: r.confidence,
      backend: 'text-heuristic',
      raw: { signals: r.signals, word_count: heurWords(text).length, sentence_count: heurSents(text).length },
    };
  },
};

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
