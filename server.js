/* ============================================================
   Stone Search — zero-dependency Node server
   - Serves the Win95 front-end from /public
   - /api/search    -> currently returns mock results (swap in
                       Google Custom Search / Bing / SerpAPI here)
   - /api/analyze   -> proxies to Hive AI Detection API
                       (falls back to a deterministic mock score
                       when HIVE_API_KEY isn't set, so the demo
                       still works out of the box)

   Built on Node's built-in `http` so `npm install` is optional.
   Requires Node 18+ (for the built-in fetch).
   ============================================================ */

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const mockResults = require('./api/mock-results.js');

// ---- Tab-specific mock datasets ----
const mockImages   = require('./api/mock/images.js');
const mockVideos   = require('./api/mock/videos.js');
const mockNews     = require('./api/mock/news.js');
const mockForums   = require('./api/mock/forums.js');
const mockShopping = require('./api/mock/shopping.js');
const mockMaps     = require('./api/mock/maps.js');
const mockKnowledge = require('./api/mock/knowledge.js');
const mockSidebar   = require('./api/mock/sidebar.js');

const TABS = {
  all:      mockResults,
  web:      mockResults,
  images:   mockImages,
  videos:   mockVideos,
  news:     mockNews,
  forums:   mockForums,
  shopping: mockShopping,
  maps:     mockMaps,
};

// ---- AI filter v2 (text + image, weighted, four-tier verdict) ----
const { createAnalyzer } = require('./api/ai-filter');
const textHive  = require('./api/ai-filter/backends/text-hive.js');
const textMock  = require('./api/ai-filter/backends/text-mock.js');
const imageMock = require('./api/ai-filter/backends/image-mock.js');

const textBackend  = process.env.HIVE_API_KEY ? textHive  : textMock;
const imageBackend = imageMock;  // swap for sightengine/hive-visual when wired
const analyzer = createAnalyzer({ textBackend, imageBackend });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  try {
    // ---- API ROUTES ----
    if (pathname === '/api/search' && req.method === 'GET') {
      return handleSearch(parsed.query, res);
    }
    if (pathname === '/api/analyze' && req.method === 'POST') {
      return handleAnalyze(req, res);
    }
    if (pathname === '/api/knowledge' && req.method === 'GET') {
      const q = String(parsed.query.q || '').trim();
      return sendJson(res, 200, { query: q, card: mockKnowledge.find(q) });
    }
    if (pathname === '/api/sidebar' && req.method === 'GET') {
      const q = String(parsed.query.q || '').trim();
      return sendJson(res, 200, { query: q, entities: mockSidebar.find(q) });
    }

    // ---- STATIC FILES ----
    return serveStatic(pathname, res);
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: err.message });
  }
});

// -------------------- /api/search --------------------
// Supports ?tab=all|images|videos|news|forums|shopping|maps
// Returns the right mock dataset and (where applicable) ranks by query.
function handleSearch(query, res) {
  const q   = String(query.q   || '').trim();
  const tab = String(query.tab || 'all').toLowerCase();
  const dataset = TABS[tab] || TABS.all;
  if (!q) return sendJson(res, 200, { query: '', tab, results: [] });

  const lower = q.toLowerCase();
  const scored = dataset.map(r => {
    const haystack = [
      r.title, r.snippet, r.name, r.channel, r.outlet, r.forum, r.seller, r.source
    ].filter(Boolean).join(' ').toLowerCase();
    let score = 1;
    if (haystack.includes(lower)) score += 5;
    return { ...r, _score: score };
  });
  scored.sort((a, b) => b._score - a._score);
  const out = scored.map(({ _score, ...rest }) => rest);
  sendJson(res, 200, { query: q, tab, results: out });
}

// -------------------- /api/analyze --------------------
// V2: full page-level pipeline (text + image, weighted score, four-tier verdict).
// Response shape is back-compatible: { aiScore } stays in the same place,
// with verdict / modality / weights / provenance / warnings layered on top.
async function handleAnalyze(req, res) {
  const body = await readJsonBody(req);
  const { url: itemUrl, snippet, title, options } = body || {};

  try {
    const envelope = await analyzer.analyze(
      { url: itemUrl, title, snippet },
      options || {}
    );
    sendJson(res, 200, envelope);
  } catch (err) {
    console.error('analyze failed:', err);
    sendJson(res, 200, {
      aiScore: null,
      verdict: 'CLEAN',
      source: 'degraded',
      warnings: [`analyzer:error:${err.message}`],
    });
  }
}

// -------------------- static files --------------------
function serveStatic(pathname, res) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  // Prevent directory traversal
  const safe = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(PUBLIC_DIR, safe);
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found: ' + pathname);
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
}

// -------------------- helpers --------------------
function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// -------------------- start --------------------
server.listen(PORT, () => {
  console.log(`Stone Search listening on http://localhost:${PORT}`);
  if (!process.env.HIVE_API_KEY) {
    console.log('NOTE: HIVE_API_KEY not set — using mock AI scores.');
  }
});
