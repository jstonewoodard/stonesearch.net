/* Text detection backend: deterministic mock.
   Produces a stable score from the input so the demo and the
   front-end work end-to-end with no external accounts.

   Score distribution mirrors the original mockScore() in server.js:
     60% clean (<5%), 25% flagged (5-25%), 15% blocked (>25%)
   Confidence is high (0.8) when the score is far from 50%, and
   drops near the middle.
*/
'use strict';

async function detect(text /* string */) {
  const seed = String(text || '').slice(0, 4096);
  const score = mockScore(seed);
  // Confidence is high when the model is sure (score near 0 or 100),
  // and lower in the ambiguous middle.
  const confidence = Math.round((0.6 + 0.4 * Math.abs(score - 50) / 50) * 100) / 100;
  return { score, confidence, backend: 'text-mock', raw: { seed_len: seed.length } };
}

function mockScore(seedStr) {
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

module.exports = { detect, name: 'text-mock', modality: 'text', mockScore };
