/**
 * Plugloop self-hosted: one Worker, one D1 database.
 *
 *   GET  /js/script.js              tracker (cookieless)
 *   POST /api/collect               events from the tracker
 *   POST /api/webhooks/:provider    Stripe, Polar, Lemon Squeezy, Dodo, Paddle (signed)
 *   GET  /api/stats                 the dashboard's numbers as JSON (owner only)
 *   GET  /                          the money ledger (owner only)
 *   /sites, /setup, /login, /first-run, /logout
 */
import { Hono, type Context } from "hono";
import { jsx } from "hono/jsx";
import type { AppEnv, Env } from "./env";
import { authMode, checkPassword, isSignedIn, sameOrigin, setInitialPassword, signIn, signOut } from "./lib/auth";
import { clearSiteCache, collect } from "./lib/collect";
import { randomHex } from "./lib/crypto";
import { ensureSchema, getSetting, setSetting } from "./lib/db";
import { isPeriod, type BreakdownTab, type Period } from "./lib/dash/types";
import { loadDash } from "./lib/dashboard";
import { ADAPTERS, PROVIDERS, isProvider } from "./lib/providers";
import { applyEvents } from "./lib/sales";
import { TRACKER } from "./tracker";
import { DashboardPage, type SiteLite } from "./views/dashboard";
import { FirstRunPage, LoginPage, SetupPage, SitesPage } from "./views/pages";

const app = new Hono<AppEnv>();
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };
const SECURITY = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" };

app.use("*", async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

/* ---------- public: tracker, collector, webhooks ---------- */

app.get("/js/script.js", (c) =>
  c.body(TRACKER, 200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" }),
);
app.get("/api/health", (c) => c.json({ ok: true }));

app.options("/api/collect", () => new Response(null, { status: 204, headers: CORS }));
app.post("/api/collect", async (c) => {
  const { status } = await collect(c.env.DB, c.req.raw);
  return new Response(null, { status, headers: CORS });
});

app.post("/api/webhooks/:provider", async (c) => {
  const provider = c.req.param("provider");
  if (!isProvider(provider)) return c.json({ error: "unknown provider" }, 404);
  const adapter = ADAPTERS[provider];
  const secret = c.env[adapter.secretVar];
  if (!secret) return c.json({ error: `${adapter.secretVar} is not set` }, 404);
  const body = await c.req.text();
  if (body.length > 1_000_000) return c.json({ error: "too large" }, 413);
  if (!(await adapter.verify(body, c.req.raw.headers, secret))) return c.json({ error: "bad signature" }, 401);
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const db = c.env.DB;
  const eventId = await adapter.eventId(body, c.req.raw.headers);
  const type = adapter.eventType(payload);
  const now = Date.now();
  const ins = await db.prepare("INSERT INTO webhook_events (provider, event_id, event_type, received_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(provider, eventId, type, now).run();
  await setSetting(db, `last_webhook:${provider}`, JSON.stringify({ at: now, type }));
  if (!ins.meta.changes) return c.json({ ok: true, duplicate: true });

  // Optional ?site=KEY pins sales without a tracked visit to one site.
  const key = c.req.query("site");
  const pinned = key && /^[a-f0-9]{18}$/.test(key) ? ((await db.prepare("SELECT id FROM sites WHERE public_key = ?").bind(key).first<{ id: string }>())?.id ?? null) : null;
  try {
    const result = await applyEvents(db, provider, adapter.parse(payload), { siteId: pinned });
    return c.json({ ok: true, ...result });
  } catch (e) {
    // Let the provider retry: forget the delivery so the retry is not treated as a duplicate.
    await db.prepare("DELETE FROM webhook_events WHERE provider = ? AND event_id = ?").bind(provider, eventId).run();
    console.error("[webhook]", provider, e instanceof Error ? e.message : e);
    return c.json({ error: "failed to record" }, 500);
  }
});

/* ---------- auth ---------- */

const html = (c: Context<AppEnv>, node: unknown, status = 200) => c.html(node as string, status as 200, SECURITY);

app.get("/login", async (c) => {
  if ((await authMode(c.env)) === "unset") return c.redirect("/first-run");
  return html(c, jsx(LoginPage, {}));
});

app.post("/login", async (c) => {
  if (!sameOrigin(c)) return c.text("Bad origin", 403);
  const form = await c.req.parseBody();
  const ok = await checkPassword(c.env, String(form.password ?? ""));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 400)); // Slow down guessing a little.
    return html(c, jsx(LoginPage, { error: "That password didn't match." }), 401);
  }
  await signIn(c);
  return c.redirect("/");
});

app.post("/logout", (c) => {
  signOut(c);
  return c.redirect("/login");
});

app.get("/first-run", async (c) => {
  if ((await authMode(c.env)) !== "unset") return c.redirect("/login");
  return html(c, jsx(FirstRunPage, {}));
});

app.post("/first-run", async (c) => {
  if (!sameOrigin(c)) return c.text("Bad origin", 403);
  if ((await authMode(c.env)) !== "unset") return c.redirect("/login");
  const form = await c.req.parseBody();
  const pw = String(form.password ?? "");
  if (pw.length < 10) return html(c, jsx(FirstRunPage, { error: "Use at least 10 characters." }), 400);
  if (pw !== String(form.confirm ?? "")) return html(c, jsx(FirstRunPage, { error: "The two passwords don't match." }), 400);
  if (!(await setInitialPassword(c.env, pw))) return c.redirect("/login");
  await signIn(c);
  return c.redirect("/sites");
});

/* ---------- owner-only ---------- */

const owner = new Hono<AppEnv>();
owner.use("*", async (c, next) => {
  if (await isSignedIn(c)) return next();
  if ((await authMode(c.env)) === "unset") return c.redirect("/first-run");
  if (c.req.path.startsWith("/api/")) return c.json({ error: "unauthorized" }, 401);
  return c.redirect("/login");
});

async function listSites(db: D1Database): Promise<SiteLite[]> {
  return (await db.prepare("SELECT id, name, domain, public_key FROM sites ORDER BY created_at").all<SiteLite>()).results ?? [];
}

const TABS: BreakdownTab[] = ["channel", "referrer", "campaign"];

owner.get("/", async (c) => {
  const sites = await listSites(c.env.DB);
  if (!sites.length) return c.redirect("/sites");
  const site = sites.find((s) => s.id === c.req.query("site")) ?? sites[0];
  const period: Period = isPeriod(c.req.query("period")) ? (c.req.query("period") as Period) : "7d";
  const tab = (TABS as string[]).includes(c.req.query("tab") ?? "") ? (c.req.query("tab") as BreakdownTab) : "referrer";
  const now = Date.now();
  const currency = c.env.CURRENCY || "USD";
  const [data, any] = await Promise.all([
    loadDash(c.env.DB, site.id, period, { now, includeTest: c.env.INCLUDE_TEST_SALES === "true", currency }),
    c.env.DB.prepare("SELECT 1 x FROM events WHERE site_id = ? LIMIT 1").bind(site.id).first(),
  ]);
  return html(c, jsx(DashboardPage, { data, sites, site, period, tab, origin: new URL(c.req.url).origin, currency, now, hasEvents: Boolean(any) }));
});

owner.get("/api/stats", async (c) => {
  const sites = await listSites(c.env.DB);
  const site = sites.find((s) => s.id === c.req.query("site") || s.public_key === c.req.query("site")) ?? sites[0];
  if (!site) return c.json({ error: "no sites" }, 404);
  const period: Period = isPeriod(c.req.query("period")) ? (c.req.query("period") as Period) : "7d";
  return c.json({ site, ...(await loadDash(c.env.DB, site.id, period, { includeTest: c.env.INCLUDE_TEST_SALES === "true", currency: c.env.CURRENCY || "USD" })) });
});

async function sitesView(c: Context<AppEnv>, extra: { error?: string; added?: string } = {}, status = 200) {
  const sites = await listSites(c.env.DB);
  const counts = (await c.env.DB.prepare("SELECT site_id, COUNT(*) n FROM events GROUP BY site_id").all<{ site_id: string; n: number }>()).results ?? [];
  const by = new Map(counts.map((r) => [r.site_id, r.n]));
  return html(c, jsx(SitesPage, { sites: sites.map((s) => ({ ...s, events: by.get(s.id) ?? 0 })), origin: new URL(c.req.url).origin, ...extra }), status);
}

owner.get("/sites", (c) => sitesView(c, { added: c.req.query("added") }));

export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "");
  if (d === "localhost") return d;
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) ? d : null;
}

owner.post("/sites", async (c) => {
  if (!sameOrigin(c)) return c.text("Bad origin", 403);
  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim().slice(0, 80);
  const domain = normalizeDomain(String(form.domain ?? ""));
  if (!name || !domain) return sitesView(c, { error: "Give the site a name and a domain like example.com." }, 400);
  await c.env.DB.prepare("INSERT INTO sites (id, public_key, name, domain, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), randomHex(9), name, domain, Date.now()).run();
  return c.redirect(`/sites?added=${encodeURIComponent(domain)}`);
});

owner.post("/sites/:id/delete", async (c) => {
  if (!sameOrigin(c)) return c.text("Bad origin", 403);
  const id = c.req.param("id");
  const site = await c.env.DB.prepare("SELECT id, domain FROM sites WHERE id = ?").bind(id).first<{ id: string; domain: string }>();
  const form = await c.req.parseBody();
  if (!site || String(form.confirm ?? "").trim().toLowerCase() !== site.domain) return sitesView(c, { error: "Type the site's domain exactly to delete it." }, 400);
  const db = c.env.DB;
  await db.batch([
    db.prepare("DELETE FROM events WHERE site_id = ?").bind(id),
    db.prepare("DELETE FROM sessions WHERE site_id = ?").bind(id),
    db.prepare("DELETE FROM sale_ids WHERE sale_id IN (SELECT id FROM sales WHERE site_id = ?)").bind(id),
    db.prepare("DELETE FROM sales WHERE site_id = ?").bind(id),
    db.prepare("DELETE FROM sites WHERE id = ?").bind(id),
  ]);
  clearSiteCache();
  return c.redirect("/sites");
});

owner.get("/setup", async (c) => {
  const providers = await Promise.all(
    PROVIDERS.map(async (a) => {
      const last = await getSetting(c.env.DB, `last_webhook:${a.id}`);
      const parsed = last ? (JSON.parse(last) as { at: number; type: string }) : null;
      return { a, configured: Boolean(c.env[a.secretVar]), lastAt: parsed ? new Date(parsed.at).toISOString().replace("T", " ").slice(0, 16) + " UTC" : null, lastType: parsed?.type ?? null };
    }),
  );
  const mode = await authMode(c.env);
  return html(c, jsx(SetupPage, { origin: new URL(c.req.url).origin, providers, auth: mode === "env" ? "env" : "db", sites: await listSites(c.env.DB) }));
});

app.route("/", owner);

/* ---------- daily maintenance ---------- */

export async function maintenance(env: Env, now = Date.now()) {
  await ensureSchema(env.DB);
  const days = Math.max(30, Number(env.RETENTION_DAYS) || 400);
  const cutoff = now - days * 86_400_000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events WHERE ts < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM sessions WHERE started_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM webhook_events WHERE received_at < ?").bind(now - 30 * 86_400_000),
    // Drop the salt so yesterday's visitor hashes can never be recomputed; the next event makes a new one.
    env.DB.prepare("DELETE FROM settings WHERE key = 'salt' AND json_extract(value, '$.day') < ?").bind(new Date(now).toISOString().slice(0, 10)),
  ]);
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(maintenance(env));
  },
} satisfies ExportedHandler<Env>;

export { app };
