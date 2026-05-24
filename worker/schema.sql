-- Stone Search — D1 analytics schema
-- Already applied to remote database (id b274ca4c-1b26-4aeb-93c7-865d6c1ad9c1).
-- Keep this file in sync with any future schema changes; re-apply with:
--   wrangler d1 execute stonesearch-analytics --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_text TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  ip_hash TEXT,
  country TEXT,
  user_agent_hash TEXT,
  result_count INTEGER,
  latency_ms INTEGER,
  provider TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_queries_created_at ON queries(created_at);
CREATE INDEX IF NOT EXISTS idx_queries_hash ON queries(query_hash);

CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id INTEGER NOT NULL,
  result_position INTEGER NOT NULL,
  result_url TEXT NOT NULL,
  result_domain TEXT,
  is_ad INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY(query_id) REFERENCES queries(id)
);
CREATE INDEX IF NOT EXISTS idx_clicks_query_id ON clicks(query_id);

CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT PRIMARY KEY,
  total_queries INTEGER DEFAULT 0,
  unique_ips INTEGER DEFAULT 0,
  total_clicks INTEGER DEFAULT 0,
  ad_clicks INTEGER DEFAULT 0,
  avg_latency_ms REAL
);
