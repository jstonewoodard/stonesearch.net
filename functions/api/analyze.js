/* ============================================================
   Stone Search — /api/analyze (Cloudflare Pages Function) — v2
   ------------------------------------------------------------
   POST /api/analyze
     body:    { url?, title?, snippet?, text?, images?, options? }
     response (full envelope, see spec §5.1):
       { aiScore, verdict, modality, weights, override,
         provenance, warnings, cache, source }

   This handler is the production port of the v2 multi-modal
   filter (text + image, weighted score, four-tier verdict).
   Math + behavior are identical to the local Node server (see
   /server.js and /api/ai-filter/).

   Bindings (configured in Pages → Settings → Functions):
     env.HIVE_API_KEY      (encrypted)  — text detector vendor
     env.CACHE             (KV namespace, optional) — cross-isolate cache

   Without HIVE_API_KEY the text backend is the deterministic
   mock (same hash math as dev). Without env.CACHE the per-isolate
   in-memory cache is used (still useful within a request burst).
   ============================================================ */

import { createAnalyzer, kvCache } from '../_lib/ai-filter/analyzer.mjs';
import { textMock, makeTextHive, makeTextHuggingFace, imageMock } from '../_lib/ai-filter/backends.mjs';

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch (_) { /* tolerate empty body */ }

  // Text backend priority (per docs/ai-filter/Hive_Clone_Feasibility.md §4):
  //   1. Hugging Face if HF_API_TOKEN is set — free, controllable, no
  //      surprise bills, no user data through a 3rd-party we don't have
  //      a contract with.
  //   2. Hive if HIVE_API_KEY is set — paid fallback. Per the Feb 2026
  //      open-source benchmark, the marginal accuracy gain over HF is
  //      small enough that ensemble fusion in the scorer absorbs most of
  //      it. Hive stays valuable as (a) a comparable to benchmark our
  //      stack against and (b) a tie-breaker when HF errors or is
  //      rate-limited.
  //   3. text-mock — only useful behind ALLOW_MOCK=1 in dev/preview.
  const textBackend =
        env.HF_API_TOKEN ? makeTextHuggingFace(env.HF_API_TOKEN, env.HF_TEXT_MODEL)
      : env.HIVE_API_KEY ? makeTextHive(env.HIVE_API_KEY)
      : textMock;
  const imageBackend = imageMock; // swap for Sightengine/Hive Visual when wired

  // Strict mode: in production, refuse to return mock scores. Set
  // ALLOW_MOCK=1 in Pages env vars to permit them (useful for dev/preview
  // deployments where you want to exercise the front-end end-to-end without
  // a paid detector key).
  const strict = env.ALLOW_MOCK !== '1' && env.ALLOW_MOCK !== 'true';

  const analyzer = createAnalyzer({
    textBackend,
    imageBackend,
    cache: env.CACHE ? kvCache(env.CACHE) : undefined,
    strict,
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
    return json(envelope);
  } catch (err) {
    console.error('analyze failed:', err?.message || err);
    return json({
      aiScore: null,
      verdict: 'CLEAN',
      source: 'degraded',
      warnings: [`analyzer:error:${err?.message || String(err)}`],
    });
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
