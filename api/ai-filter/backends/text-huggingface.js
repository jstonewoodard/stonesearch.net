/* Text detection backend: Hugging Face Inference API.
   ----------------------------------------------------------------
   Free-tier alternative to Hive. Works with any HF-hosted
   AI-text-detector model that returns binary classification probs.

   Recommended public models (no special access):
     - 'Hello-SimpleAI/chatgpt-detector-roberta'      (ChatGPT-era output)
     - 'roberta-large-openai-detector'                (GPT-2/GPT-3 era)
     - 'andreas122001/roberta-mixed-detector'         (mixed corpora)

   API contract:
     POST https://api-inference.huggingface.co/models/<model>
     Authorization: Bearer <token>
     Body: { "inputs": "<text>" }
     Response shape (typical):
       [[{ "label": "AI"|"fake"|"machine", "score": 0.93 },
         { "label": "human"|"real",         "score": 0.07 }]]

   Confidence = the model's confidence in its own call:
     conf = max(p_ai, p_human)  ∈ [0.5, 1.0]
*/
'use strict';

const DEFAULT_MODEL = 'Hello-SimpleAI/chatgpt-detector-roberta';
const AI_LABEL_RX = /ai|fake|machine|generated|chatgpt|gpt/i;

function makeTextHuggingFace(apiToken, modelName) {
  const model = modelName || DEFAULT_MODEL;
  return {
    name: `hf-text:${model}`,
    modality: 'text',
    async detect(text, { timeoutMs = 4000 } = {}) {
      if (!apiToken) {
        return { score: null, confidence: 0, backend: this.name, skipped: 'no-api-token' };
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        // Truncate to ~6KB to stay under typical inference limits; the detector
        // doesn't need full body — first few paragraphs are highly diagnostic.
        const body = JSON.stringify({ inputs: String(text || '').slice(0, 6000) });
        const r = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
            // Cold-start handling: ask HF to wait for the model to load instead
            // of returning 503. Slight latency cost on first call; eliminates
            // the "Model is loading" 30-50s race.
            'x-wait-for-model': 'true',
          },
          body,
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
  // Handle error envelopes
  if (json && json.error) return { score: null, confidence: 0, error: json.error };

  // Most HF text-classification models return [[{label,score},...]]
  // Some return [{label,score},...] (single-prediction case).
  const inner = Array.isArray(json) && Array.isArray(json[0]) ? json[0]
              : Array.isArray(json) ? json
              : null;
  if (!inner) return { score: null, confidence: 0, error: 'unexpected-shape' };

  let pAI = null;
  let pTotal = 0;
  for (const cls of inner) {
    if (typeof cls?.score !== 'number') continue;
    pTotal += cls.score;
    if (AI_LABEL_RX.test(String(cls.label))) {
      pAI = cls.score;
    }
  }
  if (pAI == null) return { score: null, confidence: 0, error: 'no-ai-label-found' };

  const score = Math.round(pAI * 1000) / 10;       // 0-100
  // Model's binary confidence — distance from 50/50 uncertainty.
  const confidence = Math.min(1, Math.abs(pAI - 0.5) * 2 + 0.5);
  return { score, confidence };
}

module.exports = { makeTextHuggingFace, extractHFScore, DEFAULT_MODEL };
