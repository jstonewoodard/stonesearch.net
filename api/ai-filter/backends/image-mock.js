/* Image detection backend: deterministic mock.
   Hashes the image URL into a 0-100 AI score so the same image
   always returns the same score across calls. Real backends
   (Sightengine, Hive Visual, Optic) should implement the same
   interface: detect(imageRef) -> {score, confidence, ...}
*/
'use strict';

async function detect(imageRef /* {url, area_px} */) {
  const seed = String(imageRef?.url || '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const r = (h % 10000) / 10000;
  // Distribution skewed toward "probably human" with a fat tail.
  let score;
  if (r < 0.50)      score = (r / 0.50) * 8;             // 0-8: clean
  else if (r < 0.80) score = 8 + ((r - 0.50) / 0.30) * 22; // 8-30: ambiguous
  else               score = 30 + ((r - 0.80) / 0.20) * 65; // 30-95: AI

  score = Math.round(score * 10) / 10;
  const confidence = Math.round((0.55 + 0.4 * Math.abs(score - 50) / 50) * 100) / 100;
  return { score, confidence, backend: 'image-mock' };
}

module.exports = { detect, name: 'image-mock', modality: 'image' };
