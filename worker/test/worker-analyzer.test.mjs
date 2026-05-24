/* Worker analyzer tests — runs the compiled TypeScript modules in Node.
   Mirrors stonesearch.net/test/scorer.esm.test.mjs to prove the
   Worker port (TS) produces byte-identical envelopes to the Pages
   Function port (ESM) and the local dev port (CJS).

   Run (from stonesearch/):
     npm exec --package=typescript -- tsc -p test/tsconfig.test.json
     node test/worker-analyzer.test.mjs
*/

import assert from 'node:assert/strict';
import {
  scorePage, verdictFor, aggregateImages, computeWeights, applyProvenance, dampen,
} from './build/ai-filter/scorer.js';
import { textMock, imageMock, verifyProvenance } from './build/ai-filter/backends.js';
import { createAnalyzer, MemoryCache } from './build/ai-filter/analyzer.js';

// Cross-port reference: the ESM port from stonesearch.net/
import { scorePage as scorePageESM } from '../../stonesearch.net/functions/_lib/ai-filter/scorer.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
const group = (name, fn) => { console.log('\n# ' + name); return fn(); };

// ===== Pure scorer =====
await group('verdictFor (Worker TS)', async () => {
  await test('score > 25 is BLOCK',  () => assert.equal(verdictFor(25.01), 'BLOCK'));
  await test('score == 10 → WARN_HIGH', () => assert.equal(verdictFor(10), 'WARN_HIGH'));
  await test('score == 9.99 → WARN_LOW', () => assert.equal(verdictFor(9.99), 'WARN_LOW'));
  await test('score == 0 → CLEAN', () => assert.equal(verdictFor(0), 'CLEAN'));
});

await group('applyProvenance (Worker TS)', async () => {
  await test('gen → max(_, 90)', () => assert.equal(applyProvenance(20, { generative_ai_origin: true }), 90));
  await test('cam → min(_, 30)', () => assert.equal(applyProvenance(70, { camera_capture_chain: true }), 30));
});

await group('aggregateImages (Worker TS)', async () => {
  await test('empty → 0', () => assert.equal(aggregateImages([]).score, 0));
  await test('C2PA gen override', () => {
    const a = aggregateImages([{ ai_score: 5, confidence: 0.5, area_px: 500_000, c2pa: { generative_ai_origin: true } }]);
    assert.ok(a.score >= 90);
  });
});

await group('scorePage tiers (Worker TS)', async () => {
  await test('Example A: AI gallery → BLOCK', () => {
    const r = scorePage({
      text:   { score: 12, confidence: 0.6, chars: 200, backend: 'mock' },
      images: Array.from({ length: 4 }, () => ({ ai_score: 95, confidence: 0.9, area_px: 500_000 })),
    });
    assert.equal(r.verdict, 'BLOCK');
    assert.equal(r.override, 'STRONG_SIGNAL_FLOOR');
  });
  await test('Boundary 25.5 → BLOCK', () => {
    const r = scorePage({ text: { score: 30, confidence: 0.7, chars: 3000, backend: 'mock' }, images: [] });
    assert.equal(r.aiScore, 25.5);
    assert.equal(r.verdict, 'BLOCK');
  });
  await test('Zero signal → CLEAN', () => {
    const r = scorePage({ text: { score: 0, confidence: 1, chars: 100, backend: 'mock' }, images: [] });
    assert.equal(r.verdict, 'CLEAN');
  });
});

// ===== CROSS-PORT EQUIVALENCE: TS Worker port === ESM Pages Function port =====
await group('Cross-port equivalence (Worker TS === Pages Function ESM)', async () => {
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
  for (let i = 0; i < cases.length; i++) {
    await test(`case ${i + 1}: TS === ESM`, () => {
      const ts  = scorePage(cases[i]);
      const esm = scorePageESM(cases[i]);
      assert.deepEqual(ts, esm);
    });
  }
});

// ===== Orchestrator integration =====
await group('Worker analyzer (mock backends, in-memory cache)', async () => {
  const analyzer = createAnalyzer({ textBackend: textMock, imageBackend: imageMock, cache: new MemoryCache() });

  await test('Returns full envelope', async () => {
    const env = await analyzer.analyze({
      url: 'https://example.com/x',
      text: 'Article body. '.repeat(50),
      images: [{ url: 'https://example.com/img1.jpg', area_px: 400_000 }],
    });
    for (const k of ['aiScore', 'verdict', 'modality', 'weights', 'thresholds', 'cache', 'warnings', 'provenance']) {
      assert.ok(k in env, `missing field: ${k}`);
    }
  });

  await test('AI gallery (4 large Midjourney-signed) → BLOCK', async () => {
    const env = await analyzer.analyze({
      url: 'https://example.com/g',
      text: 'short caption',
      images: Array.from({ length: 4 }, (_, i) => ({
        url: `https://example.com/g/${i}.png`,
        area_px: 600_000,
        manifest: { signer: 'Midjourney' },
      })),
    });
    assert.equal(env.verdict, 'BLOCK');
    assert.ok(env.aiScore >= 80, `expected >=80, got ${env.aiScore}`);
  });

  await test('C2PA capture chain caps image score at 30', async () => {
    // Verify the image-modality side specifically — the cap proves C2PA
    // ran. (Page verdict still depends on text, which the deterministic
    // mock could push high; that's a separate signal.)
    const env = await analyzer.analyze({
      url: 'https://photo.example.com/e',
      text: 'photographer field notes from the morning shoot ',
      images: Array.from({ length: 3 }, (_, i) => ({
        url: `https://photo.example.com/e/${i}.jpg`,
        area_px: 800_000,
        manifest: { signer: 'Leica M11' },
      })),
    });
    assert.ok(env.modality.image !== null);
    assert.ok(
      env.modality.image.max_effective <= 30,
      `expected image max_effective <=30 (C2PA cap), got ${env.modality.image.max_effective}`
    );
    // All three provenance results should be verified-capture.
    assert.equal(env.provenance.length, 3);
    for (const p of env.provenance) assert.equal(p.origin, 'capture');
  });

  await test('Provenance details surface in envelope', async () => {
    const env = await analyzer.analyze({
      url: 'https://example.com/p',
      text: 'mixed page '.repeat(30),
      images: [
        { url: 'https://example.com/p/1.png', area_px: 400_000, manifest: { signer: 'Adobe Firefly' } },
        { url: 'https://example.com/p/2.jpg', area_px: 400_000 },
      ],
    });
    assert.equal(env.provenance.length, 2);
    assert.ok(env.provenance.some(p => p.origin === 'generative'));
    assert.ok(env.provenance.some(p => p.status === 'unsigned'));
  });

  await test('Cache hit on second call', async () => {
    const a = await analyzer.analyze({ url: 'https://example.com/cache', text: 'hello world', images: [] });
    const b = await analyzer.analyze({ url: 'https://example.com/cache', text: 'hello world', images: [] });
    assert.equal(a.cache, 'miss');
    assert.equal(b.cache, 'hit');
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
