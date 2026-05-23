/* Unit tests for the pure scoring module.
   Run with:  node test/scorer.test.js
   No test framework — just assertions. Exits non-zero on failure.
*/
'use strict';

const assert = require('node:assert/strict');
const {
  scorePage, verdictFor, aggregateImages, computeWeights, applyProvenance, dampen,
  THRESHOLDS, STRONG_SIGNAL_FLOOR,
} = require('../api/ai-filter/scorer.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function group(name, fn) { console.log('\n# ' + name); fn(); }

// ===== verdictFor =====
group('verdictFor', () => {
  test('score > 25 is BLOCK',            () => assert.equal(verdictFor(25.01), 'BLOCK'));
  test('score == 25 is WARN_HIGH',       () => assert.equal(verdictFor(25),    'WARN_HIGH'));
  test('score == 10 is WARN_HIGH',       () => assert.equal(verdictFor(10),    'WARN_HIGH'));
  test('score == 9.99 is WARN_LOW',      () => assert.equal(verdictFor(9.99),  'WARN_LOW'));
  test('score == 0.01 is WARN_LOW',      () => assert.equal(verdictFor(0.01),  'WARN_LOW'));
  test('score == 0 is CLEAN',            () => assert.equal(verdictFor(0),     'CLEAN'));
  test('score == 80 is BLOCK',           () => assert.equal(verdictFor(80),    'BLOCK'));
});

// ===== applyProvenance =====
group('applyProvenance', () => {
  test('generative override raises score to 90',     () => assert.equal(applyProvenance(20, { generative_ai_origin: true }), 90));
  test('generative override keeps higher raw',       () => assert.equal(applyProvenance(95, { generative_ai_origin: true }), 95));
  test('camera override caps score at 30',           () => assert.equal(applyProvenance(70, { camera_capture_chain: true }), 30));
  test('camera override keeps lower raw',            () => assert.equal(applyProvenance(15, { camera_capture_chain: true }), 15));
  test('null c2pa is no-op',                         () => assert.equal(applyProvenance(40, null), 40));
});

// ===== dampen =====
group('dampen', () => {
  test('confidence 1 keeps full score',  () => assert.equal(dampen(80, 1.0), 80));
  test('confidence 0 halves score',      () => assert.equal(dampen(80, 0.0), 40));
  test('confidence 0.5 yields 75% score',() => assert.equal(dampen(80, 0.5), 60));
});

// ===== computeWeights =====
group('computeWeights', () => {
  test('text-only page gets W_text=1', () => {
    assert.deepEqual(computeWeights({ text_chars: 1000, n_images: 0 }), { text: 1, image: 0 });
  });
  test('image-only page gets W_image=1', () => {
    assert.deepEqual(computeWeights({ text_chars: 0, n_images: 3 }), { text: 0, image: 1 });
  });
  test('text dominates long article (caps at 0.85)', () => {
    const w = computeWeights({ text_chars: 100000, n_images: 1 });
    assert.equal(w.text, 0.85);
  });
  test('images dominate gallery (floor at 0.30)', () => {
    const w = computeWeights({ text_chars: 50, n_images: 10 });
    assert.equal(w.text, 0.30);
  });
  test('balanced page is balanced', () => {
    const w = computeWeights({ text_chars: 500, n_images: 1 });
    assert.equal(w.text, 0.5);
  });
});

// ===== aggregateImages =====
group('aggregateImages', () => {
  test('empty list -> zero score', () => {
    const a = aggregateImages([]);
    assert.equal(a.score, 0);
    assert.equal(a.count, 0);
  });
  test('single image: score = blend of mean and max (identical)', () => {
    const a = aggregateImages([{ ai_score: 80, confidence: 0.9, area_px: 100000 }]);
    assert.equal(a.score, 80);
    assert.equal(a.max_effective, 80);
  });
  test('worst-of override: one tiny AI image among small humans still nudges score', () => {
    const a = aggregateImages([
      { ai_score: 5,  confidence: 0.9, area_px: 100_000 },
      { ai_score: 5,  confidence: 0.9, area_px: 100_000 },
      { ai_score: 95, confidence: 0.9, area_px: 10_000 }, // tiny but very AI
    ]);
    // mean is ~ (5+5+~95*tinyweight)/total ~ closer to 5
    // max = 95, so score = 0.7*mean + 0.3*95 must be > 28
    assert.ok(a.score > 28, `expected > 28, got ${a.score}`);
  });
  test('C2PA generative-AI override raises image score to >=90 even if detector said low', () => {
    const a = aggregateImages([
      { ai_score: 5, confidence: 0.5, area_px: 500_000, c2pa: { generative_ai_origin: true } },
    ]);
    assert.ok(a.score >= 90, `expected >=90, got ${a.score}`);
  });
});

// ===== scorePage end-to-end =====
group('scorePage — verdict tiers', () => {

  test('Example A: image-heavy AI gallery -> BLOCK', () => {
    const result = scorePage({
      text:   { score: 12, confidence: 0.6, chars: 200, backend: 'mock' },
      images: Array.from({ length: 4 }, () => ({ ai_score: 95, confidence: 0.9, area_px: 500_000 })),
    });
    assert.equal(result.verdict, 'BLOCK');
    assert.ok(result.aiScore >= 80, `expected aiScore>=80, got ${result.aiScore}`);
    assert.equal(result.override, 'STRONG_SIGNAL_FLOOR');
  });

  test('Example B: human article + 1 stock image -> WARN_LOW', () => {
    const result = scorePage({
      text:   { score: 3, confidence: 0.95, chars: 5000, backend: 'mock' },
      images: [{ ai_score: 40, confidence: 0.5, area_px: 200_000 }],
    });
    assert.equal(result.verdict, 'WARN_LOW');
    assert.ok(result.aiScore > 0 && result.aiScore < 10, `expected 0<score<10, got ${result.aiScore}`);
  });

  test('Example C: human text only -> WARN_LOW (small but nonzero)', () => {
    const result = scorePage({
      text:   { score: 4, confidence: 0.9, chars: 2000, backend: 'mock' },
      images: [],
    });
    assert.equal(result.verdict, 'WARN_LOW');
  });

  test('AI article, mid-confidence -> WARN_HIGH', () => {
    const result = scorePage({
      text:   { score: 30, confidence: 0.7, chars: 3000, backend: 'mock' },
      images: [],
    });
    assert.equal(result.verdict, 'WARN_HIGH');
    assert.ok(result.aiScore >= 10 && result.aiScore <= 25, `expected 10-25, got ${result.aiScore}`);
  });

  test('Strong text signal -> override floors to 80 (BLOCK)', () => {
    const result = scorePage({
      text:   { score: 99, confidence: 1.0, chars: 5000, backend: 'mock' },
      images: [{ ai_score: 0, confidence: 0.9, area_px: 200_000 }],
    });
    assert.ok(result.aiScore >= 80, `expected aiScore>=80, got ${result.aiScore}`);
    assert.equal(result.verdict, 'BLOCK');
  });

  test('Zero signal -> CLEAN', () => {
    const result = scorePage({ text: { score: 0, confidence: 1, chars: 100, backend: 'mock' }, images: [] });
    assert.equal(result.verdict, 'CLEAN');
    assert.equal(result.aiScore, 0);
  });

  test('C2PA verified-capture beats high detector score', () => {
    const result = scorePage({
      text:   null,
      images: [
        { ai_score: 80, confidence: 0.8, area_px: 500_000, c2pa: { camera_capture_chain: true } },
      ],
    });
    // detector says AI, but capture-chain caps it at 30 -> WARN_HIGH at worst
    assert.ok(result.aiScore <= 30, `expected aiScore<=30, got ${result.aiScore}`);
  });
});

// ===== Summary =====
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
