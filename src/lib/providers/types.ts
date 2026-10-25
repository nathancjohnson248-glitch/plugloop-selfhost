/** Provider-neutral events, from the hosted app (src/lib/providers/types.ts). Every adapter turns its webhooks into these. */

export type ProviderId = "stripe" | "lemonsqueezy" | "polar" | "dodo" | "paddle";

export type SaleEvent = {
  kind: "sale";
  /** Unique per provider. Refunds and disputes match on this or any of altIds. */
  orderId: string;
  altIds?: string[];
  amountCents: number;
  currency: string;
  ref: string | null;
  customerKey: string | null;
  country?: string | null;
  subscriptionId?: string | null;
  billingReason?: string | null;
  /** A subscription renewal: attribute to the tweet that sold the first payment. */
  isRenewal?: boolean;
  occurredAt: Date;
  live: boolean;
  /** From checkout metadata set by /js/script.js (plugloop.metadata()). */
  visitorId?: string | null;
  sessionId?: string | null;
  /** Customer email, used only (hashed) to fall back to a returning customer's visitor. */
  email?: string | null;
  product?: string | null;
};

export type RefundEvent = {
  kind: "refund";
  ids: string[];
  /** Total refunded so far on the order (Stripe, Polar, Lemon Squeezy)… */
  totalRefundedCents?: number;
  /** …or the amount of this refund only (Dodo). */
  refundCents?: number;
  /** Provider's id for this refund, when it has one. */
  adjustmentId?: string | null;
};

export type DisputeEvent = {
  kind: "dispute";
  ids: string[];
  status: "open" | "won" | "lost";
  amountCents?: number;
};

/** A subscription was cancelled: its recurring amount leaves net revenue on the source that sold it. */
export type ChurnEvent = { kind: "churn"; subscriptionId: string; amountCents: number; occurredAt: Date };

export type ProviderEvent = SaleEvent | RefundEvent | DisputeEvent | ChurnEvent;

export const upper = (s: unknown, fallback = "USD") => (typeof s === "string" && s ? s.toUpperCase() : fallback);
export const str = (v: unknown) => (typeof v === "string" && v ? v : v != null && v !== "" ? String(v) : null);
export const country2 = (v: unknown) => (typeof v === "string" && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null);

/** Visitor and session ids that /js/script.js put in the checkout (metadata, custom data or Stripe's client_reference_id "visitor_session"). */
export function plugloopIds(meta: Record<string, unknown> | null | undefined, clientReference?: unknown): { visitorId: string | null; sessionId: string | null } {
  const m = meta ?? {};
  let visitorId = str(m.plugloop_visitor_id);
  let sessionId = str(m.plugloop_session_id);
  const ref = str(clientReference);
  if (!visitorId && ref && /^[A-Za-z0-9-]{8,40}_[A-Za-z0-9-]{8,40}$/.test(ref)) [visitorId, sessionId] = ref.split("_");
  return { visitorId, sessionId };
}

export type WebhookAdapter = {
  id: ProviderId;
  label: string;
  /** Worker secret holding the webhook signing secret. */
  secretVar: "STRIPE_WEBHOOK_SECRET" | "POLAR_WEBHOOK_SECRET" | "LEMONSQUEEZY_WEBHOOK_SECRET" | "DODO_WEBHOOK_SECRET" | "PADDLE_WEBHOOK_SECRET";
  /** Events to tick when adding the webhook in the provider's dashboard. */
  events: string[];
  /** Where the provider's webhook settings live and what to copy, for the setup page. */
  where: string;
  verify(body: string, headers: Headers, secret: string): Promise<boolean>;
  /** Stable id for de-duplicating deliveries. */
  eventId(body: string, headers: Headers): Promise<string>;
  eventType(payload: unknown): string;
  parse(payload: unknown): ProviderEvent[];
};
