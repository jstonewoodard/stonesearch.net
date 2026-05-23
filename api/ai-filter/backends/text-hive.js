/* Text detection backend: Hive.
   Wraps the call shape already used in server.js so we can swap
   it in/out behind the Detector interface.
*/
'use strict';

async function detect(text, { timeoutMs = 2000 } = {}) {
  if (!process.env.HIVE_API_KEY) {
    return { score: null, confidence: 0, raw: null, backend: 'hive-text', skipped: 'no-api-key' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.thehive.ai/api/v2/task/sync', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Token ${process.env.HIVE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text_data: text }),
    });
    const json = await r.json();
    const extracted = extractHiveScore(json);
    return {
      score: extracted.score,
      confidence: extracted.confidence,
      raw: json,
      backend: 'hive-text',
    };
  } catch (err) {
    return { score: null, confidence: 0, error: err.message, backend: 'hive-text' };
  } finally {
    clearTimeout(timer);
  }
}

function extractHiveScore(json) {
  try {
    const out = json?.status?.[0]?.response?.output?.[0];
    const cls = out?.classes || [];
    const ai = cls.find(c => /ai|generated|machine/i.test(c.class));
    if (ai && typeof ai.score === 'number') {
      const score = Math.round(ai.score * 1000) / 10;
      // Hive's class score doubles as confidence proxy.
      const confidence = Math.min(1, Math.abs(ai.score - 0.5) * 2 + 0.5);
      return { score, confidence };
    }
  } catch (e) { /* fall through */ }
  return { score: null, confidence: 0 };
}

module.exports = { detect, name: 'hive-text', modality: 'text' };
