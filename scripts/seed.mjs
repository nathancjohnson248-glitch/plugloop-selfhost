// Demo data for local development and screenshots: 30 days of visits, checkouts and sales for one
// site. Prints SQL; `npm run seed:local` pipes it into the local D1 (wrangler dev's database).
// Deterministic (seeded PRNG) so screenshots are comparable run to run.
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const weighted = (pairs) => {
  const total = pairs.reduce((n, [, w]) => n + w, 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[pairs.length - 1][0];
};
const id = (n = 22) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rnd() * 36)]).join("");
const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const SITE = { id: "00000000-0000-4000-8000-000000000001", key: "5e1fh05tde40a1b2c3".replace(/[^a-f0-9]/g, "0").slice(0, 18), name: "Acme Notes", domain: "acmenotes.app" };
const SITE2 = { id: "00000000-0000-4000-8000-000000000002", key: "0123456789abcdef99", name: "Side project", domain: "sideproject.dev" };
const now = Date.now();
const DAY = 86_400_000;

// [referrer, channel, utm_source, utm_medium, weight, conversion multiplier, refund risk]
const SOURCES = [
  ["google.com", "Search", null, null, 34, 1.0, 0.04],
  ["(direct)", "Direct", null, null, 20, 1.1, 0.03],
  ["news.ycombinator.com", "Communities", null, null, 12, 1.6, 0.05],
  ["x.com", "Social", null, null, 11, 0.8, 0.25],
  ["reddit.com", "Communities", null, null, 8, 0.6, 0.1],
  ["producthunt.com", "Launch sites", null, null, 5, 1.2, 0.08],
  ["chatgpt.com", "AI", null, null, 6, 1.9, 0.02],
  ["newsletter", "Email", "newsletter", "email", 4, 2.2, 0.0],
];
const PAGES = ["/", "/pricing", "/features", "/blog/plain-text-notes", "/changelog", "/docs/getting-started", "/compare/notion"];
const LANDING = [["/", 50], ["/blog/plain-text-notes", 18], ["/pricing", 14], ["/compare/notion", 10], ["/features", 8]];
const COUNTRIES = [["US", 38], ["GB", 10], ["DE", 9], ["IN", 8], ["CA", 6], ["FR", 5], ["NL", 4], ["JM", 2], ["BR", 4], ["AU", 4]];
const PRODUCTS = [["Acme Notes Pro (yearly)", 9900, 30], ["Acme Notes Pro (monthly)", 1200, 45], ["Lifetime", 19900, 25]];
const PROVIDERS = ["stripe", "stripe", "stripe", "polar", "lemonsqueezy", "paddle", "dodo"];

const out = [];
out.push("DELETE FROM sale_ids; DELETE FROM sales; DELETE FROM sessions; DELETE FROM events; DELETE FROM sites; DELETE FROM webhook_events;");
out.push(`INSERT INTO sites (id, public_key, name, domain, created_at) VALUES (${q(SITE.id)}, ${q(SITE.key)}, ${q(SITE.name)}, ${q(SITE.domain)}, ${now - 40 * DAY}), (${q(SITE2.id)}, ${q(SITE2.key)}, ${q(SITE2.name)}, ${q(SITE2.domain)}, ${now - 10 * DAY});`);

const events = [];
const sessions = [];
const sales = [];
let orderN = 1000;

for (let d = 59; d >= 0; d--) {
  const dayStart = Math.floor((now - d * DAY) / DAY) * DAY;
  const growth = 1 + (59 - d) / 70;
  const launch = d === 9 ? 3.2 : d === 8 ? 1.8 : 1;
  const count = Math.round((70 + rnd() * 30) * growth * launch);
  for (let i = 0; i < count; i++) {
    const t = dayStart + Math.floor(rnd() * DAY);
    if (t > now - 60_000) continue;
    let src = weighted(SOURCES.map((s) => [s, s[4]]));
    if (d === 9 && rnd() < 0.5) src = SOURCES[5];
    const [referrer, channel, utmSource, utmMedium, , conv, refundRisk] = src;
    const sid = id();
    const vid = id(22);
    const entry = weighted(LANDING);
    const views = 1 + Math.floor(rnd() * rnd() * 5);
    const device = weighted([["desktop", 62], ["mobile", 34], ["tablet", 4]]);
    const browser = weighted([["Chrome", 55], ["Safari", 28], ["Firefox", 8], ["Edge", 6], ["Other", 3]]);
    const country = weighted(COUNTRIES);
    sessions.push([SITE.id, sid, vid, t, t + views * 40_000, views, channel, referrer, referrer === "news.ycombinator.com" && d < 12 ? "show-hn" : utmSource ? "october-issue" : "", utmSource, utmMedium, entry, country, device, browser]);
    let path = entry;
    for (let v = 0; v < views; v++) {
      events.push([SITE.id, t + v * 40_000, "pageview", null, vid, sid, path, null]);
      path = v === 0 && rnd() < 0.5 ? "/pricing" : pick(PAGES);
    }
    const visitedPricing = entry === "/pricing" || views > 1;
    if (visitedPricing && rnd() < 0.085 * conv) {
      const [product, price] = weighted(PRODUCTS.map((p) => [p, p[2]]));
      const ct = t + views * 40_000 + 20_000;
      events.push([SITE.id, ct, "checkout_started", null, vid, sid, "/pricing", price]);
      if (rnd() < 0.62) {
        const paidAt = ct + 60_000 + Math.floor(rnd() * 600_000);
        if (paidAt > now) continue;
        const provider = pick(PROVIDERS);
        const refunded = rnd() < refundRisk ? price : rnd() < 0.02 ? Math.round(price / 2) : 0;
        const disputed = !refunded && rnd() < 0.01 ? price : 0;
        const churned = !refunded && !disputed && product.includes("monthly") && rnd() < 0.08 ? price : 0;
        sales.push([provider, `ord_${orderN++}`, SITE.id, sid, paidAt, price, "USD", refunded, disputed, disputed ? "lost" : null, churned, product.includes("monthly") ? `sub_${orderN}` : null, 0, 1, product, `cust_${id(10)}`, channel, referrer, "", entry, country, device, browser, t]);
      }
    }
  }
}

// A few visits for the second site so the picker has something.
for (let i = 0; i < 40; i++) {
  const t = now - Math.floor(rnd() * 6 * DAY);
  const sid = id();
  const vid = id();
  sessions.push([SITE2.id, sid, vid, t, t, 1, "Direct", "(direct)", "", null, null, "/", "US", "desktop", "Chrome", ]);
  events.push([SITE2.id, t, "pageview", null, vid, sid, "/", null]);
}

const chunk = (rows, n) => Array.from({ length: Math.ceil(rows.length / n) }, (_, i) => rows.slice(i * n, i * n + n));
for (const c of chunk(sessions, 200))
  out.push(`INSERT INTO sessions (site_id, session_id, visitor_id, started_at, last_at, pageviews, channel, referrer, campaign, utm_source, utm_medium, entry_path, country, device, browser) VALUES ${c.map((r) => `(${r.map(q).join(",")})`).join(",")};`);
for (const c of chunk(events, 300))
  out.push(`INSERT INTO events (site_id, ts, type, name, visitor_id, session_id, path, amount_cents) VALUES ${c.map((r) => `(${r.map(q).join(",")})`).join(",")};`);
for (const c of chunk(sales, 200))
  out.push(`INSERT INTO sales (provider, order_id, site_id, session_id, occurred_at, amount_cents, currency, refunded_cents, disputed_cents, dispute_status, churned_cents, subscription_id, renewal, live, product, customer_hash, channel, referrer, campaign, entry_path, country, device, browser, first_seen_at) VALUES ${c.map((r) => `(${r.map(q).join(",")})`).join(",")};`);

process.stdout.write(out.join("\n") + "\n");
process.stderr.write(`seed: ${sessions.length} sessions, ${events.length} events, ${sales.length} sales, site key ${SITE.key}\n`);
