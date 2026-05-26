/* Runtime fallthrough wrapper for text detectors.
   ----------------------------------------------------------------
   Wraps an ORDERED list of TextDetector instances and tries each
   one until a real score comes back. Records every attempt in
   raw.chain_attempts so the diagnostics popover can show which
   detector won, which fell through, and why.

   Design intent: HF / Hive can be flaky (rate limits, model
   cold-starts, endpoint deprecations, network blips). Without
   runtime fallthrough, a flaky paid backend silently kills text
   scoring entirely. With this wrapper, the always-available
   heuristic (last in the chain) guarantees we never return null
   for text — production strict mode for text-modality is now
   effectively unreachable.

   Same Detector interface, so chainTextDetectors([...]) is a
   drop-in replacement anywhere a TextDetector is expected.
*/
'use strict';

function chainTextDetectors(detectors) {
  const list = (detectors || []).filter(Boolean);
  return {
    name: 'chain:' + list.map(d => d.name).join('->'),
    modality: 'text',
    async detect(text, opts) {
      const attempts = [];
      for (const d of list) {
        try {
          const r = await d.detect(text, opts);
          attempts.push({
            backend: d.name,
            score: r.score,
            confidence: r.confidence,
            error: r.error || null,
            skipped: r.skipped || null,
          });
          if (r.score != null) {
            return {
              score: r.score,
              confidence: r.confidence,
              backend: d.name,
              raw: { ...(r.raw || {}), chain_attempts: attempts },
            };
          }
        } catch (err) {
          attempts.push({ backend: d.name, error: err.message });
        }
      }
      return {
        score: null,
        confidence: 0,
        backend: 'chain:all-failed',
        raw: { chain_attempts: attempts },
      };
    },
  };
}

module.exports = { chainTextDetectors };
