import type { DashData, DashRaw, Insight, RawSource } from "./types";

/**
 * "What changed": a few plain-English lines computed from the numbers alone. Deterministic: the same
 * data always gives the same sentences, no model involved. Ordered by how much money is at stake.
 */

const money = (c: number) => `$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}`;

const FRIENDLY: Record<string, string> = {
  "google.com": "Google search",
  "bing.com": "Bing",
  "duckduckgo.com": "DuckDuckGo",
  "(direct)": "direct visits",
  "x.com": "X",
  "t.co": "X",
  "news.ycombinator.com": "Hacker News",
  "reddit.com": "Reddit",
  "producthunt.com": "Product Hunt",
  "chatgpt.com": "ChatGPT",
  "perplexity.ai": "Perplexity",
  "linkedin.com": "LinkedIn",
  "youtube.com": "YouTube",
  "buttondown.email": "your newsletter",
  "substack.com": "Substack",
  "claude.ai": "Claude",
  "gemini.google.com": "Gemini",
  "github.com": "GitHub",
  "indiehackers.com": "Indie Hackers",
};
export const friendlySource = (referrer: string) => FRIENDLY[referrer] ?? referrer.replace(/^www\./, "");
/** The same name as a row label: capitalised ("Direct visits", "Your newsletter"). */
export const sourceLabel = (referrer: string) => {
  const f = friendlySource(referrer);
  return f.includes(".") ? f : f.charAt(0).toUpperCase() + f.slice(1);
};

type Agg = { visitors: number; net: number; gross: number; refunds: number; sales: number };
function byReferrer(sources: RawSource[]) {
  const m = new Map<string, Agg>();
  for (const s of sources) {
    const a = m.get(s.referrer) ?? { visitors: 0, net: 0, gross: 0, refunds: 0, sales: 0 };
    a.visitors += s.visitors;
    a.gross += s.revenue_cents;
    a.refunds += s.refunded_cents + s.disputed_cents;
    a.net += s.revenue_cents - s.refunded_cents - s.disputed_cents - s.churned_cents;
    a.sales += s.sales;
    m.set(s.referrer, a);
  }
  return m;
}

export function insightsFor(raw: DashRaw, d: DashData): Insight[] {
  const out: Insight[] = [];
  if (d.empty) return out;
  const cur = byReferrer(raw.sources);
  const prev = byReferrer(raw.prev_sources);
  const net = d.kpis.net;
  const topPage = [...raw.pages].sort((a, b) => b.revenue_cents - a.revenue_cents)[0];
  const onPage = topPage && topPage.revenue_cents > 0 ? ` to ${topPage.path}` : "";

  // 1. Revenue, and what drove the change.
  const deltas = [...new Set([...cur.keys(), ...prev.keys()])].map((k) => ({ k, d: (cur.get(k)?.net ?? 0) - (prev.get(k)?.net ?? 0) }));
  if (net.prev <= 0 && net.value > 0) {
    const top = [...cur.entries()].sort((a, b) => b[1].net - a[1].net)[0];
    out.push({ id: "revenue", tone: "up", text: `${money(net.value)} in net revenue from ${d.kpis.sales.value} sale${d.kpis.sales.value === 1 ? "" : "s"}, most from ${friendlySource(top[0])}${onPage}.` });
  } else if (net.prev > 0 && Math.abs(net.delta) >= 0.05) {
    const up = net.delta > 0;
    const driver = deltas.sort((a, b) => (up ? b.d - a.d : a.d - b.d))[0];
    const share = Math.round(Math.abs(net.delta) * 100);
    out.push({
      id: "revenue",
      tone: up ? "up" : "down",
      text: up
        ? `Net revenue up ${share}% vs ${d.prevLabel}, mostly from ${friendlySource(driver.k)}${onPage}.`
        : `Net revenue down ${share}% vs ${d.prevLabel}. The biggest drop: ${friendlySource(driver.k)} (−${money(driver.d)}).`,
    });
  } else if (net.value > 0) {
    out.push({ id: "revenue", tone: "neutral", text: `Net revenue is steady at ${money(net.value)}, within 5% of ${d.prevLabel}.` });
  }

  // 2. Money left on the table.
  const left = d.leftOnTable;
  if (left.totalCents > 0 && left.abandoned > 0) {
    const src = left.bySource[0];
    const page = left.byPage[0];
    out.push({
      id: "left",
      tone: "money",
      text: `${money(left.totalCents)} left on the table: ${left.abandoned} checkout${left.abandoned === 1 ? "" : "s"} never paid${src ? `, most from ${friendlySource(src.label)}` : ""}${page ? ` on ${page.path}` : ""}.`,
    });
  }

  // 3. Refunds: the source that keeps the least, against the one that keeps the most.
  const total = d.net.grossCents;
  const meaningful = [...cur.entries()].filter(([, a]) => a.gross >= Math.max(1, total * 0.05) && a.sales >= 2);
  const worst = meaningful.map(([k, a]) => ({ k, kept: 1 - a.refunds / a.gross })).sort((a, b) => a.kept - b.kept)[0];
  const best = meaningful.map(([k, a]) => ({ k, kept: 1 - a.refunds / a.gross })).sort((a, b) => b.kept - a.kept)[0];
  if (worst && best && worst.k !== best.k && worst.kept <= 0.9) {
    out.push({ id: "refunds", tone: "down", text: `${friendlySource(worst.k)} kept ${Math.round(worst.kept * 100)}% of its revenue after refunds and chargebacks. ${friendlySource(best.k)} kept ${Math.round(best.kept * 100)}%.` });
  } else if (total > 0 && d.net.keptRate >= 0.95) {
    out.push({ id: "refunds", tone: "neutral", text: `You kept ${Math.round(d.net.keptRate * 100)}% of revenue after refunds, chargebacks and cancellations.` });
  }

  // 4. Traffic mover: the source whose visitors moved most against last period.
  const movers = [...cur.entries()]
    .map(([k, a]) => ({ k, a, p: prev.get(k)?.visitors ?? 0 }))
    .filter((m) => m.a.visitors >= 20 && m.p >= 5)
    .map((m) => ({ ...m, ratio: m.a.visitors / m.p }))
    .sort((x, y) => y.ratio - x.ratio);
  const mover = movers[0];
  if (mover && mover.ratio >= 1.8) {
    const tail = mover.a.sales === 0 ? ", but no sales yet" : mover.a.sales === 1 ? ` and 1 sale` : ` and ${mover.a.sales} sales`;
    out.push({ id: "traffic", tone: "up", text: `${friendlySource(mover.k)} sent ${mover.ratio.toFixed(1)}× the visitors of ${d.prevLabel}${tail}.` });
  }

  return out.slice(0, 4).map((i) => ({ ...i, text: i.text.charAt(0).toUpperCase() + i.text.slice(1) }));
}
