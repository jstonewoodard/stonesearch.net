/* End-to-end demo of the AI filter.
   Constructs a handful of synthetic search results that exercise
   each verdict tier and prints the analyzer envelope.

   Run with:  node test/demo.js
*/
'use strict';

const { createAnalyzer } = require('../api/ai-filter');
const textMock  = require('../api/ai-filter/backends/text-mock.js');
const imageMock = require('../api/ai-filter/backends/image-mock.js');
const { scorePage } = require('../api/ai-filter/scorer.js');

// --- Synthetic cases ---------------------------------------------------------
// These bypass the fetcher so we can guarantee each tier is exercised.
const cases = [
  {
    label: 'AI gallery (heavy images, all signed by Midjourney)',
    text:   { score: 12, confidence: 0.6, chars: 200, backend: 'demo' },
    images: Array.from({ length: 4 }, (_, i) => ({
      ai_score: 92, confidence: 0.9, area_px: 600_000,
      c2pa: { generative_ai_origin: true },
      url: `https://example.com/gen-${i}.png`,
    })),
  },
  {
    label: 'Likely AI article (mid-length, moderate confidence)',
    text:   { score: 28, confidence: 0.75, chars: 3000, backend: 'demo' },
    images: [],
  },
  {
    label: 'Mostly-human article with one stock illustration',
    text:   { score: 4, confidence: 0.95, chars: 5000, backend: 'demo' },
    images: [{ ai_score: 40, confidence: 0.5, area_px: 200_000 }],
  },
  {
    label: 'Pure-human text article (no images, low score)',
    text:   { score: 1, confidence: 0.9, chars: 2500, backend: 'demo' },
    images: [],
  },
  {
    label: 'Photo essay, all images signed by camera (capture chain)',
    text:   { score: 8, confidence: 0.8, chars: 1500, backend: 'demo' },
    images: Array.from({ length: 3 }, (_, i) => ({
      ai_score: 25, confidence: 0.6, area_px: 800_000,
      c2pa: { camera_capture_chain: true },
      url: `https://news.example.com/photo-${i}.jpg`,
    })),
  },
  {
    label: 'Zero-signal page (placeholder)',
    text:   { score: 0, confidence: 1, chars: 100, backend: 'demo' },
    images: [],
  },
];

function bar(score) {
  const n = Math.round(score / 2);   // 50 chars = 100%
  const filled = '█'.repeat(n);
  const empty  = '·'.repeat(50 - n);
  return filled + empty;
}

function colorVerdict(v) {
  // ANSI colors for terminal demo. Skip if not a TTY.
  const tty = process.stdout.isTTY;
  if (!tty) return v;
  const c = { BLOCK: '\x1b[41m\x1b[97m', WARN_HIGH: '\x1b[43m\x1b[30m', WARN_LOW: '\x1b[100m\x1b[97m', CLEAN: '\x1b[42m\x1b[30m' };
  return (c[v] || '') + ' ' + v + ' ' + '\x1b[0m';
}

console.log('\n================ Stone Search AI Filter — Demo ================\n');

for (const c of cases) {
  const r = scorePage({ text: c.text, images: c.images });
  console.log(c.label);
  console.log(`  ${bar(r.aiScore)}  ${r.aiScore.toString().padStart(5)}%   ${colorVerdict(r.verdict)}`);
  console.log(`  weights: text=${r.weights.text} image=${r.weights.image}` +
              (r.modality.text ? `  text=${r.modality.text.score_effective}%`  : '') +
              (r.modality.image ? `  image=${r.modality.image.score_effective}% (${r.modality.image.count} imgs)` : '') +
              (r.override ? `  override=${r.override}` : ''));
  console.log('');
}

// --- Live pipeline demo (uses mock backends, no network) ---------------------
(async () => {
  console.log('================ Live pipeline (mocked backends) ================\n');
  const analyzer = createAnalyzer({ textBackend: textMock, imageBackend: imageMock });

  const fakeResults = [
    { url: 'https://example.com/article-1', title: 'Why coastal erosion is accelerating', snippet: 'Coastal scientists in the UK and Netherlands have flagged...' },
    { url: 'https://aigen.example.com/listicle', title: '10 Astonishing Facts About Bees', snippet: 'In this article we explore ten facts that will blow your mind.' },
    { url: 'https://photo.example.com/sunrise', title: 'Photo essay: Dawn at Cape Reinga', snippet: 'A morning at the northern tip of Aotearoa.' },
  ];

  for (const item of fakeResults) {
    // Bypass the fetcher by pre-supplying text and images.
    const text = (item.title + '\n\n' + item.snippet).repeat(40);   // simulate body
    const images = [
      { url: item.url + '/hero.jpg', area_px: 800_000 },
      { url: item.url + '/thumb.jpg', area_px: 40_000 },
    ];
    const env = await analyzer.analyze({ url: item.url, title: item.title, snippet: item.snippet, text, images });
    console.log(item.title);
    console.log(`  ${bar(env.aiScore)}  ${String(env.aiScore).padStart(5)}%   ${colorVerdict(env.verdict)}`);
    if (env.modality.text)  console.log(`    text:  ${env.modality.text.score}%  conf=${env.modality.text.confidence}  backend=${env.modality.text.backend}`);
    if (env.modality.image) console.log(`    image: ${env.modality.image.score}%  conf=${env.modality.image.confidence}  count=${env.modality.image.count}`);
    if (env.warnings.length) console.log('    warnings: ' + env.warnings.join('; '));
    console.log('');
  }

  console.log('Cache stats:', analyzer.cache.stats());
  console.log('\nDone.\n');
})();
