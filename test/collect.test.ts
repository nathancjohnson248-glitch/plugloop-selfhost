import { beforeEach, describe, expect, it } from "vitest";
import { visitorHash } from "../src/lib/collect";
import { resetSchemaFlag } from "../src/lib/db";
import { E, UA, addSite, collectReq, fetchWorker, fresh, visit } from "./helpers";

const S1 = "sessAAAAAAAAAAAAAAAAAA";

describe("tracker + /api/collect", () => {
  let site: Awaited<ReturnType<typeof addSite>>;
  beforeEach(async () => {
    await fresh();
    site = await addSite();
  });

  it("serves a cookieless tracker", async () => {
    const r = await fetchWorker("/js/script.js");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("javascript");
    const js = await r.text();
    expect(js).toContain("/api/collect");
    expect(js).not.toContain("document.cookie");
    expect(js).not.toContain("d.cookie");
    expect(js).not.toContain("localStorage");
  });

  it("answers CORS preflight", async () => {
    const r = await fetchWorker("/api/collect", { method: "OPTIONS" });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("stores a pageview with its session source, sets no cookie, never stores the IP", async () => {
    const r = await collectReq({ k: site.key, t: "pageview", p: "/pricing?x=1#top", s: S1, w: 390, r: "https://news.ycombinator.com/item?id=1", campaign: "launch" }, { ip: "198.51.100.23" });
    expect(r.status).toBe(202);
    expect(r.headers.get("set-cookie")).toBeNull();
    const ev = await E.DB.prepare("SELECT * FROM events").first<Record<string, unknown>>();
    expect(ev).toMatchObject({ site_id: site.id, type: "pageview", path: "/pricing", session_id: S1 });
    expect(String(ev!.visitor_id)).toMatch(/^[0-9a-f]{22}$/);
    const sess = await E.DB.prepare("SELECT * FROM sessions").first<Record<string, unknown>>();
    expect(sess).toMatchObject({ channel: "Communities", referrer: "news.ycombinator.com", campaign: "launch", entry_path: "/pricing", pageviews: 1, device: "mobile", browser: "Safari" });
    const dump = JSON.stringify((await E.DB.prepare("SELECT * FROM events").all()).results) + JSON.stringify((await E.DB.prepare("SELECT * FROM sessions").all()).results);
    expect(dump).not.toContain("198.51.100.23");
  });

  it("keeps the first source of a session and counts later views", async () => {
    await visit(site.key, S1, { r: "https://x.com/someone", p: "/" });
    await visit(site.key, S1, { r: "https://www.google.com/", p: "/pricing" });
    const sess = await E.DB.prepare("SELECT * FROM sessions").first<Record<string, unknown>>();
    expect(sess).toMatchObject({ referrer: "x.com", channel: "Social", pageviews: 2, entry_path: "/" });
  });

  it("uses utm_source when there is no referrer, and email medium wins", async () => {
    await visit(site.key, S1, { source: "Newsletter", medium: "email" });
    expect(await E.DB.prepare("SELECT channel, referrer FROM sessions").first()).toEqual({ channel: "Email", referrer: "newsletter" });
  });

  it("records checkout_started and custom goals without counting a pageview", async () => {
    await collectReq({ k: site.key, t: "checkout_started", p: "/pricing", s: S1, a: 4900 });
    await collectReq({ k: site.key, t: "custom", p: "/", s: S1, n: "signup", m: { plan: "pro" } });
    const rows = (await E.DB.prepare("SELECT type, name, amount_cents, props FROM events ORDER BY id").all()).results;
    expect(rows).toEqual([
      { type: "checkout_started", name: null, amount_cents: 4900, props: null },
      { type: "custom", name: "signup", amount_cents: null, props: '{"plan":"pro"}' },
    ]);
    expect(await E.DB.prepare("SELECT pageviews FROM sessions").first()).toEqual({ pageviews: 0 });
  });

  it("rejects other domains, unknown keys, bad payloads and bots", async () => {
    expect((await collectReq({ k: site.key, t: "pageview", p: "/", s: S1 }, { origin: "https://evil.test" })).status).toBe(403);
    expect((await collectReq({ k: site.key, t: "pageview", p: "/", s: S1 }, { origin: "https://app.example.com" })).status).toBe(202);
    expect((await collectReq({ k: "ffffffffffffffffff", t: "pageview", p: "/", s: S1 })).status).toBe(404);
    expect((await collectReq({ k: site.key, t: "nope", p: "/", s: S1 })).status).toBe(400);
    expect((await collectReq({ k: site.key, t: "pageview", p: "/", s: "x" })).status).toBe(400);
    const bad = await fetchWorker("/api/collect", { method: "POST", headers: { Origin: "https://example.com", "User-Agent": UA }, body: "{not json" });
    expect(bad.status).toBe(400);
    expect((await collectReq({ k: site.key, t: "pageview", p: "/", s: S1 }, { ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" })).status).toBe(202);
    expect(await E.DB.prepare("SELECT COUNT(*) n FROM events").first()).toEqual({ n: 1 });
  });

  it("hashes visitors with a salt that changes every day", async () => {
    const day1 = new Date("2026-10-20T10:00:00Z");
    const a = await visitorHash(E.DB, site.id, "203.0.113.7", UA, day1);
    const b = await visitorHash(E.DB, site.id, "203.0.113.7", UA, new Date("2026-10-20T23:00:00Z"));
    expect(a).toBe(b);
    resetSchemaFlag(); // also clears the in-memory salt cache
    const c = await visitorHash(E.DB, site.id, "203.0.113.7", UA, new Date("2026-10-21T01:00:00Z"));
    expect(c).not.toBe(a);
    const other = await visitorHash(E.DB, site.id, "203.0.113.8", UA, new Date("2026-10-21T01:00:00Z"));
    expect(other).not.toBe(c);
    const salts = (await E.DB.prepare("SELECT value FROM settings WHERE key = 'salt'").all()).results;
    expect(salts).toHaveLength(1);
    expect(JSON.parse(String((salts[0] as { value: string }).value)).day).toBe("2026-10-21");
  });
});
