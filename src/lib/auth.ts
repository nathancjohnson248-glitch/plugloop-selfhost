/**
 * Single-owner auth. The password comes from the ADMIN_PASSWORD secret, or, when that is not set,
 * from a PBKDF2 hash chosen on the first-run /setup page and kept in D1. A signed, HttpOnly cookie
 * holds the session; changing the password signs everyone out.
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Env } from "../env";
import { b64url, fromB64, hashPassword, hmac, randomHex, safeEqual, sha256Hex, verifyPassword } from "./crypto";
import { getSetting, setSettingOnce } from "./db";

export const COOKIE = "pl_owner";
const MAX_AGE = 60 * 60 * 24 * 30;
const enc = new TextEncoder();

export type AuthMode = "env" | "db" | "unset";

export async function authMode(env: Env): Promise<AuthMode> {
  if (env.ADMIN_PASSWORD) return "env";
  return (await getSetting(env.DB, "password_hash")) ? "db" : "unset";
}

async function signingKey(env: Env): Promise<string> {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  return setSettingOnce(env.DB, "session_key", randomHex(32));
}

/** Changes whenever the password does, so old cookies stop working. */
async function passwordVersion(env: Env): Promise<string> {
  const basis = env.ADMIN_PASSWORD ? `env:${env.ADMIN_PASSWORD}` : `db:${(await getSetting(env.DB, "password_hash")) ?? ""}`;
  return (await sha256Hex(basis)).slice(0, 12);
}

export async function checkPassword(env: Env, password: string): Promise<boolean> {
  if (!password) return false;
  if (env.ADMIN_PASSWORD) {
    // Compare digests so the comparison takes the same time whatever the lengths.
    const [a, b] = await Promise.all([sha256Hex(password), sha256Hex(env.ADMIN_PASSWORD)]);
    return safeEqual(enc.encode(a), enc.encode(b));
  }
  const stored = await getSetting(env.DB, "password_hash");
  return stored ? verifyPassword(password, stored) : false;
}

/** First-run: store a password hash only if none exists yet (first writer wins). */
export async function setInitialPassword(env: Env, password: string): Promise<boolean> {
  const hash = await hashPassword(password);
  const stored = await setSettingOnce(env.DB, "password_hash", hash);
  return stored === hash;
}

export async function makeToken(env: Env, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + MAX_AGE;
  const payload = `${exp}.${await passwordVersion(env)}`;
  return `${payload}.${b64url(await hmac(await signingKey(env), payload))}`;
}

export async function verifyToken(env: Env, token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [exp, ver, sig] = token.split(".");
  if (!exp || !ver || !sig || Number(exp) < Math.floor(now / 1000)) return false;
  if (ver !== (await passwordVersion(env))) return false;
  const expected = await hmac(await signingKey(env), `${exp}.${ver}`);
  const got = fromB64(sig);
  return got ? safeEqual(got, expected) : false;
}

export async function signIn(c: Context<AppEnv>) {
  setCookie(c, COOKIE, await makeToken(c.env), { httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: "/", maxAge: MAX_AGE });
}

export function signOut(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE, { path: "/" });
}

export const isSignedIn = (c: Context<AppEnv>) => verifyToken(c.env, getCookie(c, COOKIE));

/** POSTs from the dashboard must come from the dashboard's own origin. */
export function sameOrigin(c: Context<AppEnv>): boolean {
  const origin = c.req.header("origin");
  if (!origin) return true; // Older browsers omit Origin on same-origin form posts; SameSite=Lax still applies.
  return origin === new URL(c.req.url).origin;
}
