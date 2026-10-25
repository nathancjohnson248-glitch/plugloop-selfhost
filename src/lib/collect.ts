/**
 * /api/collect: the tracker posts one small JSON event per pageview, checkout start or goal.
 * Validation and the pure helpers are ported from the hosted app (src/lib/analytics/collect.ts),
 * with zod swapped for a hand-written check to keep the Worker small.
 */
import { channelOf } from "./channel";
import { sha256Hex } from "./crypto";
import { dailySalt } from "./db";

export const EVENT_TYPES = ["pageview", "custom", "checkout_started"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
const ID = /^[A-Za-z0-9_-]{8,40}$/;
const KEY = /^[a-f0-9]{18}$/;

export type CollectInput = {
  k: string;
  t: EventType;
  p: string;
  v?: string | null;
  s: string;
  w?: number;
  r?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  n?: string;
  m?: Record<string, string | number | boolean>;
  a?: number;
};

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const clip = (v: unknown, n = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);

export function parseCollect(body: unknown): CollectInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (!isStr(b.k, 18) || !KEY.test(b.k)) return null;
  if (!(EVENT_TYPES as readonly unknown[]).includes(b.t)) return null;
  if (!isStr(b.s, 40) || !ID.test(b.s)) return null;
  if (b.v != null && (!isStr(b.v, 40) || !ID.test(b.v))) return null;
  if (b.p != null && !isStr(b.p, 2000)) return null;
  if (b.r != null && !isStr(b.r, 2000)) return null;
  if (b.w != null && !(Number.isInteger(b.w) && (b.w as number) >= 0 && (b.w as number) <= 20000)) return null;
  if (b.a != null && !(Number.isInteger(b.a) && (b.a as number) >= 0 && (b.a as number) <= 100_000_000)) return null;
  if (b.n != null && !(isStr(b.n, 60) && b.n.trim())) return null;
  let m: CollectInput["m"];
  if (b.m != null) {
    if (typeof b.m !== "object" || Array.isArray(b.m)) return null;
    m = {};
    for (const [k, v] of Object.entries(b.m as Record<string, unknown>).slice(0, 10)) {
      if (k.length > 40) continue;
      if (typeof v === "string") m[k] = v.slice(0, 200);
      else if (typeof v === "number" || typeof v === "boolean") m[k] = v;
    }
  }
  return {
    k: b.k,
    t: b.t as EventType,
    p: (b.p as string | undefined) ?? "/",
    v: (b.v as string | null | undefined) ?? null,
    s: b.s,
    w: b.w as number | undefined,
    r: b.r as string | undefined,
    source: clip(b.source),
    medium: clip(b.medium),
    campaign: clip(b.campaign),
    term: clip(b.term),
    content: clip(b.content),
    n: typeof b.n === "string" ? b.n.trim() : undefined,
    m,
    a: b.a as number | undefined,
  };
}

const BOT_RE =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|quora link|whatsapp|telegram|discordbot|slackbot|vkshare|curl|wget|python-|go-http|java\/|okhttp|axios|node-fetch|phantomjs|selenium|puppeteer|playwright|httpclient|monitor|uptime|pingdom|statuscake/i;

export function isBot(ua: string | null | undefined): boolean {
  if (!ua || ua.length < 20) return true;
  return BOT_RE.test(ua);
}

export function deviceOf(ua: string, width?: number): "desktop" | "mobile" | "tablet" {
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|windows phone/i.test(ua)) return "mobile";
  if (width && width < 768) return "mobile";
  return "desktop";
}

export function browserOf(ua: string): string {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/samsungbrowser/i.test(ua)) return "Samsung Internet";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/crios|chrome|chromium/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Other";
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The page's host must be the site's domain or one of its subdomains. */
export function domainAllowed(pageHost: string | null, siteDomain: string): boolean {
  if (!pageHost) return false;
  const h = pageHost.toLowerCase().replace(/^www\./, "");
  const d = siteDomain.toLowerCase().replace(/^www\./, "");
  return h === d || h.endsWith(`.${d}`);
}

/** External referrer host, or null for direct traffic and internal navigation. */
export function referrerHost(referrer: string | undefined, siteDomain: string): string | null {
  const h = hostOf(referrer);
  if (!h || domainAllowed(h, siteDomain)) return null;
  if (h === "t.co") return "x.com";
  if (h === "l.facebook.com" || h === "lm.facebook.com" || h === "m.facebook.com") return "facebook.com";
  if (h === "com.google.android.gm") return "mail.google.com";
  return h.slice(0, 200);
}

export function cleanPath(p: string): string {
  let path = p.split("?")[0].split("#")[0] || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  return path.slice(0, 300);
}

export function headerCountry(headers: Headers, cf?: { country?: unknown }): string | null {
  const vals = [typeof cf?.country === "string" ? cf.country : null, headers.get("cf-ipcountry")];
  for (const raw of vals) {
    const v = raw?.toUpperCase();
    if (v && /^[A-Z]{2}$/.test(v) && v !== "XX" && v !== "T1") return v;
  }
  return null;
}

type SiteRow = { id: string; domain: string };
const siteCache = new Map<string, { site: SiteRow | null; at: number }>();
export const clearSiteCache = () => siteCache.clear();

async function siteFor(db: D1Database, key: string): Promise<SiteRow | null> {
  const hit = siteCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.site;
  const site = await db.prepare("SELECT id, domain FROM sites WHERE public_key = ?").bind(key).first<SiteRow>();
  if (siteCache.size > 5000) siteCache.clear();
  siteCache.set(key, { site: site ?? null, at: Date.now() });
  return site ?? null;
}

/**
 * Visitor id: a hash of the day's random salt, the site, the IP and the user agent. The IP never
 * touches the database, the salt is replaced every day, and no cookie is ever set.
 */
export async function visitorHash(db: D1Database, siteId: string, ip: string, ua: string, now = new Date()): Promise<string> {
  const salt = await dailySalt(db, now);
  return (await sha256Hex(`${salt}:${siteId}:${ip}:${ua}`)).slice(0, 22);
}

export type CollectResult = { status: number };

export async function collect(db: D1Database, req: Request, now = new Date()): Promise<CollectResult> {
  const text = await req.text().catch(() => "");
  if (text.length > 8000) return { status: 413 };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { status: 400 };
  }
  const e = parseCollect(body);
  if (!e) return { status: 400 };
  const ua = req.headers.get("user-agent") ?? "";
  if (isBot(ua)) return { status: 202 };

  const site = await siteFor(db, e.k);
  if (!site) return { status: 404 };
  const pageHost = hostOf(req.headers.get("origin")) ?? hostOf(req.headers.get("referer"));
  if (!domainAllowed(pageHost, site.domain)) return { status: 403 };

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
  const visitor = await visitorHash(db, site.id, ip, ua, now);
  const ts = now.getTime();
  const path = cleanPath(e.p);
  const referrer = referrerHost(e.r, site.domain);
  const source = e.source?.toLowerCase() ?? null;
  const refKey = referrer ?? source ?? "(direct)";
  const channel = channelOf(referrer, source, e.medium);
  const country = headerCountry(req.headers, (req as Request & { cf?: { country?: unknown } }).cf);
  const isView = e.t === "pageview" ? 1 : 0;

  await db.batch([
    db
      .prepare("INSERT INTO events (site_id, ts, type, name, visitor_id, session_id, path, amount_cents, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(site.id, ts, e.t, e.t === "custom" ? (e.n ?? "event") : null, visitor, e.s, path, e.a ?? null, e.m ? JSON.stringify(e.m) : null),
    // The first event of a session fixes its source and landing page; later ones only count views.
    db
      .prepare(
        `INSERT INTO sessions (site_id, session_id, visitor_id, started_at, last_at, pageviews, channel, referrer, campaign, utm_source, utm_medium, entry_path, country, device, browser)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(site_id, session_id) DO UPDATE SET last_at = ?4, pageviews = sessions.pageviews + ?5`,
      )
      .bind(site.id, e.s, visitor, ts, isView, channel, refKey, e.campaign ?? "", source, e.medium ?? null, path, country, deviceOf(ua, e.w), browserOf(ua)),
  ]);
  return { status: 202 };
}
