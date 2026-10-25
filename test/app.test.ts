import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { app, maintenance } from "../src/index";
import { SCHEMA_STATEMENTS } from "../src/schema";
import { loadDash } from "../src/lib/dashboard";
import { E, addSite, collectReq, fetchWorker, fresh, signedPost, visit } from "./helpers";

const cookieFrom = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];

async function login(password = E.ADMIN_PASSWORD) {
  return fetchWorker("/login", { method: "POST", body: new URLSearchParams({ password }), headers: { "content-type": "application/x-www-form-urlencoded" }, redirect: "manual" });
}

describe("schema", () => {
  it("the migration file and the runtime schema are the same statements", async () => {
    const migs = E.TEST_MIGRATIONS as { name: string; queries: string[] }[];
    expect(migs.map((m) => m.name)).toEqual(["0001_init.sql"]);
    const norm = (s: string) => s.replace(/--[^\n]*\n/g, "").replace(/\s+/g, " ").replace(/;$/, "").trim();
    expect(migs[0].queries.map(norm)).toEqual(SCHEMA_STATEMENTS.map(norm));
  });

  it("migrations apply cleanly on top of a self-created schema (both paths are idempotent)", async () => {
    await fresh();
    await applyD1Migrations(E.DB, E.TEST_MIGRATIONS as Parameters<typeof applyD1Migrations>[1]);
    const t = (await E.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sales'").all()).results;
    expect(t).toHaveLength(1);
  });
});

describe("auth", () => {
  beforeEach(fresh);

  it("sends visitors to /login and rejects a wrong password", async () => {
    const r = await fetchWorker("/", { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/login");
    expect((await login("nope")).status).toBe(401);
    expect((await fetchWorker("/api/stats")).status).toBe(401);
  });

  it("signs in with ADMIN_PASSWORD and sets an HttpOnly session cookie", async () => {
    await addSite();
    const r = await login();
    expect(r.status).toBe(302);
    const set = r.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    const page = await fetchWorker("/", { headers: { cookie: cookieFrom(r) } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("You kept");
  });

  it("rejects a tampered cookie and cross-origin posts", async () => {
    const r = await login();
    const c = cookieFrom(r);
    const tampered = c.replace(/.$/, (x) => (x === "A" ? "B" : "A"));
    expect((await fetchWorker("/", { headers: { cookie: tampered }, redirect: "manual" })).status).toBe(302);
    const x = await fetchWorker("/login", { method: "POST", body: new URLSearchParams({ password: E.ADMIN_PASSWORD }), headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.test" } });
    expect(x.status).toBe(403);
  });

  it("first run: with no ADMIN_PASSWORD the first visitor picks one, once", async () => {
    const env = { ...E, ADMIN_PASSWORD: undefined } as never;
    const go = (path: string, init?: RequestInit) => app.fetch(new Request(new URL(path, "https://plugloop.test"), { redirect: "manual", ...init }), env);
    const r = await go("/");
    expect(r.headers.get("location")).toBe("/first-run");
    const form = (pw: string, confirm = pw) => ({ method: "POST", body: new URLSearchParams({ password: pw, confirm }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect((await go("/first-run", form("short"))).status).toBe(400);
    expect((await go("/first-run", form("long enough pw", "different pw!"))).status).toBe(400);
    const ok = await go("/first-run", form("long enough pw"));
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/sites");
    // A second attempt cannot replace it.
    const again = await go("/first-run", form("someone else!!"));
    expect(again.headers.get("location")).toBe("/login");
    expect((await go("/login", form("someone else!!"))).status).toBe(401);
    expect((await go("/login", form("long enough pw"))).status).toBe(302);
    const stored = (await E.DB.prepare("SELECT value FROM settings WHERE key = 'password_hash'").first<{ value: string }>())!.value;
    expect(stored).toMatch(/^pbkdf2\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  });
});

describe("sites and setup pages", () => {
  beforeEach(fresh);

  it("adds a site, shows its snippet, and lists every provider's webhook URL", async () => {
    const c = cookieFrom(await login());
    const add = await fetchWorker("/sites", { method: "POST", body: new URLSearchParams({ name: "Shop", domain: "https://www.Shop.example/path" }), headers: { cookie: c, "content-type": "application/x-www-form-urlencoded" }, redirect: "manual" });
    expect(add.status).toBe(302);
    const row = await E.DB.prepare("SELECT * FROM sites").first<{ domain: string; public_key: string }>();
    expect(row!.domain).toBe("shop.example");
    expect(row!.public_key).toMatch(/^[0-9a-f]{18}$/);
    const html = await (await fetchWorker("/sites", { headers: { cookie: c } })).text();
    expect(html).toContain(`data-site=&quot;${row!.public_key}&quot;`);
    const setup = await (await fetchWorker("/setup", { headers: { cookie: c } })).text();
    for (const p of ["stripe", "polar", "lemonsqueezy", "dodo", "paddle"]) expect(setup).toContain(`/api/webhooks/${p}`);
    expect(setup).toContain("STRIPE_WEBHOOK_SECRET");
  });
});

describe("dashboard numbers", () => {
  beforeEach(fresh);

  it("kept = gross − refunds − chargebacks; unpaid checkouts are leaks; sources ranked by kept", async () => {
    const site = await addSite();
    const A = "sessHNHNHNHNHNHNHNHNHN";
    const B = "sessGOGOGOGOGOGOGOGOGO";
    const C = "sessXXXXXXXXXXXXXXXXXX";
    await visit(site.key, A, { r: "https://news.ycombinator.com/", p: "/pricing" }, { ip: "1.1.1.1" });
    await visit(site.key, B, { r: "https://www.google.com/", p: "/" }, { ip: "2.2.2.2" });
    await visit(site.key, C, { r: "https://x.com/", p: "/pricing" }, { ip: "3.3.3.3" });
    await collectReq({ k: site.key, t: "checkout_started", p: "/pricing", s: C, a: 4900 }, { ip: "3.3.3.3" });
    const co = (id: string, s: string, pi: string, amt: number) => ({ id, type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), livemode: true, data: { object: { id: `cs_${pi}`, payment_status: "paid", payment_intent: pi, amount_total: amt, currency: "usd", client_reference_id: `${s}_${s}` } } });
    await signedPost("stripe", co("e1", A, "pi_a", 10000));
    await signedPost("stripe", co("e2", B, "pi_b", 4900));
    await signedPost("stripe", { id: "e3", type: "charge.refunded", data: { object: { payment_intent: "pi_b", amount_refunded: 4900 } } });

    const d = await loadDash(E.DB, site.id, "7d");
    expect(d.kpis.visitors.value).toBe(3);
    expect(d.net).toMatchObject({ grossCents: 14900, refundCents: 4900, netCents: 10000 });
    expect(d.leftOnTable).toMatchObject({ totalCents: 4900, abandoned: 1, checkouts: 1 });
    expect(d.breakdown.referrer[0].id).toBe("news.ycombinator.com");
    expect(d.breakdown.referrer.map((r) => r.id).sort()).toEqual(["google.com", "news.ycombinator.com", "x.com"]);
    expect(d.breakdown.referrer.find((r) => r.id === "google.com")).toMatchObject({ grossCents: 4900, refundCents: 4900, netCents: 0 });
    expect(d.breakdown.referrer.find((r) => r.id === "x.com")).toMatchObject({ abandoned: 1, abandonedCents: 4900 });
    expect(d.breakdown.referrer[0].netCents).toBe(10000);
    expect(d.insights.length).toBeGreaterThan(0);
    expect(d.sales[0]).toMatchObject({ status: "refunded" });
    const c = cookieFrom(await login());
    const page = await (await fetchWorker(`/?site=${site.id}&period=7d`, { headers: { cookie: c } })).text();
    expect(page).toContain("$100");
    expect(page).toContain("Money flow");
    expect(page).toContain("Leaks");
    const api = (await (await fetchWorker(`/api/stats?site=${site.key}`, { headers: { cookie: c } })).json()) as { net: { netCents: number } };
    expect(api.net.netCents).toBe(10000);
  });

  it("maintenance drops events past retention and the old salt", async () => {
    const site = await addSite();
    await visit(site.key, "sessOLDOLDOLDOLDOLDOLD");
    await E.DB.prepare("UPDATE events SET ts = ?").bind(Date.now() - 500 * 86_400_000).run();
    await E.DB.prepare("UPDATE settings SET value = json_set(value, '$.day', '2020-01-01') WHERE key = 'salt'").run();
    await maintenance(E as never);
    expect(await E.DB.prepare("SELECT COUNT(*) n FROM events").first()).toEqual({ n: 0 });
    expect(await E.DB.prepare("SELECT COUNT(*) n FROM settings WHERE key = 'salt'").first()).toEqual({ n: 0 });
  });
});
