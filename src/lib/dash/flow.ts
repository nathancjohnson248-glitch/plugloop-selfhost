/**
 * The money-flow model and its Sankey layout, hand-rolled and pure (no DOM), so the math is tested.
 *
 * Money that reached checkout = gross revenue + the value of checkouts never paid. It splits three
 * ways, per source and in total:
 *   kept      = gross − refunds/chargebacks/cancellations (never below 0)
 *   refunded  = refunds + chargebacks + cancellations (capped at gross)
 *   left      = checkouts started and never paid
 * so kept + refunded + left = checkout, exactly, for every source and for the total.
 */
import type { DashData } from "./types";

export type FlowSource = { id: string; label: string; icon: string; checkout: number; kept: number; refunded: number; left: number };
export type FlowPage = { id: string; label: string; value: number };
export type FlowModel = {
  sources: FlowSource[];
  /** Empty when the data has no source × page split; the layout then goes sources → checkout. */
  pages: FlowPage[];
  /** [sourceIndex, pageIndex, cents] */
  sourcePage: [number, number, number][];
  checkout: number;
  kept: number;
  refunded: number;
  left: number;
};

export const OUTCOMES = ["kept", "refunded", "left"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Split an integer total across weights so the parts add up exactly. */
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((n, w) => n + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  let acc = 0;
  let given = 0;
  return weights.map((w) => {
    acc += w;
    const upto = Math.round((total * acc) / sum);
    const part = upto - given;
    given = upto;
    return part;
  });
}

export function splitSource(gross: number, lost: number, abandoned: number) {
  const refunded = Math.max(0, Math.min(lost, gross));
  const kept = Math.max(0, gross - refunded);
  const left = Math.max(0, abandoned);
  return { kept, refunded, left, checkout: kept + refunded + left };
}

export function flowModel(d: Pick<DashData, "breakdown" | "pageFlows">, opts: { maxSources?: number; maxPages?: number } = {}): FlowModel {
  const maxSources = opts.maxSources ?? 5;
  const maxPages = opts.maxPages ?? 4;
  const rows = d.breakdown.referrer
    .map((r) => ({ id: r.id, label: r.label, icon: r.icon, ...splitSource(Math.max(0, r.grossCents), r.refundCents + r.disputeCents + r.churnCents, r.abandonedCents) }))
    .filter((r) => r.checkout > 0)
    .sort((a, b) => b.checkout - a.checkout);
  let sources: FlowSource[] = rows.slice(0, maxSources);
  const rest = rows.slice(maxSources);
  if (rest.length) {
    sources = [
      ...sources,
      rest.reduce<FlowSource>((o, r) => ({ ...o, checkout: o.checkout + r.checkout, kept: o.kept + r.kept, refunded: o.refunded + r.refunded, left: o.left + r.left }), { id: "__other", label: `${rest.length} more`, icon: "other", checkout: 0, kept: 0, refunded: 0, left: 0 }),
    ];
  }

  // Pages: each source's checkout money split across pages in proportion to its page flows.
  let pages: FlowPage[] = [];
  const sourcePage: [number, number, number][] = [];
  const flows = d.pageFlows ?? [];
  if (flows.length && sources.length) {
    const byPage = new Map<string, number>();
    for (const f of flows) byPage.set(f.path, (byPage.get(f.path) ?? 0) + f.cents);
    const ranked = [...byPage.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, maxPages).map(([p]) => p);
    const hasOther = ranked.length > maxPages;
    const pageIds = hasOther ? [...top, "__other"] : top;
    const pageOf = (path: string) => (top.includes(path) ? path : "__other");
    const ids = new Set(sources.map((s) => s.id));
    const sums = new Array(pageIds.length).fill(0);
    sources.forEach((s, si) => {
      const w = new Array(pageIds.length).fill(0);
      for (const f of flows) {
        const mine = s.id === "__other" ? !ids.has(f.referrer) : f.referrer === s.id;
        if (mine && f.cents > 0) w[pageIds.indexOf(pageOf(f.path))] += f.cents;
      }
      // A source with checkout money but no page split goes to its biggest page share overall.
      if (!w.some((x) => x > 0)) w[0] = 1;
      allocate(s.checkout, w).forEach((v, pi) => {
        if (v > 0) {
          sourcePage.push([si, pi, v]);
          sums[pi] += v;
        }
      });
    });
    pages = pageIds.map((id, i) => ({ id, label: id === "__other" ? "Other pages" : id, value: sums[i] })).filter((p) => p.value > 0);
    // Re-index after dropping empty pages.
    const keep = pageIds.map((id, i) => (sums[i] > 0 ? pages.findIndex((p) => p.id === id) : -1));
    for (const l of sourcePage) l[1] = keep[l[1]];
  }

  // Totals net refunds across sources (as the headline does): a source refunding more than it sold
  // this period still lowers what was kept overall. Per-source splits stay clamped for the receipts.
  const gross = d.breakdown.referrer.reduce((n, r) => n + Math.max(0, r.grossCents), 0);
  const lost = d.breakdown.referrer.reduce((n, r) => n + r.refundCents + r.disputeCents + r.churnCents, 0);
  const refunded = Math.max(0, Math.min(lost, gross));
  const kept = gross - refunded;
  const left = sources.reduce((n, s) => n + s.left, 0);
  return { sources, pages, sourcePage, checkout: kept + refunded + left, kept, refunded, left };
}

/* ---------- layout ---------- */

export type Rect = { x: number; y: number; w: number; h: number };
export type FlowNode = Rect & { id: string; col: number; value: number };
export type FlowLink = { id: string; from: string; to: string; value: number; d: string; source?: number; outcome?: Outcome };
export type FlowLayout = { nodes: FlowNode[]; links: FlowLink[]; width: number; height: number; vertical: boolean };

export type LayoutOpts = {
  width: number;
  height: number;
  vertical: boolean;
  /** Space reserved before the first column and after the last (labels), along the flow. */
  padStart: number;
  padEnd: number;
  /** Space reserved at either side across the flow. */
  padCross?: number;
  nodeThickness?: number;
  gap?: number;
  /** Smallest drawn node size across the flow, so tiny sources stay tappable. */
  minNode?: number;
};

/**
 * Columns: sources → pages (if any) → checkout → outcomes. Positions are computed on two axes
 * ("along" the flow and "across" it) and mapped to x/y, so the vertical phone layout is the same math.
 */
export function layoutFlow(m: FlowModel, o: LayoutOpts): FlowLayout {
  const thick = o.nodeThickness ?? 8;
  const gap = o.gap ?? 10;
  const minNode = o.minNode ?? 4;
  const padCross = o.padCross ?? 0;
  const alongLen = o.vertical ? o.height : o.width;
  const crossLen = (o.vertical ? o.width : o.height) - padCross * 2;
  const cols: { id: string; value: number }[][] = [
    m.sources.map((s) => ({ id: `s:${s.id}`, value: s.checkout })),
    ...(m.pages.length ? [m.pages.map((p) => ({ id: `p:${p.id}`, value: p.value }))] : []),
    [{ id: "checkout", value: m.checkout }],
    OUTCOMES.map((k) => ({ id: `o:${k}`, value: m[k] })),
  ];
  const nCols = cols.length;
  const span = alongLen - o.padStart - o.padEnd - thick;
  const colPos = (c: number) => o.padStart + (nCols === 1 ? 0 : (span * c) / (nCols - 1));

  // One scale for every column (the busiest column decides), min sizes on top.
  // Largest scale at which every column (with its minimum sizes and gaps) still fits across.
  const fits = (col: { value: number }[], k: number) => col.reduce((n, x) => n + (x.value > 0 ? Math.max(minNode, x.value * k) : 0), 0) + gap * Math.max(0, col.length - 1) <= crossLen;
  const colScale = (col: { value: number }[]) => {
    let lo = 0;
    let hi = crossLen / Math.max(1, Math.min(...col.map((x) => x.value).filter((v) => v > 0), Infinity));
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(col, mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const scale = Math.min(...cols.map(colScale));
  const nodes: FlowNode[] = [];
  cols.forEach((col, c) => {
    const sizes = col.map((x) => (x.value > 0 ? Math.max(minNode, x.value * scale) : 0));
    const total = sizes.reduce((n, s) => n + s, 0) + gap * Math.max(0, col.length - 1);
    let at = padCross + Math.max(0, (crossLen - total) / 2);
    col.forEach((x, i) => {
      const along = colPos(c);
      const r: Rect = o.vertical ? { x: at, y: along, w: sizes[i], h: thick } : { x: along, y: at, w: thick, h: sizes[i] };
      nodes.push({ ...r, id: x.id, col: c, value: x.value });
      at += sizes[i] + gap;
    });
  });
  const node = new Map(nodes.map((n) => [n.id, n]));
  const crossStart = (n: FlowNode) => (o.vertical ? n.x : n.y);
  const crossSize = (n: FlowNode) => (o.vertical ? n.w : n.h);
  const alongEnd = (n: FlowNode) => (o.vertical ? n.y + n.h : n.x + n.w);
  const alongStart = (n: FlowNode) => (o.vertical ? n.y : n.x);
  const outOff = new Map<string, number>();
  const inOff = new Map<string, number>();

  const band = (a: FlowNode, b: FlowNode, value: number) => {
    const wa = a.value ? (crossSize(a) * value) / a.value : 0;
    const wb = b.value ? (crossSize(b) * value) / b.value : 0;
    const a0 = crossStart(a) + (outOff.get(a.id) ?? 0);
    const b0 = crossStart(b) + (inOff.get(b.id) ?? 0);
    outOff.set(a.id, (outOff.get(a.id) ?? 0) + wa);
    inOff.set(b.id, (inOff.get(b.id) ?? 0) + wb);
    const p = alongEnd(a);
    const q = alongStart(b);
    const mid = (p + q) / 2;
    const pt = (along: number, cross: number) => (o.vertical ? `${cross.toFixed(2)},${along.toFixed(2)}` : `${along.toFixed(2)},${cross.toFixed(2)}`);
    return `M${pt(p, a0)} C${pt(mid, a0)} ${pt(mid, b0)} ${pt(q, b0)} L${pt(q, b0 + wb)} C${pt(mid, b0 + wb)} ${pt(mid, a0 + wa)} ${pt(p, a0 + wa)} Z`;
  };

  const links: FlowLink[] = [];
  if (m.pages.length) {
    for (const [si, pi, v] of m.sourcePage) {
      const a = node.get(`s:${m.sources[si].id}`)!;
      const b = node.get(`p:${m.pages[pi].id}`)!;
      links.push({ id: `${a.id}>${b.id}`, from: a.id, to: b.id, value: v, d: band(a, b, v), source: si });
    }
    for (const p of m.pages) {
      const a = node.get(`p:${p.id}`)!;
      links.push({ id: `${a.id}>checkout`, from: a.id, to: "checkout", value: p.value, d: band(a, node.get("checkout")!, p.value) });
    }
  } else {
    m.sources.forEach((s, si) => {
      const a = node.get(`s:${s.id}`)!;
      links.push({ id: `${a.id}>checkout`, from: a.id, to: "checkout", value: s.checkout, d: band(a, node.get("checkout")!, s.checkout), source: si });
    });
  }
  for (const k of OUTCOMES) {
    if (m[k] <= 0) continue;
    links.push({ id: `checkout>o:${k}`, from: "checkout", to: `o:${k}`, value: m[k], d: band(node.get("checkout")!, node.get(`o:${k}`)!, m[k]), outcome: k });
  }
  return { nodes, links, width: o.width, height: o.height, vertical: o.vertical };
}

/**
 * The band one source contributes to each outcome, drawn over the checkout → outcome links when that
 * source is highlighted. Same geometry as the full band, narrowed to the source's share at both ends.
 */
export function sourceOutcomeBands(m: FlowModel, layout: FlowLayout, si: number): { outcome: Outcome; d: string }[] {
  const s = m.sources[si];
  if (!s) return [];
  const node = new Map(layout.nodes.map((n) => [n.id, n]));
  const v = layout.vertical;
  const c = node.get("checkout")!;
  const crossStart = (n: FlowNode) => (v ? n.x : n.y);
  const crossSize = (n: FlowNode) => (v ? n.w : n.h);
  const pt = (along: number, cross: number) => (v ? `${cross.toFixed(2)},${along.toFixed(2)}` : `${along.toFixed(2)},${cross.toFixed(2)}`);
  const out: { outcome: Outcome; d: string }[] = [];
  let cOff = 0;
  for (const k of OUTCOMES) {
    const total = m[k];
    if (total <= 0) continue;
    const o = node.get(`o:${k}`)!;
    const share = Math.min(1, s[k] / total);
    const wa = (crossSize(c) * total) / (m.checkout || 1);
    const a0 = crossStart(c) + cOff;
    cOff += wa;
    const sa = wa * share;
    const sb = crossSize(o) * share;
    const p = v ? c.y + c.h : c.x + c.w;
    const q = v ? o.y : o.x;
    const mid = (p + q) / 2;
    const b0 = crossStart(o);
    if (sa > 0) out.push({ outcome: k, d: `M${pt(p, a0)} C${pt(mid, a0)} ${pt(mid, b0)} ${pt(q, b0)} L${pt(q, b0 + sb)} C${pt(mid, b0 + sb)} ${pt(mid, a0 + sa)} ${pt(p, a0 + sa)} Z` });
  }
  return out;
}

/* ---------- leaks ---------- */

export type Leak = { id: string; kind: "unpaid" | "refunds" | "churn"; source: string; icon: string; cents: number; count?: number; detail: string };

/** Where money is lost, ranked by dollars: unpaid checkouts, refunds/chargebacks, cancellations. */
export function leaksFor(d: Pick<DashData, "breakdown" | "leftOnTable">, max = 5): Leak[] {
  const out: Leak[] = [];
  for (const r of d.leftOnTable.bySource) if (r.lostCents > 0) out.push({ id: `unpaid:${r.id}`, kind: "unpaid", source: r.label, icon: r.icon, cents: r.lostCents, count: r.abandoned, detail: `${r.abandoned} of ${r.checkouts} checkouts never paid` });
  for (const r of d.breakdown.referrer) {
    const refunds = r.refundCents + r.disputeCents;
    if (refunds > 0) out.push({ id: `refunds:${r.id}`, kind: "refunds", source: r.label, icon: r.icon, cents: refunds, detail: r.disputeCents ? "Refunds and chargebacks" : "Refunded" });
    if (r.churnCents > 0) out.push({ id: `churn:${r.id}`, kind: "churn", source: r.label, icon: r.icon, cents: r.churnCents, detail: "Cancelled subscriptions" });
  }
  return out.sort((a, b) => b.cents - a.cents).slice(0, max);
}
