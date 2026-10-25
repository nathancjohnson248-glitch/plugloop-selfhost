/** Stripe webhooks. Parsing ported from the hosted adapter (src/lib/providers/stripe.ts). */
import { sha256Hex } from "../crypto";
import { verifyStripe } from "../verify";
import { country2, plugloopIds, str, upper, type ProviderEvent, type SaleEvent, type WebhookAdapter } from "./types";

type Obj = Record<string, unknown>;

export const STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "invoice.paid",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  "customer.subscription.deleted",
];

function checkoutSale(s: Obj, live: boolean, at: Date): SaleEvent | null {
  if (s.payment_status !== "paid" && s.payment_status !== "no_payment_required") return null;
  const meta = (s.metadata ?? {}) as Obj;
  const details = (s.customer_details ?? {}) as { email?: string; address?: { country?: string } };
  const pi = str(s.payment_intent);
  const invoice = str(s.invoice);
  const id = pi ?? invoice ?? String(s.id);
  return {
    kind: "sale",
    orderId: id,
    altIds: [String(s.id), pi, invoice].filter((x): x is string => Boolean(x) && x !== id),
    amountCents: Number(s.amount_total ?? 0),
    currency: upper(s.currency),
    ref: str(s.client_reference_id) ?? str(meta.plugloop_ref),
    ...plugloopIds(meta, s.client_reference_id),
    email: details.email ?? null,
    customerKey: str(s.customer) ?? details.email ?? null,
    country: country2(details.address?.country),
    subscriptionId: str(s.subscription),
    billingReason: s.mode === "subscription" ? "subscription_create" : "purchase",
    occurredAt: at,
    live,
  };
}

/** invoice.paid: only renewals (the first payment arrives as checkout.session.completed). */
function invoiceSale(inv: Obj, live: boolean, at: Date): SaleEvent | null {
  const reason = str(inv.billing_reason);
  if (reason !== "subscription_cycle") return null;
  const parent = (inv.parent ?? {}) as { subscription_details?: { subscription?: string; metadata?: Obj } };
  const sub = str(parent.subscription_details?.subscription) ?? str(inv.subscription);
  const meta = (parent.subscription_details?.metadata ?? inv.subscription_details ?? {}) as Obj;
  return {
    kind: "sale",
    orderId: String(inv.id),
    altIds: [str(inv.payment_intent), str(inv.charge)].filter((x): x is string => Boolean(x)),
    amountCents: Number(inv.amount_paid ?? 0),
    currency: upper(inv.currency),
    ref: str(meta.plugloop_ref),
    ...plugloopIds(meta),
    email: str(inv.customer_email),
    customerKey: str(inv.customer) ?? str(inv.customer_email),
    country: country2((inv.customer_address as { country?: string } | null)?.country),
    subscriptionId: sub,
    billingReason: reason,
    isRenewal: true,
    occurredAt: at,
    live,
  };
}

export const stripe: WebhookAdapter = {
  id: "stripe",
  label: "Stripe",
  secretVar: "STRIPE_WEBHOOK_SECRET",
  events: STRIPE_EVENTS,
  where: "Stripe Dashboard → Developers → Webhooks → Add endpoint. Copy the Signing secret (whsec_…).",
  verify: (body, headers, secret) => verifyStripe(body, headers.get("stripe-signature"), secret),
  eventId: async (body) => {
    try {
      const id = (JSON.parse(body) as { id?: string }).id;
      if (id) return id;
    } catch {}
    return sha256Hex(body);
  },
  eventType: (p) => String((p as Obj).type ?? "unknown"),
  parse(payload) {
    const e = payload as { type?: string; created?: number; livemode?: boolean; data?: { object?: Obj } };
    const o = e.data?.object;
    if (!o) return [];
    const at = new Date((e.created ?? Date.now() / 1000) * 1000);
    const live = e.livemode ?? true;
    const out: ProviderEvent[] = [];
    switch (e.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const s = checkoutSale(o, live, at);
        if (s) out.push(s);
        break;
      }
      case "invoice.paid": {
        const s = invoiceSale(o, live, at);
        if (s) out.push(s);
        break;
      }
      case "charge.refunded":
        out.push({ kind: "refund", ids: [str(o.payment_intent), str(o.invoice), str(o.id)].filter((x): x is string => Boolean(x)), totalRefundedCents: Number(o.amount_refunded ?? 0) });
        break;
      case "charge.dispute.created":
      case "charge.dispute.closed": {
        const st = String(o.status);
        out.push({ kind: "dispute", ids: [str(o.payment_intent), str(o.charge)].filter((x): x is string => Boolean(x)), status: st === "lost" ? "lost" : st === "won" || st === "warning_closed" ? "won" : "open", amountCents: Number(o.amount ?? 0) });
        break;
      }
      case "customer.subscription.deleted": {
        const items = (o.items as { data?: { quantity?: number; price?: { unit_amount?: number } }[] } | undefined)?.data ?? [];
        out.push({ kind: "churn", subscriptionId: String(o.id), amountCents: items.reduce((n, i) => n + Number(i.price?.unit_amount ?? 0) * (i.quantity ?? 1), 0), occurredAt: at });
        break;
      }
    }
    return out;
  },
};
