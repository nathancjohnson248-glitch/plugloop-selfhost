/**
 * D1 → DashRaw, the shape the hosted dashboard reads (src/lib/dash/types.ts), so the hosted
 * derive/insights/flow code runs unchanged on top. This mirrors the Postgres function
 * `dash_overview` in SQLite: a handful of grouped queries in one batch, the rest in JS.
 */
import { toDashData } from "./dash/derive";
import { EMPTY_TOTALS, type DashData, type DashRaw, type Period, type RawSale, type RawSource, type RawTotals } from "./dash/types";

const HOUR = 3_600_000;
const DAY = 86_400_000;

export type Window = { from: number; to: number; pfrom: number; bucket: "hour" | "day"; step: number };

export function windowFor(period: Period, now = Date.now()): Window {
  const midnight = Math.floor(now / DAY) * DAY;
  if (period === "today") return { from: midnight, to: now, pfrom: midnight - (now - midnight), bucket: "hour", step: HOUR };
  const days = period === "7d" ? 7 : 30;
  const from = midnight - (days - 1) * DAY;
  return { from, to: now, pfrom: from - days * DAY, bucket: "day", step: DAY };
}

type SaleRow = {
  id: number;
  provider: string;
  occurred_at: number;
  amount_cents: number;
  refunded_cents: number;
  disputed_cents: number;
  dispute_status: string | null;
  churned_cents: number;
  renewal: number;
  product: string | null;
  customer_hash: string | null;
  channel: string;
  referrer: string;
  campaign: string;
  entry_path: string;
  country: string | null;
  device: string | null;
  browser: string | null;
  first_seen_at: number | null;
  session_id: string | null;
};

type CheckoutRow = { session_id: string; ts: number; amount_cents: number | null; path: string; channel: string | null; referrer: string | null; campaign: string | null; entry_path: string | null; paid: number };

const keyOf = (x: { channel: string; referrer: string; campaign: string }) => `${x.channel}\u0000${x.referrer}\u0000${x.campaign}`;

function totalsOf(sess: { visitors: number; pageviews: number; sessions: number; bounces: number } | undefined, sales: SaleRow[], checkouts: CheckoutRow[], aov: number): RawTotals {
  const ab = checkouts.filter((c) => !c.paid);
  return {
    visitors: sess?.visitors ?? 0,
    pageviews: sess?.pageviews ?? 0,
    sessions: sess?.sessions ?? 0,
    bounces: sess?.bounces ?? 0,
    sales: sales.length,
    revenue_cents: sales.reduce((n, s) => n + s.amount_cents, 0),
    refunded_cents: sales.reduce((n, s) => n + s.refunded_cents, 0),
    disputed_cents: sales.reduce((n, s) => n + s.disputed_cents, 0),
    churned_cents: sales.reduce((n, s) => n + s.churned_cents, 0),
    checkouts: checkouts.length,
    abandoned: ab.length,
    abandoned_cents: ab.reduce((n, c) => n + (c.amount_cents ?? aov), 0),
  };
}

function sourcesOf(visitors: { channel: string; referrer: string; campaign: string; visitors: number }[], sales: SaleRow[], checkouts: CheckoutRow[], aov: number): RawSource[] {
  const m = new Map<string, RawSource>();
  const row = (k: { channel: string; referrer: string; campaign: string }) => {
    const id = keyOf(k);
    let r = m.get(id);
    if (!r) {
      r = { channel: k.channel, referrer: k.referrer, campaign: k.campaign, visitors: 0, sales: 0, revenue_cents: 0, refunded_cents: 0, disputed_cents: 0, churned_cents: 0, checkouts: 0, abandoned: 0, abandoned_cents: 0 };
      m.set(id, r);
    }
    return r;
  };
  for (const v of visitors) row(v).visitors += v.visitors;
  for (const s of sales) {
    const r = row(s);
    r.sales++;
    r.revenue_cents += s.amount_cents;
    r.refunded_cents += s.refunded_cents;
    r.disputed_cents += s.disputed_cents;
    r.churned_cents += s.churned_cents;
  }
  for (const c of checkouts) {
    const r = row({ channel: c.channel ?? "Direct", referrer: c.referrer ?? "(direct)", campaign: c.campaign ?? "" });
    r.checkouts++;
    if (!c.paid) {
      r.abandoned++;
      r.abandoned_cents += c.amount_cents ?? aov;
    }
  }
  return [...m.values()];
}

export async function loadRaw(db: D1Database, siteId: string, period: Period, opts: { now?: number; includeTest?: boolean; currency?: string } = {}): Promise<DashRaw> {
  const now = opts.now ?? Date.now();
  const w = windowFor(period, now);
  const live = opts.includeTest ? 1 : 0;

  const sessTotals = (a: number, b: number) =>
    db
      .prepare(
        `SELECT COUNT(DISTINCT visitor_id) visitors, COALESCE(SUM(pageviews), 0) pageviews,
                COALESCE(SUM(CASE WHEN pageviews > 0 THEN 1 ELSE 0 END), 0) sessions,
                COALESCE(SUM(CASE WHEN pageviews = 1 THEN 1 ELSE 0 END), 0) bounces
           FROM sessions WHERE site_id = ?1 AND started_at >= ?2 AND started_at < ?3 AND pageviews > 0`,
      )
      .bind(siteId, a, b);
  const sessSources = (a: number, b: number) =>
    db
      .prepare("SELECT channel, referrer, campaign, COUNT(DISTINCT visitor_id) visitors FROM sessions WHERE site_id = ?1 AND started_at >= ?2 AND started_at < ?3 AND pageviews > 0 GROUP BY 1, 2, 3")
      .bind(siteId, a, b);
  const salesIn = (a: number, b: number) => db.prepare("SELECT * FROM sales WHERE site_id = ?1 AND occurred_at >= ?2 AND occurred_at < ?3 AND (live = 1 OR ?4 = 1) ORDER BY occurred_at DESC").bind(siteId, a, b, live);
  const checkoutsIn = (a: number, b: number) =>
    db
      .prepare(
        `SELECT c.session_id, c.ts, c.amount_cents, c.path, s.channel, s.referrer, s.campaign, s.entry_path,
                EXISTS (SELECT 1 FROM sales x WHERE x.site_id = c.site_id AND x.session_id = c.session_id AND x.occurred_at >= c.ts - 300000) paid
           FROM (SELECT site_id, session_id, MIN(ts) ts, MAX(amount_cents) amount_cents, path FROM events
                  WHERE site_id = ?1 AND type = 'checkout_started' AND ts >= ?2 AND ts < ?3 GROUP BY session_id) c
           LEFT JOIN sessions s ON s.site_id = c.site_id AND s.session_id = c.session_id`,
      )
      .bind(siteId, a, b);
  const dim = (col: string, fallback: string, limit: number) =>
    db
      .prepare(`SELECT COALESCE(${col}, '${fallback}') k, COUNT(DISTINCT visitor_id) v FROM sessions WHERE site_id = ?1 AND started_at >= ?2 AND started_at < ?3 AND pageviews > 0 GROUP BY 1 ORDER BY 2 DESC LIMIT ${limit}`)
      .bind(siteId, w.from, w.to);

  const results = await db.batch([
    sessTotals(w.from, w.to), // 0
    sessTotals(w.pfrom, w.from), // 1
    sessSources(w.from, w.to), // 2
    sessSources(w.pfrom, w.from), // 3
    salesIn(w.from, w.to), // 4
    salesIn(w.pfrom, w.from), // 5
    checkoutsIn(w.from, w.to), // 6
    checkoutsIn(w.pfrom, w.from), // 7
    db.prepare("SELECT CAST((ts - ?2) / ?4 AS INTEGER) b, COUNT(DISTINCT visitor_id) v FROM events WHERE site_id = ?1 AND type = 'pageview' AND ts >= ?2 AND ts < ?3 GROUP BY b").bind(siteId, w.from, w.to, w.step), // 8
    db.prepare("SELECT path, COUNT(DISTINCT visitor_id) visitors, COUNT(*) views FROM events WHERE site_id = ?1 AND type = 'pageview' AND ts >= ?2 AND ts < ?3 GROUP BY path ORDER BY visitors DESC, path LIMIT 30").bind(siteId, w.from, w.to), // 9
    db
      .prepare(
        `SELECT DISTINCT e.path, x.id FROM sales x JOIN events e ON e.site_id = x.site_id AND e.session_id = x.session_id AND e.type = 'pageview' AND e.ts <= x.occurred_at
          WHERE x.site_id = ?1 AND x.occurred_at >= ?2 AND x.occurred_at < ?3`,
      )
      .bind(siteId, w.from, w.to), // 10
    db.prepare("SELECT path, COUNT(DISTINCT visitor_id) visitors FROM events WHERE site_id = ?1 AND type = 'pageview' AND ts >= ?2 AND ts < ?3 GROUP BY path ORDER BY 2 DESC LIMIT 50").bind(siteId, w.pfrom, w.from), // 11
    dim("country", "??", 30), // 12
    dim("device", "desktop", 5), // 13
    dim("browser", "Other", 12), // 14
    db.prepare("SELECT customer_hash, id, occurred_at, amount_cents, refunded_cents, renewal, channel, referrer FROM sales WHERE site_id = ?1 AND occurred_at < ?2 AND (live = 1 OR ?3 = 1) ORDER BY occurred_at").bind(siteId, w.to, live), // 15
    db.prepare("SELECT COALESCE(ROUND(AVG(amount_cents)), 0) v FROM sales WHERE site_id = ?1 AND (live = 1 OR ?2 = 1)").bind(siteId, live), // 16
    db.prepare("SELECT COUNT(DISTINCT visitor_id) v FROM events WHERE site_id = ?1 AND ts > ?2").bind(siteId, now - 300_000), // 17
  ]);
  const rows = <T,>(i: number) => (results[i].results ?? []) as T[];

  const aov = Number(rows<{ v: number }>(16)[0]?.v ?? 0);
  const sales = rows<SaleRow>(4);
  const prevSales = rows<SaleRow>(5);
  const checkouts = rows<CheckoutRow>(6);
  const prevCheckouts = rows<CheckoutRow>(7);

  const nBuckets = Math.max(1, Math.ceil((w.to - w.from) / w.step));
  const series = Array.from({ length: nBuckets }, (_, i) => ({ t: new Date(w.from + i * w.step).toISOString(), visitors: 0, revenue_cents: 0 }));
  for (const r of rows<{ b: number; v: number }>(8)) { const i = Math.floor(Number(r.b)); if (series[i]) series[i].visitors = r.v; }
  for (const s of sales) {
    const b = Math.floor((s.occurred_at - w.from) / w.step);
    if (series[b]) series[b].revenue_cents += s.amount_cents;
  }

  // Pages: a sale counts toward every page its session viewed before paying, else its landing page.
  const top = rows<{ path: string; visitors: number; views: number }>(9);
  const salePaths = new Map<string, Set<number>>();
  const seen = new Set<number>();
  for (const r of rows<{ path: string; id: number }>(10)) {
    (salePaths.get(r.path) ?? salePaths.set(r.path, new Set()).get(r.path)!).add(r.id);
    seen.add(r.id);
  }
  for (const s of sales) if (!seen.has(s.id)) (salePaths.get(s.entry_path) ?? salePaths.set(s.entry_path, new Set()).get(s.entry_path)!).add(s.id);
  const amount = new Map(sales.map((s) => [s.id, s.amount_cents]));

  let trend = new Map<string, number[]>();
  if (top.length) {
    const marks = top.map((_, i) => `?${i + 5}`).join(",");
    const t = await db
      .prepare(`SELECT path, CAST((ts - ?2) / ?4 AS INTEGER) b, COUNT(DISTINCT visitor_id) v FROM events WHERE site_id = ?1 AND type = 'pageview' AND ts >= ?2 AND ts < ?3 AND path IN (${marks}) GROUP BY path, b`)
      .bind(siteId, w.from, w.to, w.step, ...top.map((p) => p.path))
      .all<{ path: string; b: number; v: number }>();
    trend = new Map(top.map((p) => [p.path, new Array(nBuckets).fill(0)]));
    for (const r of t.results ?? []) {
      const arr = trend.get(r.path);
      const i = Math.floor(Number(r.b));
      if (arr && i < nBuckets) arr[i] = r.v;
    }
  }

  const pages = top.map((p) => {
    const ids = salePaths.get(p.path) ?? new Set<number>();
    const cs = checkouts.filter((c) => c.path === p.path);
    const ab = cs.filter((c) => !c.paid);
    return {
      path: p.path,
      visitors: p.visitors,
      views: p.views,
      revenue_cents: [...ids].reduce((n, id) => n + (amount.get(id) ?? 0), 0),
      checkouts: cs.length,
      abandoned: ab.length,
      abandoned_cents: ab.reduce((n, c) => n + (c.amount_cents ?? aov), 0),
      trend: trend.get(p.path) ?? new Array(nBuckets).fill(0),
    };
  });

  const byDim = (i: number, pick: (s: SaleRow) => string) =>
    rows<{ k: string; v: number }>(i).map((r) => ({ key: r.k, visitors: r.v, revenue_cents: sales.filter((s) => pick(s) === r.k).reduce((n, s) => n + s.amount_cents, 0) }));

  // LTV by each customer's first source.
  const firsts = new Map<string, { channel: string; referrer: string }>();
  const ltv = new Map<string, { channel: string; referrer: string; customers: Set<string>; revenue_cents: number; renewal_cents: number; refunded_cents: number }>();
  for (const s of rows<SaleRow>(15)) {
    const cust = s.customer_hash ?? `sale:${s.id}`;
    if (!firsts.has(cust)) firsts.set(cust, { channel: s.channel, referrer: s.referrer });
    const f = firsts.get(cust)!;
    const k = `${f.channel}\u0000${f.referrer}`;
    const l = ltv.get(k) ?? { ...f, customers: new Set<string>(), revenue_cents: 0, renewal_cents: 0, refunded_cents: 0 };
    l.customers.add(cust);
    l.revenue_cents += s.amount_cents;
    if (s.renewal) l.renewal_cents += s.amount_cents;
    l.refunded_cents += s.refunded_cents;
    ltv.set(k, l);
  }

  const recent: RawSale[] = sales.slice(0, 25).map((s) => ({
    id: String(s.id),
    at: new Date(s.occurred_at).toISOString(),
    amount_cents: s.amount_cents,
    refunded_cents: s.refunded_cents,
    status: s.dispute_status === "open" || s.dispute_status === "lost" ? "disputed" : s.refunded_cents >= s.amount_cents && s.amount_cents > 0 ? "refunded" : "paid",
    renewal: Boolean(s.renewal),
    provider: s.provider,
    product: s.product ?? "",
    country: s.country,
    channel: s.channel,
    referrer: s.referrer,
    path: s.entry_path,
    lag_minutes: s.first_seen_at ? Math.max(0, Math.round((s.occurred_at - s.first_seen_at) / 60000)) : null,
  }));

  // Money that reached checkout per referrer × landing page, for the money-flow diagram.
  const flows = new Map<string, { referrer: string; path: string; cents: number }>();
  const addFlow = (referrer: string, path: string, cents: number) => {
    const k = `${referrer}\u0000${path}`;
    const f = flows.get(k) ?? { referrer, path, cents: 0 };
    f.cents += cents;
    flows.set(k, f);
  };
  for (const s of sales) addFlow(s.referrer, s.entry_path, s.amount_cents);
  for (const c of checkouts) if (!c.paid) addFlow(c.referrer ?? "(direct)", c.entry_path ?? c.path, c.amount_cents ?? aov);

  const sessCur = rows<{ visitors: number; pageviews: number; sessions: number; bounces: number }>(0)[0];
  const sessPrev = rows<{ visitors: number; pageviews: number; sessions: number; bounces: number }>(1)[0];
  return {
    bucket: w.bucket,
    series,
    totals: totalsOf(sessCur, sales, checkouts, aov),
    prev: sessPrev || prevSales.length ? totalsOf(sessPrev, prevSales, prevCheckouts, aov) : EMPTY_TOTALS,
    sources: sourcesOf(rows(2), sales, checkouts, aov),
    prev_sources: sourcesOf(rows(3), prevSales, prevCheckouts, aov),
    pages,
    prev_pages: rows<{ path: string; visitors: number }>(11).map((p) => ({ ...p, revenue_cents: 0 })),
    countries: byDim(12, (s) => s.country ?? "??"),
    devices: byDim(13, (s) => s.device ?? "desktop"),
    browsers: byDim(14, (s) => s.browser ?? "Other"),
    ltv: [...ltv.values()].map((l) => ({ channel: l.channel, referrer: l.referrer, customers: l.customers.size, revenue_cents: l.revenue_cents, renewal_cents: l.renewal_cents, refunded_cents: l.refunded_cents })),
    recent_sales: recent,
    online: Number(rows<{ v: number }>(17)[0]?.v ?? 0),
    currency: opts.currency ?? "USD",
    page_flows: [...flows.values()],
  };
}

export async function loadDash(db: D1Database, siteId: string, period: Period, opts: { now?: number; includeTest?: boolean; currency?: string } = {}): Promise<DashData> {
  return toDashData(await loadRaw(db, siteId, period, opts), period, "UTC");
}
