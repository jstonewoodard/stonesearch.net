/* ============================================================
   Stone Search — Text detector: in-Worker heuristic ensemble
   ------------------------------------------------------------
   Path 1 of the in-house detection stack. Combines 9 cheap
   statistical / stylometric signals into a single 0-100 AI
   likelihood score. Pure JavaScript, zero dependencies, zero
   marginal cost — runs in the Worker isolate.

   Signals (weights sum to 1.0):
     llmTells       0.25  — vocabulary fingerprint of LLM training data
                            ("delve", "tapestry", "navigate the landscape",
                            "it's important to note", etc.)
     burstiness     0.15  — stdev of sentence word counts (low = AI)
     emDash         0.15  — em-dash density per 1k words (high = AI)
     conclusion     0.10  — "in conclusion", "to summarize", etc.
     starterRepeat  0.10  — fraction of sentences starting with same word
     transition     0.10  — "however", "moreover", "furthermore" density
     parallelism    0.05  — numbered/bullet list density
     hedging        0.05  — "it's worth noting", "that said", etc.
     vocab          0.05  — fraction of long words (proxy for register)

   This is not as accurate as a fine-tuned RoBERTa (target ~75-80%
   vs Hive's ~95%), but it has three properties Hive/HF don't:
     (1) zero per-request cost
     (2) zero data egress (text never leaves the Worker)
     (3) always-available — no rate limit, no API outage
   Used as the production fallback when no paid backend is configured.

   Math is intentionally simple so the three runtime ports
   (CJS, ESM, TS) stay byte-identical and cross-port-verifiable.
   ============================================================ */
'use strict';

// ----- Signal vocabularies (frozen) -----------------------------------------

const LLM_TELLS = Object.freeze([
  // Lexical
  'delve', 'delving', 'tapestry', 'landscape', 'realm', 'embark', 'embarking',
  'leverage', 'leveraging', 'harness', 'harnessing', 'foster', 'fostering',
  'robust', 'comprehensive', 'intricate', 'intricacies', 'profound',
  'multifaceted', 'paradigm', 'holistic', 'navigate', 'navigating',
  'underscore', 'underscores', 'underscoring', 'pivotal', 'crucial',
  'invaluable', 'meticulous', 'meticulously', 'streamline', 'streamlining',
  // Phrasal
  'it\'s important to note', 'it\'s worth noting', 'it\'s worth mentioning',
  'in this article', 'in this post', 'let\'s dive', 'let\'s explore',
  'navigate the landscape', 'in the realm of', 'in the world of',
  'harness the power', 'foster a sense', 'play a crucial role',
  'a testament to', 'stand the test of time', 'in today\'s digital age',
  'in conclusion', 'to summarize', 'in summary',
  // Chat-style preambles
  'certainly!', 'absolutely!', 'great question', 'i\'d be happy to help',
  'here\'s a', 'here are some',
]);

const CONCLUSION_MARKERS = Object.freeze([
  'in conclusion', 'to summarize', 'to conclude', 'in summary', 'overall,',
  'ultimately,', 'to wrap up', 'in closing', 'final thoughts', 'all in all',
  'to sum up',
]);

const TRANSITION_WORDS = Object.freeze([
  'however', 'moreover', 'furthermore', 'additionally', 'consequently',
  'therefore', 'thus', 'hence', 'indeed', 'notably', 'specifically',
  'particularly', 'similarly', 'likewise', 'nonetheless', 'nevertheless',
  'subsequently', 'accordingly',
]);

const HEDGING_PHRASES = Object.freeze([
  'it\'s worth noting', 'it\'s important to note', 'that said',
  'having said that', 'with that in mind', 'it\'s important to remember',
  'keep in mind', 'on the other hand', 'while it\'s true',
]);

// ----- Tokenization helpers --------------------------------------------------

function sentences(text) {
  // Split on .!? followed by whitespace or EOL. Keeps newlines as boundaries.
  // Filter out trivial fragments.
  return String(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function words(text) {
  // Split on whitespace + punctuation; lowercase.
  return String(text).toLowerCase().match(/[a-z0-9'\-]+/g) || [];
}

// ----- Individual signals ---------------------------------------------------
// Each returns a number in [0, 1]; 1 = stronger AI indicator.

function scoreLLMTells(textLower, wordCount) {
  if (wordCount === 0) return 0;
  let hits = 0;
  for (const tell of LLM_TELLS) {
    // Phrase or word: count overlapping occurrences.
    const re = new RegExp(`(?:^|[^a-z])${escapeRx(tell)}(?:[^a-z]|$)`, 'g');
    const m = textLower.match(re);
    if (m) hits += m.length;
  }
  const perThousand = (hits / wordCount) * 1000;
  // 5 hits per 1k words → max signal
  return clamp(perThousand / 5, 0, 1);
}

function scoreEmDash(text, wordCount) {
  if (wordCount === 0) return 0;
  // Real em-dash, en-dash, or double hyphen
  const m = text.match(/—|–|--/g);
  const count = m ? m.length : 0;
  const perThousand = (count / wordCount) * 1000;
  // Human baseline ~2/1k, AI typically 8-20+. Map [2, 18] → [0, 1].
  return clamp((perThousand - 2) / 16, 0, 1);
}

function scoreConclusion(textLower) {
  let hits = 0;
  for (const m of CONCLUSION_MARKERS) {
    if (textLower.indexOf(m) !== -1) hits += 1;
  }
  // Even one conclusion marker is mildly suspicious; two+ is strong.
  return clamp(hits / 2, 0, 1);
}

function scoreBurstiness(sents) {
  if (sents.length < 4) return 0; // not enough data
  const lengths = sents.map(s => (s.match(/\S+/g) || []).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length;
  const stdev = Math.sqrt(variance);
  // Map [3, 13] stdev → [1, 0]. Low stdev = AI-like (uniform sentence length).
  return clamp(1 - (stdev - 3) / 10, 0, 1);
}

function scoreStarterRepeat(sents) {
  if (sents.length < 5) return 0;
  const starters = {};
  for (const s of sents) {
    const first = (s.match(/^\S+/) || [''])[0].toLowerCase();
    if (!first) continue;
    starters[first] = (starters[first] || 0) + 1;
  }
  const counts = Object.values(starters);
  if (counts.length === 0) return 0;
  const maxFreq = Math.max(...counts) / sents.length;
  // 10% same-starter is normal; 30%+ is AI-ish.
  return clamp((maxFreq - 0.10) / 0.20, 0, 1);
}

function scoreTransition(textLower, wordCount) {
  if (wordCount === 0) return 0;
  let hits = 0;
  for (const w of TRANSITION_WORDS) {
    const re = new RegExp(`(?:^|[^a-z])${w}(?:[^a-z]|$)`, 'g');
    const m = textLower.match(re);
    if (m) hits += m.length;
  }
  const perHundred = (hits / wordCount) * 100;
  // 2 per 100 words = max signal
  return clamp(perHundred / 2, 0, 1);
}

function scoreHedging(textLower) {
  let hits = 0;
  for (const h of HEDGING_PHRASES) {
    if (textLower.indexOf(h) !== -1) hits += 1;
  }
  return clamp(hits / 3, 0, 1);
}

function scoreParallelism(text) {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 4) return 0;
  let listish = 0;
  for (const l of lines) {
    if (/^(\d+\.\s|[-*•·]\s)/.test(l)) listish += 1;
  }
  // 30% of lines being list items = max signal
  const fraction = listish / lines.length;
  return clamp(fraction / 0.30, 0, 1);
}

function scoreVocab(wordList) {
  if (wordList.length < 50) return 0;
  let longWords = 0;
  for (const w of wordList) {
    if (w.length >= 7) longWords += 1;
  }
  const ratio = longWords / wordList.length;
  // Human: ~0.20; AI: ~0.30+. Map [0.20, 0.35] → [0, 1].
  return clamp((ratio - 0.20) / 0.15, 0, 1);
}

// ----- Main detector --------------------------------------------------------

const WEIGHTS = Object.freeze({
  llmTells:      0.25,
  burstiness:    0.15,
  emDash:        0.15,
  conclusion:    0.10,
  starterRepeat: 0.10,
  transition:    0.10,
  parallelism:   0.05,
  hedging:       0.05,
  vocab:         0.05,
});

function detectText(text) {
  const t = String(text || '');
  const textLower = t.toLowerCase();
  const sents = sentences(t);
  const wordList = words(t);
  const wordCount = wordList.length;

  const signals = {
    llmTells:      scoreLLMTells(textLower, wordCount),
    burstiness:    scoreBurstiness(sents),
    emDash:        scoreEmDash(t, wordCount),
    conclusion:    scoreConclusion(textLower),
    starterRepeat: scoreStarterRepeat(sents),
    transition:    scoreTransition(textLower, wordCount),
    parallelism:   scoreParallelism(t),
    hedging:       scoreHedging(textLower),
    vocab:         scoreVocab(wordList),
  };

  // Weighted sum
  let aggregate = 0;
  for (const k of Object.keys(WEIGHTS)) aggregate += signals[k] * WEIGHTS[k];
  const score = Math.round(aggregate * 1000) / 10; // 0-100, one decimal

  // Confidence rises with text length and signal agreement.
  // Short text → low confidence; signals all-agreeing → higher confidence.
  const lengthConf = clamp(t.length / 2000, 0.4, 1.0);
  const sigValues = Object.values(signals);
  const sigMean = sigValues.reduce((a, b) => a + b, 0) / sigValues.length;
  const sigVar = sigValues.reduce((a, b) => a + (b - sigMean) ** 2, 0) / sigValues.length;
  const sigStdev = Math.sqrt(sigVar);
  const agreement = clamp(1 - sigStdev * 2, 0, 1);
  const confidence = Math.round((lengthConf * (0.7 + 0.3 * agreement)) * 100) / 100;

  return { score, confidence, signals };
}

// ----- Detector interface ---------------------------------------------------

const textHeuristic = {
  name: 'text-heuristic',
  modality: 'text',
  async detect(text) {
    const r = detectText(text);
    return {
      score: r.score,
      confidence: r.confidence,
      backend: 'text-heuristic',
      raw: { signals: r.signals, word_count: words(text).length, sentence_count: sentences(text).length },
    };
  },
};

// ----- helpers --------------------------------------------------------------
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = { textHeuristic, detectText, WEIGHTS, LLM_TELLS };
