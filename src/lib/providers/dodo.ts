/** Dodo Payments webhooks (Standard Webhooks). Parsing ported from the hosted adapter (src/lib/providers/dodo.ts). */
import { sha256Hex } from "../crypto";
import { verifyStandard } from "../verify";
import { country2, plugloopIds, str, upper, type SaleEvent, type WebhookAdapter } from "./types";

type Obj = Record<string, unknown>;

function paymentSale(p: Obj, live: boolean): SaleEvent | null {
  if (p.status && p.status !== "succeeded") return null;
  const meta = (p.metadata ?? {}) as Obj;
  const customer = (p.customer ?? {}) as { customer_id?: string; email?: string };
  const charge = str(p.charge_type);
  return {
    kind: "sale",
    orderId: String(p.payment_id),
    amountCents: Number(p.total_amount ?? 0),
    currency: upper(p.currency),
    ref: str(meta.plugloop_ref),
    ...plugloopIds(meta),
    email: customer.email ?? null,
    customerKey: customer.customer_id ?? customer.email ?? null,
    country: country2((p.billing as { country?: string } | undefined)?.country),
    subscriptionId: str(p.subscription_id),
    billingReason: charge,
    isRenewal: charge === "renewal",
    occurredAt: new Date(String(p.created_at ?? new Date().toISOString())),
    live,
  };
}

export const dodo: WebhookAdapter = {
  id: "dodo",
  label: "Dodo Payments",
  secretVar: "DODO_WEBHOOK_SECRET",
  events: ["payment.succeeded", "refund.succeeded", "dispute.opened", "dispute.won", "dispute.lost", "subscription.cancelled"],
  where: "Dodo Payments → Developer → Webhooks → Add endpoint. Copy the Signing secret (whsec_…).",
  verify: (body, headers, secret) =>
    verifyStandard({ id: headers.get("webhook-id"), timestamp: headers.get("webhook-timestamp"), signature: headers.get("webhook-signature"), body, secret }),
  eventId: async (body, headers) => headers.get("webhook-id") ?? sha256Hex(body),
  eventType: (p) => String((p as Obj).type ?? "unknown"),
  parse(payload) {
    const e = payload as { type?: string; data?: Obj };
    const d = e.data;
    if (!d) return [];
    switch (e.type) {
      case "payment.succeeded": {
        const s = paymentSale(d, true);
        return s ? [s] : [];
      }
      case "refund.succeeded":
        return [{ kind: "refund", ids: [String(d.payment_id)], refundCents: Number(d.amount ?? 0), adjustmentId: str(d.refund_id) }];
      case "dispute.opened":
      case "dispute.won":
      case "dispute.lost":
        return [{ kind: "dispute", ids: [String(d.payment_id)], status: e.type === "dispute.lost" ? "lost" : e.type === "dispute.won" ? "won" : "open", amountCents: Math.round(Number(d.amount ?? 0)) }];
      case "subscription.cancelled":
        return [{ kind: "churn", subscriptionId: String(d.subscription_id ?? d.id), amountCents: Number(d.recurring_pre_tax_amount ?? 0) || Number.MAX_SAFE_INTEGER, occurredAt: new Date(String(d.cancelled_at ?? new Date().toISOString())) }];
    }
    return [];
  },
};
