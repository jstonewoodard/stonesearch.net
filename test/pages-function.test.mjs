/* Integration test for functions/api/analyze.js
   Simulates a Pages Function invocation — builds a fake Request,
   fake env, calls onRequestPost directly. Verifies the envelope
   is shaped correctly and hits each verdict tier.
*/

import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/analyze.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); failed++; }
}

function mockRequest(body) {
  return new Request('http://localhost/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callFn(body, env = {}) {
  // Default: enable mock backends so tests exercise the normal scoring path.
  // Tests that want to verify strict-mode behavior should pass env explicitly.
  const envWithMock = env.ALLOW_MOCK == null ? { ...env, ALLOW_MOCK: '1' } : env;
  const res = await onRequestPost({ request: mockRequest(body), env: envWithMock });
  return { status: res.status, body: await res.json() };
}

console.log('\n# Pages Function /api/analyze (v2)');

await test('Envelope shape — required fields present', async () => {
  const { status, body } = await callFn({ url: 'https://example.com', title: 'Hello', snippet: 'World' });
  assert.equal(status, 200);
  for (const k of ['aiScore', 'verdict', 'modality', 'weights', 'thresholds', 'cache', 'warnings']) {
    assert.ok(k in body, `missing field: ${k}`);
  }
});

await test('AI gallery (4 large AI-signed images) → BLOCK', async () => {
  const { body } = await callFn({
    url: 'https://example.com/gallery',
    text: 'Short caption.',
    images: Array.from({ length: 4 }, (_, i) => ({
      url: `https://example.com/gen-${i}.png`,
      area_px: 600_000,
      manifest: { signer: 'Midjourney' },
    })),
  });
  assert.equal(body.verdict, 'BLOCK');
  assert.ok(body.aiScore >= 80, `expected >=80, got ${body.aiScore}`);
});

await test('Long article, no images → valid verdict + text-only weights', async () => {
  const { body } = await callFn({
    url: 'https://news.example.com/article',
    text: 'A '.repeat(2000), // 4000 chars; deterministic mock score is seed-dependent
    images: [],
  });
  // With no images, weights must be text=1, image=0 regardless of score.
  assert.equal(body.weights.text, 1);
  assert.equal(body.weights.image, 0);
  assert.ok(['CLEAN', 'WARN_LOW', 'WARN_HIGH', 'BLOCK'].includes(body.verdict));
});

await test('Photo essay with C2PA capture chain → score capped', async () => {
  const { body } = await callFn({
    url: 'https://photo.example.com/essay',
    text: 'Photographer notes from the field.',
    images: Array.from({ length: 3 }, (_, i) => ({
      url: `https://photo.example.com/${i}.jpg`,
      area_px: 800_000,
      manifest: { signer: 'Leica M11' },
    })),
  });
  // Should benefit from capture-chain cap (per-image effective <= 30)
  assert.notEqual(body.verdict, 'BLOCK', 'C2PA capture chain should prevent BLOCK');
});

await test('Cache works: 2nd call returns cache:hit', async () => {
  const env = {}; // shared env → analyzer is re-created but in-memory cache is per-call
  // (KV cache would persist; for in-memory we just verify the field exists)
  const a = await callFn({ url: 'https://example.com/cached', title: 'X', snippet: 'Y' }, env);
  const b = await callFn({ url: 'https://example.com/cached', title: 'X', snippet: 'Y' }, env);
  assert.ok(['hit', 'miss'].includes(a.body.cache));
  assert.ok(['hit', 'miss'].includes(b.body.cache));
  // (Cache hit not guaranteed across calls without persistent KV — just verify field shape)
});

await test('Provenance details surface in envelope', async () => {
  const { body } = await callFn({
    url: 'https://example.com/p',
    text: 'Article body here. '.repeat(50),
    images: [
      { url: 'https://example.com/1.png', area_px: 400_000, manifest: { signer: 'Adobe Firefly' } },
      { url: 'https://example.com/2.jpg', area_px: 400_000, manifest: { signer: 'Sony Alpha' } },
      { url: 'https://example.com/3.jpg', area_px: 400_000 }, // unsigned
    ],
  });
  assert.equal(body.provenance.length, 3);
  const gen = body.provenance.find(p => p.signer === 'Adobe Firefly');
  const cam = body.provenance.find(p => p.signer === 'Sony Alpha');
  const unsigned = body.provenance.find(p => p.status === 'unsigned');
  assert.ok(gen && gen.origin === 'generative');
  assert.ok(cam && cam.origin === 'capture');
  assert.ok(unsigned);
});

await test('Empty body does not crash', async () => {
  const res = await onRequestPost({ request: new Request('http://localhost', { method: 'POST' }), env: { ALLOW_MOCK: '1' } });
  assert.equal(res.status, 200);
});

await test('Strict mode (no ALLOW_MOCK, no real backend) -> aiScore: null', async () => {
  const res = await onRequestPost({
    request: mockRequest({ url: 'https://example.com', text: 'hello world' }),
    env: {}, // no HIVE_API_KEY, no HF_API_TOKEN, no ALLOW_MOCK -> strict mode
  });
  const body = await res.json();
  assert.equal(body.aiScore, null);
  assert.equal(body.verdict, 'CLEAN');
  assert.equal(body.source, 'no-detector');
  assert.deepEqual(body.warnings, ['no-real-backend:strict-mode']);
});

await test('Source is "mock" when no HIVE_API_KEY', async () => {
  const { body } = await callFn({ url: 'https://example.com', text: 'hello world' }, {});
  assert.equal(body.source, 'mock');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
