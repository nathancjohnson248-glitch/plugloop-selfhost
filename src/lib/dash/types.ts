/**
 * The one shape every dashboard reads. The live demo builds it from the seeded sample dataset;
 * the app builds it from SQL aggregates (supabase function `dash_overview`). Components only ever
 * see `DashData`, so the demo and the real dashboard are the same code.
 */

export type Period = "today" | "7d" | "30d";
export const PERIODS: { id: Period; label: string; prevLabel: string }[] = [
  { id: "today", label: "Today", prevLabel: "yesterday at this time" },
  { id: "7d", label: "7d", prevLabel: "the previous 7 days" },
  { id: "30d", label: "30d", prevLabel: "the previous 30 days" },
];
export const isPeriod = (v: unknown): v is Period => v === "today" || v === "7d" || v === "30d";

export type Channel = "Search" | "Direct" | "Social" | "Communities" | "Launch sites" | "Email" | "AI" | "Referral" | "Paid";

/** Totals for a period. Money in cents, in the site's base currency. */
export type RawTotals = {
  visitors: number;
  pageviews: number;
  sessions: number;
  bounces: number;
  sales: number;
  revenue_cents: number;
  refunded_cents: number;
  disputed_cents: number;
  churned_cents: number;
  checkouts: number;
  abandoned: number;
  abandoned_cents: number;
};

export type RawSource = {
  channel: Channel | string;
  referrer: string;
  campaign: string;
  visitors: number;
  sales: number;
  revenue_cents: number;
  refunded_cents: number;
  disputed_cents: number;
  churned_cents: number;
  checkouts: number;
  abandoned: number;
  abandoned_cents: number;
};

export type RawPage = {
  path: string;
  visitors: number;
  views: number;
  revenue_cents: number;
  checkouts: number;
  abandoned: number;
  abandoned_cents: number;
  /** Visitors per chart bucket, same buckets as `series`. */
  trend: number[];
};

export type RawKey = { key: string; visitors: number; revenue_cents: number };

export type RawSale = {
  id: string;
  at: string;
  amount_cents: number;
  refunded_cents: number;
  status: "paid" | "refunded" | "disputed";
  renewal: boolean;
  provider: string;
  product: string;
  country: string | null;
  channel: string;
  referrer: string;
  path: string;
  /** Minutes from the visitor's first visit to the payment, when known. */
  lag_minutes: number | null;
};

export type RawLtv = { channel: string; referrer: string; customers: number; revenue_cents: number; renewal_cents: number; refunded_cents: number };

export type DashRaw = {
  bucket: "hour" | "day";
  /** Bucket start times (ISO) with visitors and gross revenue. */
  series: { t: string; visitors: number; revenue_cents: number }[];
  totals: RawTotals;
  prev: RawTotals;
  sources: RawSource[];
  prev_sources: RawSource[];
  pages: RawPage[];
  prev_pages: { path: string; visitors: number; revenue_cents: number }[];
  countries: RawKey[];
  devices: RawKey[];
  browsers: RawKey[];
  ltv: RawLtv[];
  recent_sales: RawSale[];
  online: number;
  currency: string;
  /** Optional: checkout money (gross + unpaid) per referrer × landing page, for the money-flow diagram. */
  page_flows?: RawPageFlow[];
};

export type RawPageFlow = { referrer: string; path: string; cents: number };

export const EMPTY_TOTALS: RawTotals = { visitors: 0, pageviews: 0, sessions: 0, bounces: 0, sales: 0, revenue_cents: 0, refunded_cents: 0, disputed_cents: 0, churned_cents: 0, checkouts: 0, abandoned: 0, abandoned_cents: 0 };

export function emptyRaw(bucket: "hour" | "day" = "day"): DashRaw {
  return { bucket, series: [], totals: EMPTY_TOTALS, prev: EMPTY_TOTALS, sources: [], prev_sources: [], pages: [], prev_pages: [], countries: [], devices: [], browsers: [], ltv: [], recent_sales: [], online: 0, currency: "USD" };
}

/* ---------- derived ---------- */

export type BreakdownTab = "channel" | "referrer" | "campaign";
export const BREAKDOWN_TABS: { id: BreakdownTab; label: string }[] = [
  { id: "channel", label: "Channel" },
  { id: "referrer", label: "Referrer" },
  { id: "campaign", label: "Campaign" },
];

export type SourceRow = {
  id: string;
  label: string;
  icon: string;
  /** Channel rows: the 2–3 logos (logo keys or hosts) that stand for the channel. */
  logos?: string[];
  visitors: number;
  sales: number;
  grossCents: number;
  refundCents: number;
  disputeCents: number;
  churnCents: number;
  netCents: number;
  checkouts: number;
  abandoned: number;
  abandonedCents: number;
};

export type Kpi = { value: number; prev: number; delta: number };

export type Insight = { id: string; tone: "up" | "down" | "money" | "neutral"; text: string };

export type DashData = {
  period: Period;
  prevLabel: string;
  bucket: "hour" | "day";
  /** Time zone chart labels are shown in. */
  tz: string;
  currency: string;
  online: number;
  empty: boolean;
  kpis: {
    visitors: Kpi;
    revenue: Kpi;
    net: Kpi;
    sales: Kpi;
    conversion: Kpi;
    rpv: Kpi;
  };
  series: { t: string; visitors: number; revenueCents: number }[];
  breakdown: Record<BreakdownTab, SourceRow[]>;
  pages: (RawPage & { prevVisitors: number })[];
  countries: RawKey[];
  devices: RawKey[];
  browsers: RawKey[];
  leftOnTable: {
    totalCents: number;
    abandoned: number;
    checkouts: number;
    rate: number;
    prevCents: number;
    bySource: { id: string; label: string; icon: string; abandoned: number; lostCents: number; checkouts: number }[];
    byPage: { path: string; abandoned: number; lostCents: number; checkouts: number }[];
  };
  net: {
    grossCents: number;
    refundCents: number;
    disputeCents: number;
    churnCents: number;
    netCents: number;
    keptRate: number;
  };
  ltv: { id: string; label: string; icon: string; customers: number; revenueCents: number; renewalCents: number; avgCents: number; refundedCents: number }[];
  sales: RawSale[];
  insights: Insight[];
  /** Checkout money per referrer × page when the source provides it (demo does; optional for the app). */
  pageFlows?: RawPageFlow[];
};
