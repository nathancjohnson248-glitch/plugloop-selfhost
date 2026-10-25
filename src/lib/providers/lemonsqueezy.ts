/** Lemon Squeezy webhooks. Parsing ported from the hosted adapter (src/lib/providers/lemonsqueezy.ts). */
import { sha256Hex } from "../crypto";
import { verifyHexHmac } from "../verify";
import { plugloopIds, str, upper, type ProviderEvent, type SaleEvent, type WebhookAdapter } from "./types";

type Obj = Record<string, unknown>;
type Resource = { id: string; type: string; attributes: Obj };

function orderSale(o: Resource, custom: Obj | undefined): SaleEvent | null {
  const a = o.attributes;
  if (a.status && !["paid", "refunded", "partial_refund"].includes(String(a.status))) return null;
  const item = (a.first_order_item ?? {}) as { product_name?: string };
  return {
    kind: "sale",
    orderId: `order_${o.id}`,
    altIds: [str(a.identifier)].filter((x): x is string => Boolean(x)),
    amountCents: Number(a.total ?? 0),
    currency: upper(a.currency),
    ref: str(custom?.plugloop_ref),
    ...plugloopIds(custom),
    email: str(a.user_email),
    customerKey: str(a.customer_id) ?? str(a.user_email),
    country: null,
    subscriptionId: null,
    billingReason: "purchase",
    product: item.product_name ?? null,
    occurredAt: new Date(String(a.created_at ?? new Date().toISOString())),
    live: a.test_mode !== true,
  };
}

function refundedTotal(a: Obj) {
  if (a.refunded_amount != null) return Number(a.refunded_amount);
  return a.refunded === true || a.status === "refunded" ? Number(a.total ?? 0) : 0;
}

export const lemonsqueezy: WebhookAdapter = {
  id: "lemonsqueezy",
  label: "Lemon Squeezy",
  secretVar: "LEMONSQUEEZY_WEBHOOK_SECRET",
  events: ["order_created", "order_refunded", "subscription_payment_success", "subscription_payment_refunded", "subscription_expired"],
  where: "Lemon Squeezy → Settings → Webhooks → +. Type any long random string as the Signing secret and use the same value here.",
  verify: (body, headers, secret) => verifyHexHmac(body, headers.get("x-signature"), secret),
  // Lemon Squeezy sends no delivery id; event name + resource + its update time is unique per change.
  eventId: async (body) => {
    try {
      const p = JSON.parse(body) as { meta?: { event_name?: string }; data?: { id?: string; attributes?: { updated_at?: string } } };
      if (p.meta?.event_name && p.data?.id) return `${p.meta.event_name}:${p.data.id}:${p.data.attributes?.updated_at ?? ""}`;
    } catch {}
    return sha256Hex(body);
  },
  eventType: (p) => String((p as { meta?: { event_name?: string } }).meta?.event_name ?? "unknown"),
  parse(payload) {
    const p = payload as { meta?: { event_name?: string; custom_data?: Obj }; data?: Resource };
    const d = p.data;
    if (!d || !d.attributes) return [];
    const a = d.attributes;
    const custom = p.meta?.custom_data;
    const out: ProviderEvent[] = [];
    switch (p.meta?.event_name) {
      case "order_created": {
        const s = orderSale(d, custom);
        if (s) out.push(s);
        break;
      }
      case "order_refunded":
        out.push({ kind: "refund", ids: [`order_${d.id}`], totalRefundedCents: refundedTotal(a) });
        break;
      case "subscription_payment_success": {
        // The first payment also arrives as order_created; only renewals are new revenue here.
        if (a.billing_reason !== "renewal") break;
        out.push({
          kind: "sale",
          orderId: `invoice_${d.id}`,
          amountCents: Number(a.total ?? 0),
          currency: upper(a.currency),
          ref: str(custom?.plugloop_ref),
          ...plugloopIds(custom),
          email: str(a.user_email),
          customerKey: str(a.customer_id) ?? str(a.user_email),
          subscriptionId: str(a.subscription_id),
          billingReason: "renewal",
          isRenewal: true,
          occurredAt: new Date(String(a.created_at ?? new Date().toISOString())),
          live: a.test_mode !== true,
        });
        break;
      }
      case "subscription_payment_refunded":
        out.push({ kind: "refund", ids: [`invoice_${d.id}`], totalRefundedCents: Number(a.refunded_amount ?? a.total ?? 0) });
        break;
      case "subscription_expired":
        // Lemon Squeezy subscriptions carry no amount: the latest payment's amount is used.
        out.push({ kind: "churn", subscriptionId: String(d.id), amountCents: Number.MAX_SAFE_INTEGER, occurredAt: new Date(String(a.ends_at ?? a.updated_at ?? new Date().toISOString())) });
        break;
    }
    return out;
  },
};
