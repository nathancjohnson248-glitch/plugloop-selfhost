/** Polar webhooks (Standard Webhooks). Parsing ported from the hosted adapter (src/lib/providers/polar.ts). */
import { sha256Hex } from "../crypto";
import { verifyStandard } from "../verify";
import { country2, plugloopIds, str, upper, type SaleEvent, type WebhookAdapter } from "./types";

type Obj = Record<string, unknown>;

function orderSale(o: Obj, live: boolean): SaleEvent | null {
  if (o.paid === false) return null;
  const meta = (o.metadata ?? {}) as Obj;
  const customer = (o.customer ?? {}) as { id?: string; email?: string; metadata?: Obj; billing_address?: { country?: string } };
  const reason = str(o.billing_reason);
  return {
    kind: "sale",
    orderId: String(o.id),
    amountCents: Number(o.total_amount ?? 0),
    currency: upper(o.currency),
    ref: str(meta.plugloop_ref),
    ...plugloopIds({ ...(customer.metadata ?? {}), ...meta }),
    email: customer.email ?? null,
    customerKey: customer.id ?? customer.email ?? str(o.customer_id),
    country: country2((o.billing_address as { country?: string } | null)?.country ?? customer.billing_address?.country),
    subscriptionId: str(o.subscription_id),
    billingReason: reason,
    isRenewal: reason === "subscription_cycle",
    product: str((o.product as Obj | undefined)?.name),
    occurredAt: new Date(String(o.created_at ?? new Date().toISOString())),
    live,
  };
}

export const polar: WebhookAdapter = {
  id: "polar",
  label: "Polar",
  secretVar: "POLAR_WEBHOOK_SECRET",
  events: ["order.paid", "order.refunded", "subscription.revoked"],
  where: "Polar → Settings → Webhooks → Add endpoint (format: Raw). Copy the secret.",
  verify: (body, headers, secret) =>
    verifyStandard({ id: headers.get("webhook-id"), timestamp: headers.get("webhook-timestamp"), signature: headers.get("webhook-signature"), body, secret }),
  eventId: async (body, headers) => headers.get("webhook-id") ?? sha256Hex(body),
  eventType: (p) => String((p as Obj).type ?? "unknown"),
  parse(payload) {
    const p = payload as { type?: string; data?: Obj };
    const o = p.data;
    if (!o) return [];
    if (p.type === "order.paid") {
      const s = orderSale(o, true);
      return s ? [s] : [];
    }
    if (p.type === "order.refunded") return [{ kind: "refund", ids: [String(o.id)], totalRefundedCents: Number(o.refunded_amount ?? 0) }];
    if (p.type === "subscription.revoked")
      return [{ kind: "churn", subscriptionId: String(o.id), amountCents: Number(o.amount ?? 0) || Number.MAX_SAFE_INTEGER, occurredAt: new Date(String(o.ended_at ?? o.modified_at ?? new Date().toISOString())) }];
    return [];
  },
};
