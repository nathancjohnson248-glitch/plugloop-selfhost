/**
 * Turn provider-neutral events into rows in `sales`. Same rules as the hosted app
 * (src/lib/sales/record.ts), minus FX conversion:
 * - a sale is stored once per (provider, order id);
 * - it is attributed to the session the tracker put in checkout metadata, else the visitor's latest
 *   session, else (renewals) the first payment of its subscription, else the same customer's
 *   earlier attributed sale, else "direct";
 * - refunds and disputes match the order id or any of its alternative ids;
 * - a cancelled subscription moves its recurring amount out of "kept" on its latest payment.
 */
import { sha256Hex } from "./crypto";
import type { ChurnEvent, DisputeEvent, ProviderEvent, ProviderId, RefundEvent, SaleEvent } from "./providers/types";

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const cleanId = (v: string | null | undefined) => (v && ID_RE.test(v) ? v : null);

type Source = {
  site_id: string | null;
  session_id: string | null;
  channel: string;
  referrer: string;
  campaign: string;
  entry_path: string;
  country: string | null;
  device: string | null;
  browser: string | null;
  first_seen_at: number | null;
};

const DIRECT: Omit<Source, "site_id"> = { session_id: null, channel: "Direct", referrer: "(direct)", campaign: "", entry_path: "/", country: null, device: null, browser: null, first_seen_at: null };

async function sessionSource(db: D1Database, sessionId: string | null, visitorId: string | null, before: number): Promise<Source | null> {
  const cols = "site_id, session_id, channel, referrer, campaign, entry_path, country, device, browser";
  const firstSeen = async (siteId: string, visitor: string) =>
    (await db.prepare("SELECT MIN(started_at) t FROM sessions WHERE site_id = ? AND visitor_id = ?").bind(siteId, visitor).first<{ t: number | null }>())?.t ?? null;
  for (const id of [sessionId, visitorId]) {
    if (!id) continue;
    // The tracker's ids are per-session (cookieless), so either id names a session.
    const row = await db.prepare(`SELECT ${cols}, visitor_id FROM sessions WHERE session_id = ? ORDER BY started_at DESC LIMIT 1`).bind(id).first<Source & { visitor_id: string }>();
    if (row) return { ...row, first_seen_at: await firstSeen(row.site_id!, row.visitor_id) };
  }
  if (visitorId) {
    const row = await db
      .prepare(`SELECT ${cols}, visitor_id FROM sessions WHERE visitor_id = ? AND started_at <= ? ORDER BY started_at DESC LIMIT 1`)
      .bind(visitorId, before)
      .first<Source & { visitor_id: string }>();
    if (row) return { ...row, first_seen_at: await firstSeen(row.site_id!, row.visitor_id) };
  }
  return null;
}

const SALE_SOURCE_COLS = "site_id, session_id, channel, referrer, campaign, entry_path, country, device, browser, first_seen_at";

async function recordSale(db: D1Database, provider: ProviderId, s: SaleEvent, fallbackSiteId: string | null): Promise<boolean> {
  const at = s.occurredAt.getTime() || Date.now();
  const sessionId = cleanId(s.sessionId);
  const visitorId = cleanId(s.visitorId);
  const customerHash = s.customerKey ? await sha256Hex(`customer:${s.customerKey.trim().toLowerCase()}`) : s.email ? await sha256Hex(`email:${s.email.trim().toLowerCase()}`) : null;

  let src: Source | null = await sessionSource(db, sessionId, visitorId, at);
  if (!src && s.subscriptionId) {
    src = await db
      .prepare(`SELECT ${SALE_SOURCE_COLS} FROM sales WHERE provider = ? AND subscription_id = ? AND session_id IS NOT NULL ORDER BY occurred_at LIMIT 1`)
      .bind(provider, s.subscriptionId)
      .first<Source>();
  }
  if (!src && customerHash) {
    src = await db.prepare(`SELECT ${SALE_SOURCE_COLS} FROM sales WHERE customer_hash = ? AND session_id IS NOT NULL ORDER BY occurred_at LIMIT 1`).bind(customerHash).first<Source>();
  }
  let siteId = src?.site_id ?? fallbackSiteId;
  if (!siteId) siteId = (await db.prepare("SELECT id FROM sites ORDER BY created_at LIMIT 1").first<{ id: string }>())?.id ?? null;
  const v = { ...DIRECT, ...(src ?? {}), site_id: siteId };

  const res = await db
    .prepare(
      `INSERT INTO sales (provider, order_id, site_id, session_id, occurred_at, amount_cents, currency, subscription_id, renewal, live, product, customer_hash,
                          channel, referrer, campaign, entry_path, country, device, browser, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, order_id) DO NOTHING`,
    )
    .bind(
      provider, s.orderId, v.site_id, v.session_id, at, Math.max(0, Math.round(s.amountCents)), s.currency, s.subscriptionId ?? null, s.isRenewal ? 1 : 0, s.live ? 1 : 0,
      s.product ?? null, customerHash, v.channel, v.referrer, v.campaign, v.entry_path, s.country ?? v.country, v.device, v.browser, v.first_seen_at,
    )
    .run();
  if (!res.meta.changes) return false;
  const saleId = res.meta.last_row_id;
  const alts = [...new Set((s.altIds ?? []).filter((x) => x && x !== s.orderId))];
  if (alts.length) await db.batch(alts.map((a) => db.prepare("INSERT INTO sale_ids (provider, alt_id, sale_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(provider, a, saleId)));
  return true;
}

type SaleRow = { id: number; amount_cents: number; refunded_cents: number; disputed_cents: number; churned_cents: number };

async function findSale(db: D1Database, provider: ProviderId, ids: string[]): Promise<SaleRow | null> {
  for (const id of ids) {
    const row = await db
      .prepare(
        `SELECT id, amount_cents, refunded_cents, disputed_cents, churned_cents FROM sales
          WHERE provider = ?1 AND (order_id = ?2 OR id = (SELECT sale_id FROM sale_ids WHERE provider = ?1 AND alt_id = ?2))`,
      )
      .bind(provider, id)
      .first<SaleRow>();
    if (row) return row;
  }
  return null;
}

async function applyRefund(db: D1Database, provider: ProviderId, e: RefundEvent): Promise<boolean> {
  const sale = await findSale(db, provider, e.ids);
  if (!sale) return false;
  const next = e.totalRefundedCents != null ? Math.max(sale.refunded_cents, e.totalRefundedCents) : sale.refunded_cents + (e.refundCents ?? 0);
  await db.prepare("UPDATE sales SET refunded_cents = ? WHERE id = ?").bind(Math.min(sale.amount_cents, Math.max(0, next)), sale.id).run();
  return true;
}

async function applyDispute(db: D1Database, provider: ProviderId, e: DisputeEvent): Promise<boolean> {
  const sale = await findSale(db, provider, e.ids);
  if (!sale) return false;
  const lostable = Math.max(0, sale.amount_cents - sale.refunded_cents);
  const cents = e.status === "won" ? 0 : Math.min(lostable, e.amountCents || lostable);
  await db.prepare("UPDATE sales SET disputed_cents = ?, dispute_status = ? WHERE id = ?").bind(cents, e.status, sale.id).run();
  return true;
}

async function applyChurn(db: D1Database, provider: ProviderId, e: ChurnEvent): Promise<boolean> {
  const sale = await db
    .prepare("SELECT id, amount_cents, refunded_cents, disputed_cents, churned_cents FROM sales WHERE provider = ? AND subscription_id = ? ORDER BY occurred_at DESC LIMIT 1")
    .bind(provider, e.subscriptionId)
    .first<SaleRow>();
  if (!sale) return false;
  const room = Math.max(0, sale.amount_cents - sale.refunded_cents - sale.disputed_cents);
  await db.prepare("UPDATE sales SET churned_cents = ? WHERE id = ?").bind(Math.min(room, e.amountCents), sale.id).run();
  return true;
}

export type ApplyResult = { sales: number; refunds: number; disputes: number; churns: number; unmatched: number };

export async function applyEvents(db: D1Database, provider: ProviderId, events: ProviderEvent[], opts: { siteId?: string | null } = {}): Promise<ApplyResult> {
  const r: ApplyResult = { sales: 0, refunds: 0, disputes: 0, churns: 0, unmatched: 0 };
  for (const e of events) {
    if (e.kind === "sale") {
      if (await recordSale(db, provider, e, opts.siteId ?? null)) r.sales++;
    } else if (e.kind === "refund") {
      if (await applyRefund(db, provider, e)) r.refunds++;
      else r.unmatched++;
    } else if (e.kind === "dispute") {
      if (await applyDispute(db, provider, e)) r.disputes++;
      else r.unmatched++;
    } else if (e.kind === "churn") {
      if (await applyChurn(db, provider, e)) r.churns++;
      else r.unmatched++;
    }
  }
  return r;
}
