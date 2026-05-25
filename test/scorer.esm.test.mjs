/* Unit tests for the ESM port of the scorer.
   Run with:  node test/scorer.esm.test.mjs
   Mirrors test/scorer.test.js exactly — proves both ports return
   identical results for identical inputs.
*/

import assert from 'node:assert/strict';
import {
  scorePage, verdictFor, aggregateImages, computeWeights, applyProvenance, dampen,
  THRESHOLDS,
} from '../functions/_lib/ai-filter/scorer.mjs';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cjs = require('../api/ai-filter/scorer.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function group(name, fn) { console.log('\n# ' + name); fn(); }

// === Same test set as the CJS version ===

group('verdictFor (ESM)', () => {
  test('score > 25 is BLOCK',       () => assert.equal(verdictFor(25.01), 'BLOCK'));
  test('score == 25 is WARN_HIGH',  () => assert.equal(verdictFor(25),    'WARN_HIGH'));
  test('score == 10 is WARN_HIGH',  () => assert.equal(verdictFor(10),    'WARN_HIGH'));
  test('score == 9.99 is WARN_LOW', () => assert.equal(verdictFor(9.99),  'WARN_LOW'));
  test('score == 0.01 is WARN_LOW', () => assert.equal(verdictFor(0.01),  'WARN_LOW'));
  test('score == 0 is CLEAN',       () => assert.equal(verdictFor(0),     'CLEAN'));
  test('score == 80 is BLOCK',      () => assert.equal(verdictFor(80),    'BLOCK'));
});

group('applyProvenance (ESM)', () => {
  test('gen override raises to 90',      () => assert.equal(applyProvenance(20, { generative_ai_origin: true }), 90));
  test('gen override keeps higher raw',  () => assert.equal(applyProvenance(95, { generative_ai_origin: true }), 95));
  test('cam override caps at 30',        () => assert.equal(applyProvenance(70, { camera_capture_chain: true }), 30));
  test('cam override keeps lower raw',   () => assert.equal(applyProvenance(15, { camera_capture_chain: true }), 15));
  test('null c2pa is no-op',             () => assert.equal(applyProvenance(40, null), 40));
});

group('dampen (ESM)', () => {
  test('confidence 1 keeps full score',  () => assert.equal(dampen(80, 1.0), 80));
  test('confidence 0 halves score',      () => assert.equal(dampen(80, 0.0), 40));
  test('confidence 0.5 yields 60',       () => assert.equal(dampen(80, 0.5), 60));
});

group('computeWeights (ESM)', () => {
  test('text-only',          () => assert.deepEqual(computeWeights({ text_chars: 1000, n_images: 0 }), { text: 1, image: 0 }));
  test('image-only',         () => assert.deepEqual(computeWeights({ text_chars: 0, n_images: 3 }), { text: 0, image: 1 }));
  test('long article caps',  () => assert.equal(computeWeights({ text_chars: 100000, n_images: 1 }).text, 0.85));
  test('gallery floors',     () => assert.equal(computeWeights({ text_chars: 50, n_images: 10 }).text, 0.30));
  test('balanced page',      () => assert.equal(computeWeights({ text_chars: 500, n_images: 1 }).text, 0.5));
});

group('aggregateImages (ESM)', () => {
  test('empty → 0',          () => assert.equal(aggregateImages([]).score, 0));
  test('single → blend',     () => assert.equal(aggregateImages([{ ai_score: 80, confidence: 0.9, area_px: 100000 }]).score, 80));
  test('worst-of boost',     () => {
    const a = aggregateImages([
      { ai_score: 5,  confidence: 0.9, area_px: 100_000 },
      { ai_score: 5,  confidence: 0.9, area_px: 100_000 },
      { ai_score: 95, confidence: 0.9, area_px: 10_000 },
    ]);
    assert.ok(a.score > 28);
  });
  test('C2PA gen override',  () => {
    const a = aggregateImages([{ ai_score: 5, confidence: 0.5, area_px: 500_000, c2pa: { generative_ai_origin: true } }]);
    assert.ok(a.score >= 90);
  });
});

group('scorePage — verdict tiers (ESM)', () => {
  test('Example A: AI gallery → BLOCK', () => {
    const r = scorePage({
      text:   { score: 12, confidence: 0.6, chars: 200, backend: 'mock' },
      images: Array.from({ length: 4 }, () => ({ ai_score: 95, confidence: 0.9, area_px: 500_000 })),
    });
    assert.equal(r.verdict, 'BLOCK');
    assert.ok(r.aiScore >= 80);
    assert.equal(r.override, 'STRONG_SIGNAL_FLOOR');
  });
  test('Example B: human + stock image → WARN_LOW', () => {
    const r = scorePage({
      text:   { score: 3, confidence: 0.95, chars: 5000, backend: 'mock' },
      images: [{ ai_score: 40, confidence: 0.5, area_px: 200_000 }],
    });
    assert.equal(r.verdict, 'WARN_LOW');
  });
  test('Example C: text only → WARN_LOW', () => {
    const r = scorePage({ text: { score: 4, confidence: 0.9, chars: 2000, backend: 'mock' }, images: [] });
    assert.equal(r.verdict, 'WARN_LOW');
  });
  test('AI article mid-conf → WARN_HIGH', () => {
    const r = scorePage({ text: { score: 20, confidence: 0.8, chars: 3000, backend: 'mock' }, images: [] });
    assert.equal(r.verdict, 'WARN_HIGH');
  });
  test('Boundary 25.5 → BLOCK', () => {
    const r = scorePage({ text: { score: 30, confidence: 0.7, chars: 3000, backend: 'mock' }, images: [] });
    assert.equal(r.verdict, 'BLOCK');
    assert.equal(r.aiScore, 25.5);
  });
  test('Strong text signal → floor 80', () => {
    const r = scorePage({
      text:   { score: 99, confidence: 1.0, chars: 5000, backend: 'mock' },
      images: [{ ai_score: 0, confidence: 0.9, area_px: 200_000 }],
    });
    assert.ok(r.aiScore >= 80);
    assert.equal(r.verdict, 'BLOCK');
  });
  test('Zero signal → CLEAN', () => {
    const r = scorePage({ text: { score: 0, confidence: 1, chars: 100, backend: 'mock' }, images: [] });
    assert.equal(r.verdict, 'CLEAN');
  });
  test('C2PA capture beats high detector', () => {
    const r = scorePage({
      text: null,
      images: [{ ai_score: 80, confidence: 0.8, area_px: 500_000, c2pa: { camera_capture_chain: true } }],
    });
    assert.ok(r.aiScore <= 30);
  });
});

// === CROSS-PORT EQUIVALENCE ===
// Same input must produce byte-identical output from both ports.
group('Cross-port equivalence (ESM vs CJS)', () => {
  const cases = [
    { text: { score: 12, confidence: 0.6, chars: 200, backend: 'mock' },
      images: Array.from({ length: 4 }, () => ({ ai_score: 95, confidence: 0.9, area_px: 500_000 })) },
    { text: { score: 3, confidence: 0.95, chars: 5000, backend: 'mock' },
      images: [{ ai_score: 40, confidence: 0.5, area_px: 200_000 }] },
    { text: { score: 20, confidence: 0.8, chars: 3000, backend: 'mock' }, images: [] },
    { text: { score: 30, confidence: 0.7, chars: 3000, backend: 'mock' }, images: [] },
    { text: { score: 0, confidence: 1, chars: 100, backend: 'mock' }, images: [] },
    { text: null,
      images: [{ ai_score: 80, confidence: 0.8, area_px: 500_000, c2pa: { camera_capture_chain: true } }] },
    { text: { score: 50, confidence: 0.5, chars: 1234, backend: 'x' },
      images: [
        { ai_score: 60, confidence: 0.7, area_px: 300_000 },
        { ai_score: 10, confidence: 0.3, area_px: 50_000, c2pa: { generative_ai_origin: true } },
      ] },
  ];
  cases.forEach((c, i) => {
    test(`case ${i + 1}: ESM === CJS`, () => {
      const esm = scorePage(c);
      const cjsResult = cjs.scorePage(c);
      assert.deepEqual(esm, cjsResult);
    });
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
