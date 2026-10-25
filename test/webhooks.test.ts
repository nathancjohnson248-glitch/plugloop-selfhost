/**
 * Each provider: a signed sale is stored and attributed to the visit that made it; a bad or stale
 * signature is rejected; refunds and chargebacks (or, where the provider has no chargeback webhook,
 * cancellations) come off what was kept; repeated deliveries are ignored.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { E, addSite, fresh, lsHeaders, paddleHeaders, postWebhook, sale, signedPost, standardHeaders, stripeHeaders, visit } from "./helpers";

const SID = "sess1234567890abcdefXY";
let site: Awaited<ReturnType<typeof addSite>>;

beforeEach(async () => {
  await fresh();
  site = await addSite();
  await visit(site.key, SID, { r: "https://news.ycombinator.com/", p: "/pricing" });
});

const expectAttributed = async (orderId: string, amount: number) => {
  const s = await sale(orderId);
  expect(s).toMatchObject({ site_id: site.id, session_id: SID, amount_cents: amount, referrer: "news.ycombinator.com", channel: "Communities", entry_path: "/pricing" });
  return s!;
};

describe("routing", () => {
  it("404s an unknown provider", async () => {
    expect((await postWebhook("square", "{}", {})).status).toBe(404);
  });
});

describe("stripe", () => {
  const checkout = (extra: Record<string, unknown> = {}) => ({
    id: "evt_1",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    livemode: true,
    data: { object: { id: "cs_1", payment_status: "paid", payment_intent: "pi_1", amount_total: 4900, currency: "usd", client_reference_id: `${SID}_${SID}`, customer: "cus_1", customer_details: { email: "a@b.co", address: { country: "DE" } }, ...extra } },
  });

  it("records a sale from a valid signature, attributed via client_reference_id", async () => {
    const r = await signedPost("stripe", checkout());
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, sales: 1 });
    const s = await expectAttributed("pi_1", 4900);
    expect(s).toMatchObject({ currency: "USD", country: "DE", live: 1 });
  });

  it("rejects a bad signature, a wrong secret and a stale timestamp", async () => {
    const body = JSON.stringify(checkout());
    expect((await postWebhook("stripe", body, { "stripe-signature": "t=1,v1=deadbeef" })).status).toBe(401);
    expect((await postWebhook("stripe", body, await stripeHeaders(body, "whsec_wrong"))).status).toBe(401);
    expect((await postWebhook("stripe", body, await stripeHeaders(body, undefined, Math.floor(Date.now() / 1000) - 3600))).status).toBe(401);
    expect((await postWebhook("stripe", body, {})).status).toBe(401);
    expect(await sale("pi_1")).toBeNull();
  });

  it("ignores a repeated delivery", async () => {
    await signedPost("stripe", checkout());
    const again = await signedPost("stripe", checkout());
    expect(again.json).toMatchObject({ duplicate: true });
    expect(await E.DB.prepare("SELECT COUNT(*) n FROM sales").first()).toEqual({ n: 1 });
  });

  it("applies a refund matched by an alternative id", async () => {
    await signedPost("stripe", checkout());
    const r = await signedPost("stripe", { id: "evt_2", type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: "pi_1", amount_refunded: 1500 } } });
    expect(r.json).toMatchObject({ refunds: 1 });
    expect(await sale("pi_1")).toMatchObject({ refunded_cents: 1500 });
  });

  it("applies a chargeback, then clears it when won", async () => {
    await signedPost("stripe", checkout());
    await signedPost("stripe", { id: "evt_3", type: "charge.dispute.created", data: { object: { id: "dp_1", payment_intent: "pi_1", charge: "ch_1", amount: 4900, status: "needs_response" } } });
    expect(await sale("pi_1")).toMatchObject({ disputed_cents: 4900, dispute_status: "open" });
    await signedPost("stripe", { id: "evt_4", type: "charge.dispute.closed", data: { object: { id: "dp_1", payment_intent: "pi_1", charge: "ch_1", amount: 4900, status: "won" } } });
    expect(await sale("pi_1")).toMatchObject({ disputed_cents: 0, dispute_status: "won" });
  });

  it("marks test-mode sales as not live", async () => {
    await signedPost("stripe", { ...checkout(), id: "evt_t", livemode: false });
    expect(await sale("pi_1")).toMatchObject({ live: 0 });
  });

  it("pins unattributed sales to ?site=KEY", async () => {
    const other = await addSite("other.dev", "0123456789abcdef01");
    const r = await signedPost("stripe", { ...checkout({ client_reference_id: null, payment_intent: "pi_9", customer: "cus_9", customer_details: {} }), id: "evt_9" }, `?site=${other.key}`);
    expect(r.status).toBe(200);
    expect(await sale("pi_9")).toMatchObject({ site_id: other.id, referrer: "(direct)", channel: "Direct" });
  });
});

describe("polar", () => {
  const paid = { type: "order.paid", data: { id: "ord_1", paid: true, total_amount: 2900, currency: "usd", billing_reason: "purchase", metadata: {}, customer: { id: "c1", email: "x@y.z", metadata: { plugloop_visitor_id: SID, plugloop_session_id: SID } }, created_at: new Date().toISOString() } };

  it("records a sale from customer metadata", async () => {
    expect((await signedPost("polar", paid)).status).toBe(200);
    await expectAttributed("ord_1", 2900);
  });

  it("rejects a bad signature", async () => {
    const body = JSON.stringify(paid);
    expect((await postWebhook("polar", body, await standardHeaders(body, "whsec_d3Jvbmc="))).status).toBe(401);
    const h = await standardHeaders(body, E.POLAR_WEBHOOK_SECRET);
    expect((await postWebhook("polar", body.replace("2900", "1"), h)).status).toBe(401);
    expect(await sale("ord_1")).toBeNull();
  });

  it("applies a refund", async () => {
    await signedPost("polar", paid);
    await signedPost("polar", { type: "order.refunded", data: { id: "ord_1", refunded_amount: 2900 } });
    expect(await sale("ord_1")).toMatchObject({ refunded_cents: 2900 });
  });

  it("applies a cancellation (Polar sends no chargeback webhook)", async () => {
    await signedPost("polar", { ...paid, data: { ...paid.data, id: "ord_2", subscription_id: "sub_1", billing_reason: "subscription_create" } });
    await signedPost("polar", { type: "subscription.revoked", data: { id: "sub_1", amount: 2900 } });
    expect(await sale("ord_2")).toMatchObject({ churned_cents: 2900 });
  });
});

describe("lemon squeezy", () => {
  const order = { meta: { event_name: "order_created", custom_data: { plugloop_visitor_id: SID, plugloop_session_id: SID } }, data: { id: "77", type: "orders", attributes: { status: "paid", total: 1900, currency: "USD", identifier: "uuid-77", customer_id: 5, user_email: "q@r.s", created_at: new Date().toISOString(), updated_at: "1", first_order_item: { product_name: "Pro" } } } };

  it("records a sale from checkout custom data", async () => {
    expect((await signedPost("lemonsqueezy", order)).status).toBe(200);
    const s = await expectAttributed("order_77", 1900);
    expect(s.product).toBe("Pro");
  });

  it("rejects a bad signature", async () => {
    const body = JSON.stringify(order);
    expect((await postWebhook("lemonsqueezy", body, await lsHeaders(body, "nope"))).status).toBe(401);
    expect((await postWebhook("lemonsqueezy", body, { "x-signature": "zz" })).status).toBe(401);
  });

  it("applies a refund", async () => {
    await signedPost("lemonsqueezy", order);
    await signedPost("lemonsqueezy", { meta: { event_name: "order_refunded" }, data: { id: "77", type: "orders", attributes: { status: "refunded", total: 1900, refunded_amount: 1900, updated_at: "2" } } });
    expect(await sale("order_77")).toMatchObject({ refunded_cents: 1900 });
  });

  it("applies a renewal and then an expiry (no chargeback webhook in Lemon Squeezy)", async () => {
    await signedPost("lemonsqueezy", order);
    await signedPost("lemonsqueezy", { meta: { event_name: "subscription_payment_success" }, data: { id: "901", type: "subscription-invoices", attributes: { billing_reason: "renewal", total: 1900, currency: "USD", subscription_id: 33, customer_id: 5, created_at: new Date().toISOString(), updated_at: "3" } } });
    const renewal = await sale("invoice_901");
    // Same customer as the first order: inherits its source.
    expect(renewal).toMatchObject({ renewal: 1, referrer: "news.ycombinator.com", subscription_id: "33" });
    await signedPost("lemonsqueezy", { meta: { event_name: "subscription_expired" }, data: { id: "33", type: "subscriptions", attributes: { updated_at: "4" } } });
    expect(await sale("invoice_901")).toMatchObject({ churned_cents: 1900 });
  });
});

describe("dodo", () => {
  const pay = { type: "payment.succeeded", data: { payment_id: "pay_1", status: "succeeded", total_amount: 9900, currency: "USD", metadata: { plugloop_visitor_id: SID, plugloop_session_id: SID }, customer: { customer_id: "cu_1", email: "d@o.do" }, billing: { country: "IN" }, created_at: new Date().toISOString() } };

  it("records a sale from metadata", async () => {
    expect((await signedPost("dodo", pay)).status).toBe(200);
    expect(await expectAttributed("pay_1", 9900)).toMatchObject({ country: "IN" });
  });

  it("rejects a bad signature", async () => {
    const body = JSON.stringify(pay);
    expect((await postWebhook("dodo", body, await standardHeaders(body, "whsec_Zm9v"))).status).toBe(401);
    const stale = await standardHeaders(body, E.DODO_WEBHOOK_SECRET, "msg_x", Math.floor(Date.now() / 1000) - 900);
    expect((await postWebhook("dodo", body, stale)).status).toBe(401);
  });

  it("applies partial refunds additively", async () => {
    await signedPost("dodo", pay);
    await signedPost("dodo", { type: "refund.succeeded", data: { payment_id: "pay_1", refund_id: "r1", amount: 1000 } });
    await signedPost("dodo", { type: "refund.succeeded", data: { payment_id: "pay_1", refund_id: "r2", amount: 2000 } });
    expect(await sale("pay_1")).toMatchObject({ refunded_cents: 3000 });
  });

  it("applies a lost chargeback", async () => {
    await signedPost("dodo", pay);
    await signedPost("dodo", { type: "dispute.lost", data: { payment_id: "pay_1", amount: 9900 } });
    expect(await sale("pay_1")).toMatchObject({ disputed_cents: 9900, dispute_status: "lost" });
  });
});

describe("paddle", () => {
  const txn = { event_id: "evt_p1", event_type: "transaction.completed", data: { id: "txn_1", status: "completed", currency_code: "USD", customer_id: "ctm_1", custom_data: { plugloop_visitor_id: SID, plugloop_session_id: SID }, details: { totals: { grand_total: "4500" } }, items: [{ price: { name: "Lifetime" } }], billed_at: new Date().toISOString() } };

  it("records a sale from customData", async () => {
    expect((await signedPost("paddle", txn)).status).toBe(200);
    expect(await expectAttributed("txn_1", 4500)).toMatchObject({ product: "Lifetime" });
  });

  it("rejects a bad signature", async () => {
    const body = JSON.stringify(txn);
    expect((await postWebhook("paddle", body, await paddleHeaders(body, "wrong"))).status).toBe(401);
    expect((await postWebhook("paddle", body, { "paddle-signature": "ts=1;h1=abc" })).status).toBe(401);
  });

  it("applies an approved refund adjustment", async () => {
    await signedPost("paddle", txn);
    await signedPost("paddle", { event_id: "evt_p2", event_type: "adjustment.created", data: { id: "adj_1", transaction_id: "txn_1", action: "refund", status: "pending_approval", totals: { total: "4500" } } });
    expect(await sale("txn_1")).toMatchObject({ refunded_cents: 0 });
    await signedPost("paddle", { event_id: "evt_p3", event_type: "adjustment.updated", data: { id: "adj_1", transaction_id: "txn_1", action: "refund", status: "approved", totals: { total: "4500" } } });
    expect(await sale("txn_1")).toMatchObject({ refunded_cents: 4500 });
  });

  it("applies a chargeback", async () => {
    await signedPost("paddle", txn);
    await signedPost("paddle", { event_id: "evt_p4", event_type: "adjustment.created", data: { id: "adj_2", transaction_id: "txn_1", action: "chargeback", status: "approved", totals: { total: "4500" } } });
    expect(await sale("txn_1")).toMatchObject({ disputed_cents: 4500, dispute_status: "lost" });
  });
});
