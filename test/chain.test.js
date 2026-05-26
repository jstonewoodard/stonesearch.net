/* Tests for chainTextDetectors() — the runtime fallthrough wrapper that
   fixes the production bug where HF returning null killed text scoring.
*/
'use strict';

const assert = require('node:assert/strict');
const { chainTextDetectors } = require('../api/ai-filter/backends/chain.js');
const { textHeuristic } = require('../api/ai-filter/backends/text-heuristic.js');
const textMock = require('../api/ai-filter/backends/text-mock.js');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
const group = async (name, fn) => { console.log('\n# ' + name); await fn(); };

// Fake detectors so we can simulate failure modes deterministically
const alwaysNull = (name, error) => ({
  name, modality: 'text',
  async detect() { return { score: null, confidence: 0, backend: name, error }; },
});
const alwaysScores = (name, score) => ({
  name, modality: 'text',
  async detect() { return { score, confidence: 0.9, backend: name }; },
});
const alwaysThrows = (name, msg) => ({
  name, modality: 'text',
  async detect() { throw new Error(msg); },
});

(async () => {

await group('Basic chain behavior', async () => {
  await test('First detector wins when it returns a score', async () => {
    const chain = chainTextDetectors([
      alwaysScores('first', 42),
      alwaysScores('second', 99),
    ]);
    const r = await chain.detect('text');
    assert.equal(r.score, 42);
    assert.equal(r.backend, 'first');
  });

  await test('Falls through past null', async () => {
    const chain = chainTextDetectors([
      alwaysNull('hf-dead', 'endpoint-404'),
      alwaysScores('heuristic', 18),
    ]);
    const r = await chain.detect('text');
    assert.equal(r.score, 18);
    assert.equal(r.backend, 'heuristic');
  });

  await test('Falls through past thrown error', async () => {
    const chain = chainTextDetectors([
      alwaysThrows('flaky', 'timeout'),
      alwaysScores('heuristic', 5),
    ]);
    const r = await chain.detect('text');
    assert.equal(r.score, 5);
    assert.equal(r.backend, 'heuristic');
  });

  await test('All-failed returns null with attempts recorded', async () => {
    const chain = chainTextDetectors([
      alwaysNull('a', 'reason-a'),
      alwaysNull('b', 'reason-b'),
    ]);
    const r = await chain.detect('text');
    assert.equal(r.score, null);
    assert.equal(r.backend, 'chain:all-failed');
    assert.equal(r.raw.chain_attempts.length, 2);
    assert.equal(r.raw.chain_attempts[0].error, 'reason-a');
  });

  await test('Chain name lists all detectors in order', () => {
    const chain = chainTextDetectors([
      alwaysScores('hf-text:foo', 1),
      alwaysScores('hive-text', 2),
      alwaysScores('text-heuristic', 3),
    ]);
    assert.equal(chain.name, 'chain:hf-text:foo->hive-text->text-heuristic');
  });

  await test('chain_attempts records every step up to the win', async () => {
    const chain = chainTextDetectors([
      alwaysNull('hf', 'rate-limit'),
      alwaysNull('hive', 'no-key'),
      alwaysScores('heuristic', 22),
    ]);
    const r = await chain.detect('text');
    assert.equal(r.score, 22);
    assert.equal(r.raw.chain_attempts.length, 3);
    assert.equal(r.raw.chain_attempts[0].backend, 'hf');
    assert.equal(r.raw.chain_attempts[0].error, 'rate-limit');
    assert.equal(r.raw.chain_attempts[1].backend, 'hive');
    assert.equal(r.raw.chain_attempts[2].backend, 'heuristic');
    assert.equal(r.raw.chain_attempts[2].score, 22);
  });

  await test('Empty chain returns null cleanly', async () => {
    const chain = chainTextDetectors([]);
    const r = await chain.detect('text');
    assert.equal(r.score, null);
    assert.equal(r.backend, 'chain:all-failed');
  });

  await test('Filters out undefined/null entries in the list', async () => {
    const chain = chainTextDetectors([undefined, null, alwaysScores('x', 7)]);
    const r = await chain.detect('text');
    assert.equal(r.score, 7);
    assert.equal(r.backend, 'x');
  });
});

await group('Production-realistic chain (the regression fix)', async () => {
  await test('HF dead → heuristic catches with a real score', async () => {
    const chain = chainTextDetectors([
      alwaysNull('hf-text:Hello-SimpleAI/chatgpt-detector-roberta', 'unparsed-response'),
      textHeuristic,  // the real one — always succeeds on long text
    ]);
    const longText = 'In conclusion, it\'s important to note the comprehensive landscape — moreover, the profound paradigm. '.repeat(8);
    const r = await chain.detect(longText);
    assert.notEqual(r.score, null, 'chain must not return null when heuristic is present');
    assert.equal(r.backend, 'text-heuristic');
    assert.ok(r.raw.chain_attempts[0].backend.startsWith('hf-text:'));
    assert.equal(r.raw.chain_attempts[0].error, 'unparsed-response');
  });

  await test('HF works → no fallthrough, no heuristic call', async () => {
    let heuristicCalled = false;
    const spyHeuristic = {
      ...textHeuristic,
      async detect(t) { heuristicCalled = true; return textHeuristic.detect(t); },
    };
    const chain = chainTextDetectors([
      alwaysScores('hf-text:foo', 73),
      spyHeuristic,
    ]);
    const r = await chain.detect('text');
    assert.equal(r.score, 73);
    assert.equal(heuristicCalled, false, 'should not call subsequent detectors after a win');
  });

  await test('Heuristic-only chain still works (no HF/Hive configured)', async () => {
    const chain = chainTextDetectors([textHeuristic]);
    const longText = 'In conclusion, it\'s important to note the comprehensive landscape — moreover, the profound paradigm. '.repeat(8);
    const r = await chain.detect(longText);
    assert.notEqual(r.score, null);
    assert.equal(r.backend, 'text-heuristic');
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
})();
