/* ============================================================
   Stone Search — /api/analyze (Cloudflare Pages Function)
   ------------------------------------------------------------
   POST /api/analyze
     body: { url?, title?, snippet? }
     response: { aiScore: number 0-100, source: 'hive' | 'mock' }

   Mirrors handleAnalyze() in /server.js. Calls Hive's AI Detection
   API when HIVE_API_KEY is set in the Pages environment; falls
   back to a deterministic mock score otherwise — same hash math
   as the local server, so scores match dev ↔ prod for the same input.

   To set HIVE_API_KEY in production:
     Cloudflare Dashboard → Pages → stonesearch-net → Settings
     → Environment variables → add HIVE_API_KEY (encrypted)

   Follow-up: wire in the full /api/ai-filter pipeline
   (scorer, image detection, C2PA provenance) once the frontend
   is updated to consume the richer envelope.
   ============================================================ */

export async function onRequestPost({ request, env }) {
  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    // Empty/invalid body → fall through with defaults; matches server.js behavior.
  }

  const { url: itemUrl, snippet, title } = body || {};
  const text = [title, snippet].filter(Boolean).join("\n\n");

  if (env.HIVE_API_KEY) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try {
        const r = await fetch("https://api.thehive.ai/api/v2/task/sync", {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            Authorization: `Token ${env.HIVE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text_data: text }),
        });
        const j = await r.json();
        const score = extractHiveScore(j);
        if (score !== null) {
          return json({ aiScore: score, source: "hive" });
        }
        // Hive responded but we couldn't parse → fall through to mock.
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      console.error("Hive call failed:", err?.message || err);
      // Fall through to mock.
    }
  }

  const score = mockScore(itemUrl || text || Math.random().toString());
  return json({ aiScore: score, source: "mock" });
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

// ---------------------------- helpers ----------------------------

function extractHiveScore(json) {
  try {
    const out = json?.status?.[0]?.response?.output?.[0];
    const cls = out?.classes || [];
    const ai = cls.find((c) => /ai|generated|machine/i.test(c.class));
    if (ai && typeof ai.score === "number") {
      return Math.round(ai.score * 1000) / 10;
    }
  } catch (_) {
    // ignore
  }
  return null;
}

/* Deterministic 0-100 score from a seed string. Distribution:
     60% clean (<5%), 25% flagged (5-25%), 15% blocked (>25%).
   Exact same math as server.js mockScore() so scores are stable
   across the local dev server and the deployed Function. */
function mockScore(seedStr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const r = (h % 10000) / 10000;
  if (r < 0.6) return Math.round((r / 0.6) * 5 * 10) / 10;
  if (r < 0.85) return Math.round((5 + ((r - 0.6) / 0.25) * 20) * 10) / 10;
  return Math.round((25 + ((r - 0.85) / 0.15) * 70) * 10) / 10;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
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
