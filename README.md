# Stone Search

> The web, without the bots.

Stone Search is a Win95-themed search engine front-end with a built-in AI-content filter. Results scoring more than 25% AI-generated are discarded entirely; results between 5%–25% are surfaced but flagged. The page also includes a dedicated "ad tab" sidebar with four equally-sized slots ready for Google AdSense.

This is the v0 build for **Stone Tech LLC**.

---

## Quick start

```bash
# 1. (optional) configure keys
cp .env.example .env
# edit .env and set HIVE_API_KEY when you have one

# 2. Run — zero dependencies, just needs Node 18+
npm start
# -> http://localhost:3000
```

The server uses Node's built-in `http` module — no `npm install` required. If `HIVE_API_KEY` is not set, the server returns deterministic **mock** AI scores so the UI is fully functional end-to-end without any external accounts.

---

## How it works

```
┌──────────────┐   ┌────────────────────────┐   ┌─────────────────────┐
│  Browser     │ → │  /api/search?q=...     │ → │  Mock results       │
│  (Win95 UI)  │   │  (swap in Google CSE)  │   │  (api/mock-results) │
└──────┬───────┘   └────────────────────────┘   └─────────────────────┘
       │ for each result
       ▼
┌──────────────┐   ┌────────────────────────┐   ┌─────────────────────┐
│  /api/analyze│ → │  Hive AI Detection API │ → │  AI score (0-100)   │
└──────────────┘   └────────────────────────┘   └─────────────────────┘
       │
       ▼
   score > 25%  → hidden (with "X hidden" banner, can be revealed)
   5–25%        → shown with yellow ⚠ AI badge
   <5%          → shown with green ✓ Human badge
```

### Files

| Path | Purpose |
|---|---|
| `public/index.html` | Homepage (search box, logo, filter toggles) |
| `public/results.html` | Results page (with AI badges, filter banner) |
| `public/styles/main.css` | Custom Win95 styling layered on top of [98.css](https://jdan.github.io/98.css/) |
| `public/scripts/home.js` | Homepage form submission + prefs persistence |
| `public/scripts/results.js` | Fetch results, call analyzer, render with badges |
| `public/scripts/clock.js` | Taskbar clock |
| `public/favicon.svg` | Pixel-art stone icon |
| `server.js` | Express server, search & analyze endpoints |
| `api/mock-results.js` | Sample search results |

---

## Configuration

### Real search backend (Google Custom Search)

In `server.js`, replace the body of the `/api/search` handler with a fetch to the Google Custom Search JSON API:

```js
const r = await fetch(
  `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_CSE_KEY}` +
  `&cx=${process.env.GOOGLE_CSE_ID}&q=${encodeURIComponent(q)}`
);
const json = await r.json();
const results = (json.items || []).map(it => ({
  title: it.title,
  url: it.link,
  snippet: it.snippet,
}));
res.json({ query: q, results });
```

You will need: a Google Cloud project with the Custom Search API enabled, an API key, and a Programmable Search Engine ID (CX).

### Real AI detection (Hive)

Sign up at [https://thehive.ai](https://thehive.ai) and request access to the AI-Generated Text Detection model. Drop the API token into `.env` as `HIVE_API_KEY`. The server will start using it automatically; the mock fallback turns off.

The exact response shape from Hive can change — see `extractHiveScore()` in `server.js` and adjust as needed.

### Google AdSense

Each `.ad-slot` in `public/index.html` and `public/results.html` is a placeholder. To monetize:

1. Get approved for AdSense and find your publisher ID.
2. In each slot, replace the `<span class="ad-placeholder">` with an `<ins class="adsbygoogle" ...>` tag.
3. Add the AdSense loader script to the `<head>`.

The slot dimensions (`160px` tall, sidebar width `220px`) work well with the "vertical banner" or "skyscraper" ad units.

---

## AI filter behavior

Thresholds live in `public/scripts/results.js`:

```js
const FILTER_THRESHOLD = 25; // hide above this
const FLAG_THRESHOLD   = 5;  // flag at or above this
```

The user can override the filter on a per-search basis via the two checkboxes in the results-page header, or by clicking "Show anyway" on the filter banner.

---

## Roadmap

- [ ] Wire in Google Custom Search (or Bing / SerpAPI)
- [ ] Cache analyzed results in Redis to cut Hive API costs
- [ ] Crawl & analyze page bodies (not just title + snippet) for higher accuracy
- [ ] AdSense integration in production
- [ ] Account system + paid ad-free tier
- [ ] Mobile-responsive polish

---

## License

Proprietary. © 2026 Stone Tech LLC.
