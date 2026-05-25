/* Tests for strict mode (fail-loud when no real backend) and the new
   Hugging Face backend's response parser.
*/
'use strict';

const assert = require('node:assert/strict');
const { createAnalyzer } = require('../api/ai-filter');
const textMock = require('../api/ai-filter/backends/text-mock.js');
const imageMock = require('../api/ai-filter/backends/image-mock.js');
const textHive = require('../api/ai-filter/backends/text-hive.js');
const { makeTextHuggingFace, extractHFScore } = require('../api/ai-filter/backends/text-huggingface.js');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
const group = async (name, fn) => { console.log('\n# ' + name); await fn(); };

(async () => {
// ===== strict mode =====
await group('strict mode (fail-loud when no real backend)', async () => {

  await test('strict + both mocks -> aiScore: null, verdict: CLEAN, warning', async () => {
    const analyzer = createAnalyzer({ textBackend: textMock, imageBackend: imageMock, strict: true });
    const env = await analyzer.analyze({ url: 'https://example.com', text: 'hello world', images: [] });
    assert.equal(env.aiScore, null);
    assert.equal(env.verdict, 'CLEAN');
    assert.equal(env.source, 'no-detector');
    assert.deepEqual(env.warnings, ['no-real-backend:strict-mode']);
    assert.deepEqual(env.modality, { text: null, image: null });
    assert.deepEqual(env.weights, { text: 0, image: 0 });
  });

  await test('NOT strict + both mocks -> normal mock score (back-compat)', async () => {
    const analyzer = createAnalyzer({ textBackend: textMock, imageBackend: imageMock });
    const env = await analyzer.analyze({ url: 'https://example.com', text: 'hello world', images: [] });
    assert.notEqual(env.aiScore, null);
    assert.ok(['BLOCK', 'WARN_HIGH', 'WARN_LOW', 'CLEAN'].includes(env.verdict));
    assert.equal(env.source, 'mock');
  });

  await test('strict + real text backend present -> proceeds normally', async () => {
    // textHive without an env key returns score:null at runtime, but the
    // backend's `name` is "hive-text" (not in MOCK_BACKEND_NAMES), so the
    // strict-mode gate does NOT trip.
    const analyzer = createAnalyzer({ textBackend: textHive, imageBackend: imageMock, strict: true });
    const env = await analyzer.analyze({ url: 'https://example.com', text: 'hello world', images: [] });
    // aiScore can be 0 or a number — what matters is we DIDN'T short-circuit.
    assert.notEqual(env.source, 'no-detector');
    assert.notDeepEqual(env.warnings, ['no-real-backend:strict-mode']);
  });

  await test('strict + no detectors at all -> aiScore: null', async () => {
    const analyzer = createAnalyzer({ strict: true });
    const env = await analyzer.analyze({ url: 'https://example.com', text: 'x', images: [] });
    assert.equal(env.aiScore, null);
    assert.equal(env.source, 'no-detector');
  });
});

// ===== Hugging Face response parser =====
await group('Hugging Face response parser', async () => {

  await test('Nested array [[{label,score}]] -> picks AI label', () => {
    const r = extractHFScore([[{ label: 'AI', score: 0.93 }, { label: 'Human', score: 0.07 }]]);
    assert.equal(r.score, 93);
    assert.ok(r.confidence > 0.85);
  });

  await test('Flat array [{label,score}] -> picks AI label', () => {
    const r = extractHFScore([{ label: 'fake', score: 0.61 }, { label: 'real', score: 0.39 }]);
    assert.equal(r.score, 61.0);
  });

  await test('Label "ChatGPT" matches AI regex', () => {
    const r = extractHFScore([{ label: 'ChatGPT', score: 0.8 }, { label: 'Human', score: 0.2 }]);
    assert.equal(r.score, 80);
  });

  await test('Error envelope returns score=null with error', () => {
    const r = extractHFScore({ error: 'Model not found' });
    assert.equal(r.score, null);
    assert.equal(r.error, 'Model not found');
  });

  await test('No AI-labeled class -> returns score=null', () => {
    const r = extractHFScore([{ label: 'cat', score: 0.6 }, { label: 'dog', score: 0.4 }]);
    assert.equal(r.score, null);
    assert.equal(r.error, 'no-ai-label-found');
  });

  await test('Unexpected shape -> returns score=null', () => {
    const r = extractHFScore({ unrelated: true });
    assert.equal(r.score, null);
    assert.equal(r.error, 'unexpected-shape');
  });

  await test('Confidence: 50/50 -> conf=0.5; 99/1 -> conf=~1.0', () => {
    const r50 = extractHFScore([{ label: 'AI', score: 0.5 }, { label: 'Human', score: 0.5 }]);
    const r99 = extractHFScore([{ label: 'AI', score: 0.99 }, { label: 'Human', score: 0.01 }]);
    assert.equal(r50.confidence, 0.5);
    assert.ok(r99.confidence >= 0.98);
  });
});

// ===== HF backend with no token (skip path) =====
await group('HF backend (no token)', async () => {
  await test('No token -> returns skipped: no-api-token', async () => {
    const backend = makeTextHuggingFace(undefined);
    const r = await backend.detect('hello world');
    assert.equal(r.score, null);
    assert.equal(r.skipped, 'no-api-token');
    assert.equal(r.backend, backend.name);
  });

  await test('Backend name includes model id', () => {
    const def = makeTextHuggingFace('fake');
    const custom = makeTextHuggingFace('fake', 'roberta-large-openai-detector');
    assert.ok(def.name.startsWith('hf-text:'));
    assert.equal(custom.name, 'hf-text:roberta-large-openai-detector');
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
})();
