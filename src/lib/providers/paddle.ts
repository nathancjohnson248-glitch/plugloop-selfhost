/** Paddle Billing webhooks. Parsing ported from the hosted adapter (src/lib/providers/paddle.ts). */
import { sha256Hex } from "../crypto";
import { verifyPaddle } from "../verify";
import { country2, str, upper, type ProviderEvent, type SaleEvent, type WebhookAdapter } from "./types";

type Obj = Record<string, unknown>;

const cents = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

function transactionSale(t: Obj): SaleEvent | null {
  if (!t.id || !["completed", "paid", "billed"].includes(String(t.status ?? "completed"))) return null;
  const totals = ((t.details ?? {}) as { totals?: Obj }).totals ?? {};
  const amount = cents(totals.grand_total ?? totals.total);
  if (amount <= 0) return null;
  const custom = (t.custom_data ?? {}) as Obj;
  const items = (t.items ?? []) as { price?: { description?: string; name?: string; product?: { name?: string } }; product?: { name?: string } }[];
  const origin = str(t.origin);
  const customer = (t.customer ?? {}) as { email?: string };
  const address = (t.address ?? {}) as { country_code?: string };
  return {
    kind: "sale",
    orderId: String(t.id),
    altIds: [str(t.invoice_id), str(t.invoice_number)].filter((x): x is string => Boolean(x)),
    amountCents: amount,
    currency: upper(t.currency_code),
    ref: null,
    visitorId: str(custom.plugloop_visitor_id),
    sessionId: str(custom.plugloop_session_id),
    email: customer.email ?? str(custom.email),
    product: items[0]?.product?.name ?? items[0]?.price?.product?.name ?? items[0]?.price?.name ?? items[0]?.price?.description ?? null,
    customerKey: str(t.customer_id),
    country: country2(address.country_code),
    subscriptionId: str(t.subscription_id),
    billingReason: origin,
    isRenewal: origin === "subscription_recurring",
    occurredAt: new Date(String(t.billed_at ?? t.created_at ?? new Date().toISOString())),
    live: true,
  };
}

function adjustmentEvents(a: Obj): ProviderEvent[] {
  const txn = str(a.transaction_id);
  if (!txn) return [];
  const action = String(a.action ?? "");
  const status = String(a.status ?? "");
  const totals = (a.totals ?? {}) as Obj;
  const amount = cents(totals.total ?? totals.subtotal);
  if (action === "refund") return status === "approved" ? [{ kind: "refund", ids: [txn], refundCents: amount, adjustmentId: str(a.id) }] : [];
  if (action === "chargeback") return [{ kind: "dispute", ids: [txn], status: "lost", amountCents: amount }];
  if (action === "chargeback_warning") return [{ kind: "dispute", ids: [txn], status: "open", amountCents: amount }];
  if (action === "chargeback_reverse") return [{ kind: "dispute", ids: [txn], status: "won", amountCents: 0 }];
  return [];
}

function subscriptionChurn(s: Obj): ProviderEvent[] {
  if (String(s.status) !== "canceled" || !s.id) return [];
  const items = (s.items ?? []) as { quantity?: number; price?: { unit_price?: { amount?: string } } }[];
  const mrr = items.reduce((sum, i) => sum + cents(i.price?.unit_price?.amount) * (i.quantity ?? 1), 0);
  return [{ kind: "churn", subscriptionId: String(s.id), amountCents: mrr || Number.MAX_SAFE_INTEGER, occurredAt: new Date(String(s.canceled_at ?? s.updated_at ?? new Date().toISOString())) }];
}

export const paddle: WebhookAdapter = {
  id: "paddle",
  label: "Paddle",
  secretVar: "PADDLE_WEBHOOK_SECRET",
  events: ["transaction.completed", "transaction.paid", "adjustment.created", "adjustment.updated", "subscription.canceled"],
  where: "Paddle → Developer tools → Notifications → New destination (URL). Copy the Secret key.",
  verify: (body, headers, secret) => verifyPaddle(body, headers.get("paddle-signature"), secret),
  eventId: async (body) => {
    try {
      const id = (JSON.parse(body) as Obj).event_id;
      if (typeof id === "string") return id;
    } catch {}
    return sha256Hex(body);
  },
  eventType: (p) => String((p as Obj).event_type ?? "unknown"),
  parse(payload) {
    const p = payload as { event_type?: string; data?: Obj };
    const d = p.data;
    if (!d) return [];
    switch (p.event_type) {
      case "transaction.completed":
      case "transaction.paid": {
        const s = transactionSale(d);
        return s ? [s] : [];
      }
      case "adjustment.created":
      case "adjustment.updated":
        return adjustmentEvents(d);
      case "subscription.canceled":
      case "subscription.updated":
        return subscriptionChurn(d);
      default:
        return [];
    }
  },
};
