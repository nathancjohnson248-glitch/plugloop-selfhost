import { insightsFor } from "./insights";
import { channelLogos, hostOf, logoFor } from "./sources";
import { PERIODS, type BreakdownTab, type DashData, type DashRaw, type Kpi, type Period, type RawSource, type RawTotals, type SourceRow } from "./types";

/** Change from prev to cur as a fraction. No previous value: 0 (shown as "new", never "+400%"). */
export function change(cur: number, prev: number) {
  if (!prev) return 0;
  return (cur - prev) / prev;
}

const kpi = (value: number, prev: number): Kpi => ({ value, prev, delta: change(value, prev) });

export const netOf = (t: Pick<RawTotals, "revenue_cents" | "refunded_cents" | "disputed_cents" | "churned_cents">) => t.revenue_cents - t.refunded_cents - t.disputed_cents - t.churned_cents;

/** Referrer host → logo key (see lib/dash/sources), or the bare host for unknown referrers (favicon). */
export function referrerIcon(referrer: string): string {
  return logoFor(referrer) ?? (hostOf(referrer) || "link");
}
const CHANNEL_ICON: Record<string, string> = { Search: "google", Direct: "direct", Social: "x", Communities: "hn", "Launch sites": "producthunt", Email: "substack", AI: "chatgpt", Referral: "link", Paid: "paid" };
export const channelIcon = (c: string) => CHANNEL_ICON[c] ?? "link";

function rollup(sources: RawSource[], tab: BreakdownTab): SourceRow[] {
  const key = (s: RawSource) => (tab === "channel" ? s.channel : tab === "referrer" ? s.referrer : s.campaign || "(none)");
  const m = new Map<string, SourceRow>();
  for (const s of sources) {
    const k = key(s) || "(none)";
    const r = m.get(k) ?? { id: k, label: k, icon: tab === "channel" ? channelIcon(k) : tab === "referrer" ? referrerIcon(k) : "campaign", visitors: 0, sales: 0, grossCents: 0, refundCents: 0, disputeCents: 0, churnCents: 0, netCents: 0, checkouts: 0, abandoned: 0, abandonedCents: 0 };
    r.visitors += s.visitors;
    r.sales += s.sales;
    r.grossCents += s.revenue_cents;
    r.refundCents += s.refunded_cents;
    r.disputeCents += s.disputed_cents;
    r.churnCents += s.churned_cents;
    r.checkouts += s.checkouts;
    r.abandoned += s.abandoned;
    r.abandonedCents += s.abandoned_cents;
    m.set(k, r);
  }
  const rows = [...m.values()].filter((r) => r.visitors > 0 || r.sales > 0 || r.abandoned > 0);
  for (const r of rows) r.netCents = r.grossCents - r.refundCents - r.disputeCents - r.churnCents;
  if (tab === "channel") {
    for (const r of rows) {
      const refs = new Map<string, number>();
      for (const s of sources) if (s.channel === r.id) refs.set(s.referrer, (refs.get(s.referrer) ?? 0) + s.revenue_cents * 1000 + s.visitors);
      r.logos = channelLogos(r.id, [...refs.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k));
    }
  }
  // Ranked by money kept, then traffic.
  return rows.sort((a, b) => b.netCents - a.netCents || b.visitors - a.visitors);
}

export function toDashData(raw: DashRaw, period: Period, tz = "UTC"): DashData {
  const t = raw.totals;
  const p = raw.prev;
  const conv = (x: RawTotals) => (x.visitors ? x.sales / x.visitors : 0);
  const rpv = (x: RawTotals) => (x.visitors ? netOf(x) / x.visitors : 0);
  const referrers = rollup(raw.sources, "referrer");
  const prevPages = new Map(raw.prev_pages.map((x) => [x.path, x.visitors]));
  const byPage = raw.pages
    .filter((x) => x.abandoned > 0)
    .map((x) => ({ path: x.path, abandoned: x.abandoned, lostCents: x.abandoned_cents, checkouts: x.checkouts }))
    .sort((a, b) => b.lostCents - a.lostCents);
  const ltvRows = raw.ltv
    .map((l) => ({ id: l.referrer, label: l.referrer, icon: referrerIcon(l.referrer), customers: l.customers, revenueCents: l.revenue_cents - l.refunded_cents, renewalCents: l.renewal_cents, refundedCents: l.refunded_cents, avgCents: l.customers ? Math.round((l.revenue_cents - l.refunded_cents) / l.customers) : 0 }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  const data: DashData = {
    period,
    prevLabel: PERIODS.find((x) => x.id === period)!.prevLabel,
    bucket: raw.bucket,
    tz,
    currency: raw.currency,
    online: raw.online,
    empty: t.visitors === 0 && t.sales === 0 && p.visitors === 0,
    kpis: {
      visitors: kpi(t.visitors, p.visitors),
      revenue: kpi(t.revenue_cents, p.revenue_cents),
      net: kpi(netOf(t), netOf(p)),
      sales: kpi(t.sales, p.sales),
      conversion: kpi(conv(t), conv(p)),
      rpv: kpi(rpv(t), rpv(p)),
    },
    series: raw.series.map((s) => ({ t: s.t, visitors: s.visitors, revenueCents: s.revenue_cents })),
    breakdown: { channel: rollup(raw.sources, "channel"), referrer: referrers, campaign: rollup(raw.sources, "campaign") },
    pages: raw.pages.map((x) => ({ ...x, prevVisitors: prevPages.get(x.path) ?? 0 })).sort((a, b) => b.visitors - a.visitors),
    countries: [...raw.countries].sort((a, b) => b.visitors - a.visitors),
    devices: [...raw.devices].sort((a, b) => b.visitors - a.visitors),
    browsers: [...raw.browsers].sort((a, b) => b.visitors - a.visitors),
    leftOnTable: {
      totalCents: t.abandoned_cents,
      abandoned: t.abandoned,
      checkouts: t.checkouts,
      rate: t.checkouts ? t.abandoned / t.checkouts : 0,
      prevCents: p.abandoned_cents,
      bySource: referrers
        .filter((r) => r.abandoned > 0)
        .map((r) => ({ id: r.id, label: r.label, icon: r.icon, abandoned: r.abandoned, lostCents: r.abandonedCents, checkouts: r.checkouts }))
        .sort((a, b) => b.lostCents - a.lostCents),
      byPage,
    },
    net: {
      grossCents: t.revenue_cents,
      refundCents: t.refunded_cents,
      disputeCents: t.disputed_cents,
      churnCents: t.churned_cents,
      netCents: netOf(t),
      keptRate: t.revenue_cents ? netOf(t) / t.revenue_cents : 0,
    },
    ltv: ltvRows,
    sales: raw.recent_sales,
    insights: [],
    pageFlows: raw.page_flows,
  };
  data.insights = insightsFor(raw, data);
  return data;
}

/* ---------- formatting shared by every dashboard ---------- */

export const usd = (cents: number, decimals = false) => {
  const neg = cents < 0;
  const s = `$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 })}`;
  return neg ? `−${s}` : s;
};
export const compact = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString("en-US"));
export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
