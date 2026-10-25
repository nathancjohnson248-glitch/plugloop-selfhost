/**
 * Webhook signature checks, ported from the hosted app (src/lib/webhooks/verify.ts and the Paddle
 * adapter) from node:crypto to Web Crypto. Same formats, same 5-minute replay window.
 */
import { fromB64, fromHex, hmac, safeEqual } from "./crypto";

const enc = new TextEncoder();
const TOLERANCE = 300;
const fresh = (ts: number, now: number, tol: number) => Number.isFinite(ts) && Math.abs(Math.floor(now / 1000) - ts) <= tol;

/** Stripe-Signature: "t=<ts>,v1=<hex>[,v1=<hex>]"; HMAC-SHA256 hex over `${t}.${body}`. */
export async function verifyStripe(body: string, header: string | null, secret: string, now = Date.now(), tol = TOLERANCE): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const v1 = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !v1.length || !fresh(Number(t), now, tol)) return false;
  const expected = await hmac(secret, `${t}.${body}`);
  return v1.some((v) => {
    const got = /^[0-9a-f]{64}$/i.test(v) ? fromHex(v) : null;
    return got ? safeEqual(got, expected) : false;
  });
}

/**
 * Standard Webhooks (Polar, Dodo): HMAC-SHA256 over `${id}.${timestamp}.${body}`, base64, header
 * "v1,<sig>" (space-separated list). Secret "whsec_<base64>" or raw; both encodings are tried.
 */
export async function verifyStandard(opts: { id: string | null; timestamp: string | null; signature: string | null; body: string; secret: string; now?: number; tol?: number }): Promise<boolean> {
  const { id, timestamp, signature, body, secret } = opts;
  if (!id || !timestamp || !signature || !secret) return false;
  if (!fresh(Number(timestamp), opts.now ?? Date.now(), opts.tol ?? TOLERANCE)) return false;
  const keys: Uint8Array[] = [];
  if (secret.startsWith("whsec_")) {
    const k = fromB64(secret.slice(6));
    if (k) keys.push(k);
    keys.push(enc.encode(secret));
  } else {
    keys.push(enc.encode(secret));
    const k = fromB64(secret);
    if (k && k.length) keys.push(k);
  }
  const sigs = signature
    .split(" ")
    .map((p) => fromB64((p.includes(",") ? p.split(",")[1] : p) ?? ""))
    .filter((s): s is Uint8Array => Boolean(s));
  for (const key of keys) {
    const expected = await hmac(key, `${id}.${timestamp}.${body}`);
    if (sigs.some((s) => safeEqual(s, expected))) return true;
  }
  return false;
}

/** Lemon Squeezy X-Signature: HMAC-SHA256 hex of the raw body. */
export async function verifyHexHmac(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret || !/^[0-9a-f]{64}$/i.test(header)) return false;
  return safeEqual(fromHex(header)!, await hmac(secret, body));
}

/** Paddle-Signature: "ts=<unix>;h1=<hex>" where h1 = HMAC-SHA256(secret, "<ts>:<raw body>"). */
export async function verifyPaddle(body: string, header: string | null, secret: string, now = Date.now(), tol = TOLERANCE): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(";").map((p) => p.trim());
  const ts = parts.find((p) => p.startsWith("ts="))?.slice(3);
  const sigs = parts.filter((p) => p.startsWith("h1=")).map((p) => p.slice(3));
  if (!ts || !sigs.length || !fresh(Number(ts), now, tol)) return false;
  const expected = await hmac(secret, `${ts}:${body}`);
  return sigs.some((h) => {
    const got = /^[0-9a-f]{64}$/i.test(h) ? fromHex(h) : null;
    return got ? safeEqual(got, expected) : false;
  });
}
