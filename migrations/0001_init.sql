-- Generated from src/schema.ts. Edit there, then run: npm run schema:sync
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  amount_cents INTEGER,
  props TEXT
);
CREATE INDEX IF NOT EXISTS events_site_type_ts ON events (site_id, type, ts);
CREATE INDEX IF NOT EXISTS events_session ON events (session_id);

CREATE TABLE IF NOT EXISTS sessions (
  site_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  pageviews INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL,
  referrer TEXT NOT NULL,
  campaign TEXT NOT NULL DEFAULT '',
  utm_source TEXT,
  utm_medium TEXT,
  entry_path TEXT NOT NULL,
  country TEXT,
  device TEXT,
  browser TEXT,
  PRIMARY KEY (site_id, session_id)
);
CREATE INDEX IF NOT EXISTS sessions_site_started ON sessions (site_id, started_at);
CREATE INDEX IF NOT EXISTS sessions_session ON sessions (session_id);
CREATE INDEX IF NOT EXISTS sessions_visitor ON sessions (visitor_id);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  order_id TEXT NOT NULL,
  site_id TEXT,
  session_id TEXT,
  occurred_at INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  disputed_cents INTEGER NOT NULL DEFAULT 0,
  dispute_status TEXT,
  churned_cents INTEGER NOT NULL DEFAULT 0,
  subscription_id TEXT,
  renewal INTEGER NOT NULL DEFAULT 0,
  live INTEGER NOT NULL DEFAULT 1,
  product TEXT,
  customer_hash TEXT,
  channel TEXT NOT NULL DEFAULT 'Direct',
  referrer TEXT NOT NULL DEFAULT '(direct)',
  campaign TEXT NOT NULL DEFAULT '',
  entry_path TEXT NOT NULL DEFAULT '/',
  country TEXT,
  device TEXT,
  browser TEXT,
  first_seen_at INTEGER,
  UNIQUE (provider, order_id)
);
CREATE INDEX IF NOT EXISTS sales_site_time ON sales (site_id, occurred_at);
CREATE INDEX IF NOT EXISTS sales_session ON sales (session_id);
CREATE INDEX IF NOT EXISTS sales_subscription ON sales (provider, subscription_id);
CREATE INDEX IF NOT EXISTS sales_customer ON sales (customer_hash);

CREATE TABLE IF NOT EXISTS sale_ids (
  provider TEXT NOT NULL,
  alt_id TEXT NOT NULL,
  sale_id INTEGER NOT NULL,
  PRIMARY KEY (provider, alt_id)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
