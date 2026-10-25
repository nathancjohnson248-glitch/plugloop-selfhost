import { env, exports } from "cloudflare:workers";
import { fromB64, hmac, toB64, toHex } from "../src/lib/crypto";
import { resetSchemaFlag, ensureSchema } from "../src/lib/db";
import { clearSiteCache } from "../src/lib/collect";

export const E = env as unknown as {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  STRIPE_WEBHOOK_SECRET: string;
  POLAR_WEBHOOK_SECRET: string;
  LEMONSQUEEZY_WEBHOOK_SECRET: string;
  DODO_WEBHOOK_SECRET: string;
  PADDLE_WEBHOOK_SECRET: string;
  TEST_MIGRATIONS: unknown;
};

export const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
export const ORIGIN = "https://example.com";

export async function fresh() {
  resetSchemaFlag();
  clearSiteCache();
  const db = E.DB;
  for (const t of ["sale_ids", "sales", "sessions", "events", "webhook_events", "sites", "settings"]) await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  await ensureSchema(db);
}

export const fetchWorker = (input: string, init?: RequestInit) => (exports as unknown as { default: { fetch: (r: Request) => Promise<Response> } }).default.fetch(new Request(new URL(input, "https://plugloop.test"), init));

export async function addSite(domain = "example.com", key = "a1b2c3d4e5f6a7b8c9", id = crypto.randomUUID()) {
  await E.DB.prepare("INSERT INTO sites (id, public_key, name, domain, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, key, domain, domain, Date.now()).run();
  return { id, key, domain };
}

export function collectReq(body: Record<string, unknown>, opts: { origin?: string; ua?: string; ip?: string } = {}) {
  return fetchWorker("/api/collect", {
    method: "POST",
    headers: { "Content-Type": "text/plain", Origin: opts.origin ?? ORIGIN, "User-Agent": opts.ua ?? UA, "CF-Connecting-IP": opts.ip ?? "203.0.113.7" },
    body: JSON.stringify(body),
  });
}

export async function visit(key: string, session: string, extra: Record<string, unknown> = {}, opts: { ip?: string } = {}) {
  const r = await collectReq({ k: key, t: "pageview", p: "/", s: session, w: 1280, ...extra }, opts);
  if (r.status !== 202) throw new Error(`collect ${r.status}`);
}

/* ---------- signers, mirroring each provider's scheme ---------- */

const now = () => Math.floor(Date.now() / 1000);

export async function stripeHeaders(body: string, secret = E.STRIPE_WEBHOOK_SECRET, ts = now()) {
  const sig = toHex(await hmac(secret, `${ts}.${body}`));
  return { "stripe-signature": `t=${ts},v1=${sig}`, "content-type": "application/json" };
}

export async function standardHeaders(body: string, secret: string, id = `msg_${crypto.randomUUID()}`, ts = now()) {
  const key = secret.startsWith("whsec_") ? fromB64(secret.slice(6))! : new TextEncoder().encode(secret);
  const sig = toB64(await hmac(key, `${id}.${ts}.${body}`));
  return { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}`, "content-type": "application/json" };
}

export async function lsHeaders(body: string, secret = E.LEMONSQUEEZY_WEBHOOK_SECRET) {
  return { "x-signature": toHex(await hmac(secret, body)), "content-type": "application/json" };
}

export async function paddleHeaders(body: string, secret = E.PADDLE_WEBHOOK_SECRET, ts = now()) {
  return { "paddle-signature": `ts=${ts};h1=${toHex(await hmac(secret, `${ts}:${body}`))}`, "content-type": "application/json" };
}

export async function postWebhook(provider: string, payload: unknown, headers: Record<string, string>, query = "") {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const res = await fetchWorker(`/api/webhooks/${provider}${query}`, { method: "POST", headers, body });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

export async function signedPost(provider: string, payload: unknown, query = "") {
  const body = JSON.stringify(payload);
  const headers =
    provider === "stripe" ? await stripeHeaders(body)
    : provider === "polar" ? await standardHeaders(body, E.POLAR_WEBHOOK_SECRET)
    : provider === "dodo" ? await standardHeaders(body, E.DODO_WEBHOOK_SECRET)
    : provider === "lemonsqueezy" ? await lsHeaders(body)
    : await paddleHeaders(body);
  return postWebhook(provider, body, headers, query);
}

export const sale = (orderId: string) => E.DB.prepare("SELECT * FROM sales WHERE order_id = ?").bind(orderId).first<Record<string, unknown>>();
