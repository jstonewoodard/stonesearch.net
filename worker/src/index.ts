/**
 * Stone Search — meta-search Worker
 * stonesearch.net
 *
 * Routes:
 *   GET  /                  — static UI (served from ./public via ASSETS binding)
 *   GET  /api/search?q=...  — aggregated search results JSON
 *   POST /api/analyze       — AI-content filter (page-level text+image, four-tier verdict)
 *   POST /api/click         — click-through tracking
 *   GET  /api/health        — health check
 */

import { createAnalyzer, kvCache } from './ai-filter/analyzer.js';
import { textMock, makeTextHive, imageMock } from './ai-filter/backends.js';

export interface Env {
  ASSETS: Fetcher;
  CACHE: KVNamespace;
  RATELIMIT: KVNamespace;
  DB: D1Database;
  BRAVE_API_KEY?: string;
  BING_API_KEY?: string;
  GOOGLE_CSE_ID?: string;
  GOOGLE_CSE_API_KEY?: string;
  HIVE_API_KEY?: string;       // AI-content text detector (optional; falls back to mock)
  ENVIRONMENT: string;
  CACHE_TTL_SECONDS: string;
  RATELIMIT_PER_MINUTE: string;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  provider: string;
  is_ad?: boolean;
}

interface AggregatedResponse {
  query: string;
  results: SearchResult[];
  result_count: number;
  latency_ms: number;
  providers_used: string[];
  cached: boolean;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (url.pathname === '/api/health') {
        return jsonResponse({ status: 'ok', env: env.ENVIRONMENT, ts: Date.now() });
      }

      if (url.pathname === '/api/search' && request.method === 'GET') {
        return await handleSearch(request, env, ctx);
      }

      if (url.pathname === '/api/analyze' && request.method === 'POST') {
        return await handleAnalyze(request, env, ctx);
      }

      if (url.pathname === '/api/click' && request.method === 'POST') {
        return await handleClick(request, env, ctx);
      }

      // Everything else — serve static assets (SPA UI)
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('Worker error', err);
      return jsonResponse({ error: 'internal_error', message: String(err) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

// --------------------------------------------------------------------------
// /api/search
// --------------------------------------------------------------------------
async function handleSearch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();

  if (!q) return jsonResponse({ error: 'missing_query' }, 400);
  if (q.length > 500) return jsonResponse({ error: 'query_too_long' }, 400);

  // Rate-limit per IP (sliding 1-minute window)
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const limit = parseInt(env.RATELIMIT_PER_MINUTE, 10) || 60;
  const blocked = await checkRateLimit(env.RATELIMIT, ip, limit);
  if (blocked) return jsonResponse({ error: 'rate_limited' }, 429);

  const started = Date.now();
  const ttl = parseInt(env.CACHE_TTL_SECONDS, 10) || 600;
  const queryHash = await sha256(q.toLowerCase());
  const cacheKey = `q:${queryHash}`;

  // Cache check
  const cached = await env.CACHE.get(cacheKey, 'json');
  if (cached) {
    const payload = cached as AggregatedResponse;
    payload.cached = true;
    payload.latency_ms = Date.now() - started;
    // Still log the query (async, don't block response)
    ctx.waitUntil(logQuery(env.DB, q, queryHash, request, payload, true));
    return jsonResponse(payload);
  }

  // Fan out to providers in parallel
  const providers: Promise<SearchResult[]>[] = [];
  if (env.BRAVE_API_KEY) providers.push(searchBrave(q, env.BRAVE_API_KEY));
  if (env.BING_API_KEY) providers.push(searchBing(q, env.BING_API_KEY));
  if (env.GOOGLE_CSE_ID && env.GOOGLE_CSE_API_KEY) {
    providers.push(searchGoogleCSE(q, env.GOOGLE_CSE_ID, env.GOOGLE_CSE_API_KEY));
  }

  // If no providers configured, return a friendly stub (useful during dev)
  if (providers.length === 0) {
    return jsonResponse({
      query: q,
      results: [],
      result_count: 0,
      latency_ms: Date.now() - started,
      providers_used: [],
      cached: false,
      message: 'No search provider API keys configured. Set BRAVE_API_KEY via `wrangler secret put`.',
    });
  }

  const settled = await Promise.allSettled(providers);
  const merged: SearchResult[] = [];
  const providersUsed: string[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value.length > 0) {
      merged.push(...r.value);
      providersUsed.push(r.value[0].provider);
    }
  }

  const ranked = dedupeAndRank(merged);
  const payload: AggregatedResponse = {
    query: q,
    results: ranked,
    result_count: ranked.length,
    latency_ms: Date.now() - started,
    providers_used: providersUsed,
    cached: false,
  };

  // Cache + log (async)
  ctx.waitUntil(env.CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: ttl }));
  ctx.waitUntil(logQuery(env.DB, q, queryHash, request, payload, false));

  return jsonResponse(payload);
}

// --------------------------------------------------------------------------
// /api/analyze
// --------------------------------------------------------------------------
// AI-content filter (v2): text + image, weighted scoring, four-tier verdict.
// Math is byte-identical to the Pages Function port (functions/api/analyze.js)
// and the local dev server (stonesearch.net/server.js). Cross-port equivalence
// is unit-tested.
//
// Bindings used:
//   env.HIVE_API_KEY  — text detector vendor (optional; falls back to mock)
//   env.CACHE         — KV namespace for cross-isolate analysis cache
//
// Future image backends (Sightengine, Hive Visual) drop in by replacing
// imageMock with the appropriate Detector implementation.
async function handleAnalyze(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // Tolerate empty body — analyzer handles missing fields gracefully.
  }

  const textBackend  = env.HIVE_API_KEY ? makeTextHive(env.HIVE_API_KEY) : textMock;
  const imageBackend = imageMock;
  const analyzer = createAnalyzer({
    textBackend,
    imageBackend,
    cache: env.CACHE ? kvCache(env.CACHE) : undefined,
  });

  try {
    const envelope = await analyzer.analyze(
      {
        url: body.url,
        title: body.title,
        snippet: body.snippet,
        text: body.text,
        images: body.images,
      },
      body.options || {}
    );
    return jsonResponse(envelope);
  } catch (err) {
    console.error('analyze failed:', err);
    return jsonResponse({
      aiScore: null,
      verdict: 'CLEAN',
      source: 'degraded',
      warnings: [`analyzer:error:${(err as Error).message}`],
    });
  }
}

// --------------------------------------------------------------------------
// /api/click
// --------------------------------------------------------------------------
async function handleClick(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const { query_id, position, url: resultUrl, is_ad } = body || {};
  if (typeof query_id !== 'number' || typeof position !== 'number' || typeof resultUrl !== 'string') {
    return jsonResponse({ error: 'invalid_payload' }, 400);
  }

  const domain = safeDomain(resultUrl);
  ctx.waitUntil(
    env.DB.prepare(
      'INSERT INTO clicks (query_id, result_position, result_url, result_domain, is_ad) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(query_id, position, resultUrl, domain, is_ad ? 1 : 0)
      .run()
  );

  return jsonResponse({ ok: true });
}

// --------------------------------------------------------------------------
// Provider adapters
// --------------------------------------------------------------------------
async function searchBrave(q: string, apiKey: string): Promise<SearchResult[]> {
  const u = new URL('https://api.search.brave.com/res/v1/web/search');
  u.searchParams.set('q', q);
  u.searchParams.set('count', '20');
  const r = await fetch(u.toString(), {
    headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
  });
  if (!r.ok) return [];
  const data: any = await r.json();
  const items: any[] = data?.web?.results || [];
  return items.map((it) => ({
    title: it.title || '',
    url: it.url || '',
    snippet: it.description || '',
    domain: safeDomain(it.url || ''),
    provider: 'brave',
  }));
}

async function searchBing(q: string, apiKey: string): Promise<SearchResult[]> {
  const u = new URL('https://api.bing.microsoft.com/v7.0/search');
  u.searchParams.set('q', q);
  u.searchParams.set('count', '20');
  const r = await fetch(u.toString(), {
    headers: { 'Ocp-Apim-Subscription-Key': apiKey },
  });
  if (!r.ok) return [];
  const data: any = await r.json();
  const items: any[] = data?.webPages?.value || [];
  return items.map((it) => ({
    title: it.name || '',
    url: it.url || '',
    snippet: it.snippet || '',
    domain: safeDomain(it.url || ''),
    provider: 'bing',
  }));
}

async function searchGoogleCSE(q: string, cx: string, apiKey: string): Promise<SearchResult[]> {
  const u = new URL('https://www.googleapis.com/customsearch/v1');
  u.searchParams.set('q', q);
  u.searchParams.set('cx', cx);
  u.searchParams.set('key', apiKey);
  u.searchParams.set('num', '10');
  const r = await fetch(u.toString());
  if (!r.ok) return [];
  const data: any = await r.json();
  const items: any[] = data?.items || [];
  return items.map((it) => ({
    title: it.title || '',
    url: it.link || '',
    snippet: it.snippet || '',
    domain: safeDomain(it.link || ''),
    provider: 'google_cse',
  }));
}

// --------------------------------------------------------------------------
// Ranking, helpers
// --------------------------------------------------------------------------
function dedupeAndRank(results: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>();
  let position = 0;
  for (const r of results) {
    const key = canonicalUrl(r.url);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.set(key, r);
    }
    position++;
  }
  return Array.from(seen.values()).slice(0, 30);
}

function canonicalUrl(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().toLowerCase().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function safeDomain(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function sha256(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function checkRateLimit(kv: KVNamespace, ip: string, limit: number): Promise<boolean> {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const key = `rl:${ip}:${minuteBucket}`;
  const current = parseInt((await kv.get(key)) || '0', 10);
  if (current >= limit) return true;
  // Best-effort increment (small race window is acceptable for soft limits)
  await kv.put(key, String(current + 1), { expirationTtl: 120 });
  return false;
}

async function logQuery(
  db: D1Database,
  query: string,
  queryHash: string,
  request: Request,
  payload: AggregatedResponse,
  cached: boolean
) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const country = (request as any).cf?.country || '';
  const ua = request.headers.get('user-agent') || '';
  const ipHash = ip ? await sha256(`${ip}:${queryHash.slice(0, 8)}`) : null;
  const uaHash = ua ? (await sha256(ua)).slice(0, 16) : null;

  await db
    .prepare(
      'INSERT INTO queries (query_text, query_hash, ip_hash, country, user_agent_hash, result_count, latency_ms, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      query,
      queryHash,
      ipHash,
      country,
      uaHash,
      payload.result_count,
      payload.latency_ms,
      cached ? 'cache' : payload.providers_used.join(',')
    )
    .run();
}

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders() },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}
