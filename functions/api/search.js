/* ============================================================
   Stone Search — /api/search (Cloudflare Pages Function)
   ------------------------------------------------------------
   GET /api/search?q=<query>
   Returns { query, results[] }, results ranked by simple match score.

   Mirrors the behavior of handleSearch() in /server.js so the
   frontend contract is identical on local dev and on Cloudflare.

   To swap mock results for a real provider (Google Custom Search,
   Bing, SerpAPI), replace the body below — keep the response shape.
   ============================================================ */

import { mockResults } from "../_lib/mock-results.js";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim();

  if (!q) {
    return json({ query: "", results: [] });
  }

  const lower = q.toLowerCase();
  const scored = mockResults.map((r) => {
    let score = 1;
    if (r.title.toLowerCase().includes(lower)) score += 5;
    if (r.snippet.toLowerCase().includes(lower)) score += 3;
    return { ...r, _score: score };
  });
  scored.sort((a, b) => b._score - a._score);
  const results = scored.map(({ _score, ...rest }) => rest);

  return json({ query: q, results });
}

// CORS preflight (in case the frontend ever runs on a different origin)
export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
