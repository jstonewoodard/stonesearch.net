# Stone Search — local dev & deploy

This project is a Cloudflare Worker that powers stonesearch.net. The data layer
(KV + D1) is already provisioned in your Cloudflare account; the IDs are wired
into `wrangler.jsonc`.

## Already provisioned (live in your account)
| Resource                       | Name                    | ID                                       |
| ------------------------------ | ----------------------- | ---------------------------------------- |
| Cloudflare account             | jstonewoodard@gmail.com | `d8d1ce8c9579c2c51db433f5144156c0`       |
| KV — search cache              | `stonesearch-cache`     | `c0263c0f93ce45bd90181a5b3f318f87`       |
| KV — rate-limit buckets        | `stonesearch-ratelimit` | `a36db56606a74e0aa24cf82a73bdb43d`       |
| D1 — analytics (ENAM region)   | `stonesearch-analytics` | `b274ca4c-1b26-4aeb-93c7-865d6c1ad9c1`   |

D1 schema (queries, clicks, daily_stats) is already applied to the remote DB.

## First-time local setup
```bash
cd "Stone Tech/stonesearch"
npm install
npx wrangler login    # opens browser, authenticates
```

## Set provider API keys (one-time, per environment)
You need at least one of these for actual results:
```bash
npx wrangler secret put BRAVE_API_KEY
# (paste key when prompted — get one at https://brave.com/search/api/)

# Optional:
npx wrangler secret put BING_API_KEY
npx wrangler secret put GOOGLE_CSE_ID
npx wrangler secret put GOOGLE_CSE_API_KEY
```

## Run locally
```bash
npm run dev          # http://localhost:8787
```
Local dev uses an empty local KV + D1; remote data isn't touched.

## Deploy to Cloudflare
```bash
npm run deploy
```
The Worker deploys to `stonesearch.<your-subdomain>.workers.dev` immediately.
To attach `stonesearch.net`, see the manual steps below.

## Tail production logs
```bash
npm run tail
```

## Re-apply D1 schema (if changed)
```bash
npm run db:migrate
```

---

# Manual steps still to do (in the Cloudflare dashboard)

These need a human in the browser — they aren't reachable from the API.

## 1. Add stonesearch.net as a zone
1. Sign in to https://dash.cloudflare.com
2. Click **+ Add a domain** (top right) → enter `stonesearch.net` → **Continue**
3. Pick **Free** plan → **Continue**
4. Cloudflare scans existing DNS records — accept defaults
5. **Copy the two nameservers** Cloudflare assigns (something like
   `xxx.ns.cloudflare.com` and `yyy.ns.cloudflare.com`)
6. Go to your domain registrar (wherever you bought stonesearch.net), find DNS
   or nameserver settings, replace the existing nameservers with the two from
   Cloudflare. Save.
7. Wait for "Active" status in Cloudflare (usually minutes; up to 24h)

## 2. Attach the domain to the Worker
After the zone is Active, uncomment the `routes` block in `wrangler.jsonc`:
```jsonc
"routes": [
  { "pattern": "stonesearch.net", "custom_domain": true },
  { "pattern": "www.stonesearch.net", "custom_domain": true }
]
```
Then redeploy: `npm run deploy`.

## 3. Enable R2 (one-time TOS accept, optional)
Only needed if you want object storage (e.g., for screenshot caching, sitemap
storage, ad-creative hosting).
1. Dashboard → **R2 Object Storage** (left sidebar)
2. Click **Purchase R2 Plan** (10 GB/month free, no credit card required for
   the free tier — they just need you to accept terms)
3. Once enabled, you can create buckets via the dashboard or via:
   `npx wrangler r2 bucket create stonesearch-assets`

## 4. Delete the auto-created "fragrant-rice-6057" Worker (optional)
The default Hello World Worker is taking up a name slot. Either:
- Dashboard → Workers & Pages → fragrant-rice-6057 → Manage → Delete, OR
- `npx wrangler delete --name fragrant-rice-6057`

## 5. Get a Brave Search API key
1. https://brave.com/search/api/
2. Sign up (free tier: 2,000 queries/month, $0 — good for early dev)
3. Generate a key
4. `npx wrangler secret put BRAVE_API_KEY` and paste it

---

# Files
```
stonesearch/
├── wrangler.jsonc       — Cloudflare config (bindings, routes, vars)
├── package.json         — npm scripts + wrangler dep
├── tsconfig.json        — TypeScript config
├── schema.sql           — D1 schema (already applied)
├── .gitignore
├── src/
│   └── index.ts         — Worker entry (search, cache, rate-limit, analytics)
└── public/
    ├── index.html       — Search UI
    ├── style.css
    └── app.js
```
