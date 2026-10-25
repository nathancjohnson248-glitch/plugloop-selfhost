/**
 * The money ledger, server-rendered with hono/jsx. Same sections and wording as the hosted
 * dashboard (components/dash/ledger.tsx): "You kept $X", what changed, money flow, sources, leaks,
 * traffic, pages, recent sales. Plain links instead of client state, so it works without JS.
 */
import { raw } from "hono/html";
import { leaksFor } from "../lib/dash/flow";
import { sourceLabel } from "../lib/dash/insights";
import { BREAKDOWN_TABS, PERIODS, type BreakdownTab, type DashData, type Period, type SourceRow } from "../lib/dash/types";
import { MoneyFlow } from "./flow";
import { Layout, TopBar } from "./layout";

export type SiteLite = { id: string; name: string; domain: string; public_key: string };

const PERIOD_PHRASE: Record<Period, string> = { today: "today", "7d": "in the last 7 days", "30d": "in the last 30 days" };

export function moneyFormatter(currency: string, decimals = 0) {
  let f: Intl.NumberFormat;
  try {
    f = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  } catch {
    f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  }
  return (cents: number) => {
    const s = f.format(Math.abs(cents) / 100);
    return cents < 0 ? `−${s}` : s;
  };
}

const n = (x: number) => Math.round(x).toLocaleString("en-US");
const compact = (x: number) => (x >= 10000 ? `${(x / 1000).toFixed(1)}k` : n(x));
const plural = (x: number, w: string) => `${n(x)} ${w}${x === 1 ? "" : "s"}`;

export const DASH_CSS = `
.dash-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px 24px;margin-bottom:18px}
.headline{font-size:44px;line-height:1.06;font-weight:650;letter-spacing:-.035em;margin:0}
.headline .amt{color:var(--money);font-variant-numeric:tabular-nums}
.headline .per{font-size:30px;color:var(--ink);font-weight:600;letter-spacing:-.025em}
.delta{margin-top:10px;display:flex;flex-wrap:wrap;gap:4px 10px;font-size:13px;color:var(--ink-2)}
.delta .sep{color:var(--line-strong)}
.periods{display:inline-flex;border:1px solid var(--line-strong);border-radius:10px;padding:3px;background:var(--card)}
.periods a{font-size:13px;text-decoration:none;color:var(--ink-2);padding:6px 12px;border-radius:7px;min-height:32px;display:inline-flex;align-items:center}
.periods a[aria-current=true]{background:var(--ink);color:#fff}
.site-pick{display:flex;align-items:center;gap:8px}
.site-pick select{min-height:36px;font-size:13.5px;padding:0 30px 0 10px;width:auto;max-width:220px}
.notes{border-top:1px dashed var(--line-strong);border-bottom:1px dashed var(--line-strong);padding:10px 0;margin:6px 0 26px}
.notes ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.notes li{display:grid;grid-template-columns:14px minmax(0,1fr);gap:10px;font-size:13.5px;color:var(--ink-2)}
.notes .tone{font-family:var(--mono);font-size:11px;padding-top:2px}
.sec{font-size:15px;font-weight:620}
.sec-row{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px}
.small{font-size:12.5px}
.flow{margin-bottom:30px}.flow-svg{display:block;margin:12px auto 0;height:auto}
.flow-narrow{display:none}
.grid2{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:40px;align-items:start}
.ledger-head{display:grid;grid-template-columns:minmax(0,1fr) 76px 52px 96px;gap:12px;border-bottom:1px solid var(--ink);padding-bottom:6px;margin-top:10px;font-family:var(--mono);font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-3)}
.r{text-align:right}
.ledger{list-style:none;margin:0;padding:0}
.ledger li{display:grid;grid-template-columns:minmax(0,1fr) 76px 52px 96px;gap:12px;align-items:center;border-bottom:1px dotted var(--line-strong);padding:10px 0}
.src{display:flex;align-items:center;gap:10px;min-width:0}
.src-main{min-width:0;flex:1}
.src-name{display:flex;align-items:baseline;gap:8px;font-size:13.5px;font-weight:550}
.src-name span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.leader{flex:1;min-width:16px;border-bottom:1px dotted var(--line-strong);margin-bottom:4px}
.bar-row{display:flex;align-items:center;gap:8px;margin-top:6px}
.bar{display:flex;height:5px;width:100%;max-width:160px;border-radius:99px;overflow:hidden;background:var(--paper-2)}
.bar i{display:block;height:100%}
.mono-sub{display:none;font-family:var(--mono);font-size:11.5px;color:var(--ink-2);margin-top:4px}
.ico{flex:none;width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font-size:11px;font-weight:650;background:var(--paper-2);color:var(--ink-2);box-shadow:inset 0 0 0 1px var(--line)}
.ico.utm{width:30px;font-family:var(--mono);font-size:9.5px}
.kept{font-family:var(--mono);font-size:14px;font-weight:600;color:var(--money)}
.total{display:flex;align-items:baseline;gap:12px;border-bottom:3px double var(--ink);padding:10px 0 6px;font-family:var(--mono);font-size:13px}
.tabs{display:flex;align-items:center;gap:2px;font-size:12.5px;color:var(--ink-3)}
.tabs a{text-decoration:none;padding:6px 4px;min-height:32px;display:inline-flex;align-items:center}
.tabs a[aria-selected=true]{color:var(--ink);font-weight:550;text-decoration:underline;text-decoration-color:var(--cobalt);text-decoration-thickness:2px;text-underline-offset:4px}
.leaks{list-style:none;margin:10px 0 0;padding:0}
.leaks li{display:grid;grid-template-columns:18px 22px minmax(0,1fr) auto;gap:10px;align-items:center;border-bottom:1px dotted var(--line-strong);padding:9px 0;min-height:50px}
.leaks li:last-child{border-bottom:0}
.trunc{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.block{margin-bottom:34px}
.chart{margin-top:12px}
.chart svg{display:block;width:100%;height:150px}
.axis{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--ink-3);margin-top:6px}
.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 28px;margin-top:14px;font-size:12.5px}
.stats div{display:flex;align-items:baseline;gap:6px;min-width:0}
.stats dt{color:var(--ink-2);white-space:nowrap}.stats dd{margin:0;font-family:var(--mono);white-space:nowrap}
.legend{display:flex;gap:14px;font-size:12px;color:var(--ink-2)}
.legend i{display:inline-block;width:10px;height:3px;border-radius:2px;vertical-align:middle;margin-right:5px}
.tbl{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px;table-layout:fixed}
.tbl th{font-family:var(--mono);font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-3);text-align:left;border-bottom:1px solid var(--ink);padding:0 0 6px}
.tbl td{border-bottom:1px dotted var(--line-strong);padding:9px 0;vertical-align:middle}
.tbl td.num,.tbl th.r{text-align:right}
.tbl .path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:10px}
.pill{display:inline-block;font-family:var(--mono);font-size:10.5px;border-radius:99px;padding:1px 7px;border:1px solid var(--line-strong);color:var(--ink-2)}
.pill.ref{color:var(--danger);border-color:#e9c4bd;background:var(--danger-wash)}
.pill.dis{color:#9a6400;border-color:#ecd9ad;background:#fbf3e2}
.sales{list-style:none;margin:10px 0 0;padding:0}
.sales li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;border-bottom:1px dotted var(--line-strong);padding:10px 0}
.install{margin-bottom:28px}
@media (max-width:960px){.grid2{grid-template-columns:minmax(0,1fr);gap:8px}}
@media (max-width:760px){.flow-wide{display:none}.flow-narrow{display:block}}
@media (max-width:640px){
.headline{font-size:34px}.headline .per{font-size:23px}
.ledger-head{display:none}.ledger{border-top:1px solid var(--ink);margin-top:8px}
.ledger li{grid-template-columns:minmax(0,1fr) auto}.ledger .hide-sm{display:none}.mono-sub{display:block}.leader{display:none}
.stats{grid-template-columns:repeat(2,minmax(0,1fr))}
.tbl .hide-sm{display:none}
.top .wrap{gap:4px 12px;padding-top:8px;padding-bottom:6px}.nav{margin-left:-10px;width:100%}
}
`;

function Icon({ label, tab }: { label: string; tab?: BreakdownTab }) {
  if (tab === "campaign") return <span class="ico utm" aria-hidden="true">UTM</span>;
  const name = label === "(direct)" ? "→" : (sourceLabel(label).replace(/^www\./, "")[0] ?? "?").toUpperCase();
  return (
    <span class="ico" aria-hidden="true">
      {name}
    </span>
  );
}

function Bar({ kept, lost }: { kept: number; lost: number }) {
  const total = Math.max(1, Math.max(0, kept) + Math.max(0, lost));
  return (
    <span class="bar" aria-hidden="true">
      <i style={`width:${(Math.max(0, kept) / total) * 100}%;background:var(--money)`} />
      <i style={`width:${(Math.max(0, lost) / total) * 100}%;background:rgba(180,50,31,.7)`} />
    </span>
  );
}

function q(base: Record<string, string>, patch: Record<string, string>) {
  return `/?${new URLSearchParams({ ...base, ...patch }).toString()}`;
}

function Headline({ data, money, period, base }: { data: DashData; money: (c: number) => string; period: Period; base: Record<string, string> }) {
  const k = data.kpis.net;
  const diff = k.value - k.prev;
  return (
    <div class="dash-head">
      <div data-testid="headline">
        <h1 class="headline">
          You kept <span class="amt" data-testid="kept">{money(k.value)}</span> <span class="per">{PERIOD_PHRASE[period]}</span>
        </h1>
        <p class="delta num">
          {k.prev ? <span style={`font-weight:600;color:${diff >= 0 ? "var(--money)" : "var(--danger)"}`}>{diff >= 0 ? "+" : "−"}{money(Math.abs(diff))}</span> : <span style="font-weight:600;color:var(--ink)">New</span>}
          <span>vs {data.prevLabel}</span>
          <span class="sep" aria-hidden="true">·</span>
          <span>{money(data.kpis.revenue.value)} gross</span>
          <span class="sep" aria-hidden="true">·</span>
          <span>{plural(data.kpis.sales.value, "sale")}</span>
          {data.online ? (
            <>
              <span class="sep" aria-hidden="true">·</span>
              <span>{n(data.online)} online now</span>
            </>
          ) : null}
        </p>
      </div>
      <nav class="periods" aria-label="Period">
        {PERIODS.map((p) => (
          <a href={q(base, { period: p.id })} aria-current={p.id === period ? "true" : undefined}>
            {p.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

function Notes({ data }: { data: DashData }) {
  return (
    <section class="notes" aria-label="What changed" data-testid="insights">
      {data.insights.length ? (
        <ul>
          {data.insights.map((i) => (
            <li>
              <span class="tone" aria-hidden="true" style={`color:${i.tone === "up" ? "var(--money)" : i.tone === "down" ? "var(--danger)" : "var(--ink-3)"}`}>
                {i.tone === "up" ? "▲" : i.tone === "down" ? "▼" : "—"}
              </span>
              <span>{i.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="small muted" style="margin:0">Plain-English notes on what moved show up here once a few days of visits and sales are in.</p>
      )}
    </section>
  );
}

function Sources({ data, money, tab, base }: { data: DashData; money: (c: number) => string; tab: BreakdownTab; base: Record<string, string> }) {
  const rows: SourceRow[] = data.breakdown[tab].slice(0, 8);
  const totalKept = data.breakdown[tab].reduce((x, r) => x + r.netCents, 0);
  return (
    <section class="block" aria-label="Sources" data-testid="sources">
      <div class="sec-row">
        <h3 class="sec">Sources</h3>
        <div class="tabs" role="tablist" aria-label="Group sources by">
          <span>by</span>
          {BREAKDOWN_TABS.map((t, i) => (
            <>
              {i ? <span aria-hidden="true">·</span> : null}
              <a role="tab" href={q(base, { tab: t.id })} aria-selected={tab === t.id ? "true" : "false"}>
                {t.id === "referrer" ? "source" : t.label.toLowerCase()}
              </a>
            </>
          ))}
        </div>
      </div>
      <div class="ledger-head">
        <span>Source</span>
        <span class="r">Visitors</span>
        <span class="r">Sales</span>
        <span class="r">Kept</span>
      </div>
      {rows.length ? (
        <ul class="ledger">
          {rows.map((r) => {
            const lost = r.refundCents + r.disputeCents + r.churnCents;
            const name = tab === "referrer" ? sourceLabel(r.label) : r.label;
            return (
              <li data-testid="source-row">
                <span class="src">
                  <Icon label={r.label} tab={tab} />
                  <span class="src-main">
                    <span class="src-name">
                      <span title={r.label}>{name}</span>
                      <span class="leader" aria-hidden="true" />
                    </span>
                    <span class="bar-row">
                      <Bar kept={r.netCents} lost={lost} />
                      {lost > 0 ? <span class="num danger" style="font-size:11px;flex:none">−{money(lost)}</span> : null}
                    </span>
                    <span class="mono-sub">
                      {plural(r.visitors, "visitor")} · {plural(r.sales, "sale")}
                    </span>
                  </span>
                </span>
                <span class="num r muted hide-sm" style="font-size:13px">{n(r.visitors)}</span>
                <span class="num r muted hide-sm" style="font-size:13px">{n(r.sales)}</span>
                <span class="kept r" style={r.netCents < 0 ? "color:var(--danger)" : ""}>{money(r.netCents)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="small muted" style="padding:20px 0;text-align:center">No sources yet for this period.</p>
      )}
      <div class="total">
        <span>Total kept</span>
        <span class="leader" aria-hidden="true" />
        <span class="money" style="font-weight:600">{money(totalKept)}</span>
      </div>
      <p class="faint" style="font-size:11.5px;margin:8px 0 0">Ranked by money kept: revenue after refunds, chargebacks and cancelled subscriptions.</p>
    </section>
  );
}

function Leaks({ data, money }: { data: DashData; money: (c: number) => string }) {
  const leaks = leaksFor(data);
  const total = leaks.reduce((x, l) => x + l.cents, 0);
  return (
    <section class="block" aria-label="Leaks" data-testid="leaks">
      <div class="sec-row">
        <h3 class="sec">Leaks</h3>
        {leaks.length ? <span class="num faint" style="font-size:12px">{money(total)} across the top {leaks.length}</span> : null}
      </div>
      {leaks.length ? (
        <ol class="leaks">
          {leaks.map((l, i) => (
            <li>
              <span class="num faint" style="font-size:11px">{i + 1}</span>
              <Icon label={l.source} />
              <span style="min-width:0">
                <span class="trunc" style="font-size:13.5px">{sourceLabel(l.source)}</span>
                <span class="trunc muted" style="font-size:12px">{l.detail}</span>
              </span>
              <span class="num" style={`font-size:14px;font-weight:600;color:${l.kind === "unpaid" ? "var(--ink)" : "var(--danger)"}`}>−{money(l.cents)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p class="small muted" style="margin-top:10px">No leaks in this period. Nothing refunded, nothing left unpaid.</p>
      )}
    </section>
  );
}

function fmtTick(iso: string, bucket: "hour" | "day") {
  const d = new Date(iso);
  if (bucket === "hour") return `${String(d.getUTCHours()).padStart(2, "0")}:00`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Traffic({ data, money, money2 }: { data: DashData; money: (c: number) => string; money2: (c: number) => string }) {
  const s = data.series.length ? data.series : [{ t: new Date().toISOString(), visitors: 0, revenueCents: 0 }];
  const W = 1000;
  const H = 150;
  const maxV = Math.max(1, ...s.map((x) => x.visitors));
  const maxR = Math.max(1, ...s.map((x) => x.revenueCents));
  const step = W / s.length;
  const pts = s.map((x, i) => [i * step + step / 2, H - 8 - (x.visitors / maxV) * (H - 24)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  const k = data.kpis;
  const mid = Math.floor((s.length - 1) / 2);
  return (
    <section class="block" aria-label="Traffic" data-testid="traffic">
      <div class="sec-row">
        <h3 class="sec">Traffic</h3>
        <span class="legend">
          <span><i style="background:var(--cobalt)" />Visitors</span>
          <span><i style="background:var(--money)" />Revenue</span>
        </span>
      </div>
      <div class="chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${n(k.visitors.value)} visitors and ${money(k.revenue.value)} revenue ${data.period === "today" ? "today" : `over ${data.period}`}`}>
          <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="#ddd7cd" stroke-width="1" vector-effect="non-scaling-stroke" />
          {s.map((x, i) => {
            const h = (x.revenueCents / maxR) * (H * 0.42);
            return x.revenueCents > 0 ? <rect x={i * step + step * 0.3} width={step * 0.4} y={H - h} height={h} fill="rgba(15,123,79,.55)" /> : null;
          })}
          <path d={area} fill="rgba(43,75,255,.07)" />
          <path d={line} fill="none" stroke="#2b4bff" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
        </svg>
        <div class="axis">
          <span>{fmtTick(s[0].t, data.bucket)}</span>
          {s.length > 2 ? <span>{fmtTick(s[mid].t, data.bucket)}</span> : null}
          <span>{fmtTick(s[s.length - 1].t, data.bucket)}</span>
        </div>
      </div>
      <dl class="stats">
        {[
          ["Visitors", compact(k.visitors.value)],
          ["Sales", n(k.sales.value)],
          ["Conversion", `${(k.conversion.value * 100).toFixed(2)}%`],
          ["Kept / visitor", money2(Math.round(k.rpv.value))],
        ].map(([l, v]) => (
          <div>
            <dt>{l}</dt>
            <span class="leader" aria-hidden="true" />
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Pages({ data, money }: { data: DashData; money: (c: number) => string }) {
  const rows = data.pages.slice(0, 8);
  return (
    <section class="block" aria-label="Pages" data-testid="pages">
      <h3 class="sec">Pages</h3>
      {rows.length ? (
        <table class="tbl">
          <thead>
            <tr>
              <th>Page</th>
              <th class="r" style="width:72px">Visitors</th>
              <th class="r hide-sm" style="width:88px">Unpaid</th>
              <th class="r" style="width:84px">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr>
                <td class="path" title={p.path}><span class="num">{p.path}</span></td>
                <td class="num">{n(p.visitors)}</td>
                <td class="num hide-sm muted">{p.abandoned ? `${p.abandoned}/${p.checkouts}` : "—"}</td>
                <td class="num money">{p.revenue_cents ? money(p.revenue_cents) : <span class="faint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="small muted">No pageviews yet for this period.</p>
      )}
    </section>
  );
}

function ago(iso: string, now: number) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function lagText(min: number | null) {
  if (min == null) return null;
  if (min < 60) return `${min}m after first visit`;
  if (min < 2880) return `${Math.round(min / 60)}h after first visit`;
  return `${Math.round(min / 1440)}d after first visit`;
}

function RecentSales({ data, money, now }: { data: DashData; money: (c: number) => string; now: number }) {
  const rows = data.sales.slice(0, 6);
  return (
    <section class="block" aria-label="Recent sales" data-testid="recent-sales">
      <h3 class="sec">Recent sales</h3>
      {rows.length ? (
        <ul class="sales">
          {rows.map((s) => (
            <li>
              <span style="min-width:0">
                <span class="trunc" style="font-size:13.5px;font-weight:550">
                  {s.product || s.provider} {s.renewal ? <span class="pill">renewal</span> : null} {s.status === "refunded" ? <span class="pill ref">refunded</span> : s.status === "disputed" ? <span class="pill dis">disputed</span> : null}
                </span>
                <span class="trunc muted" style="font-size:12px">
                  {sourceLabel(s.referrer)} → {s.path}
                  {lagText(s.lag_minutes) ? ` · ${lagText(s.lag_minutes)}` : ""}
                </span>
              </span>
              <span style="text-align:right">
                <span class="num" style={`display:block;font-weight:600;font-size:14px;${s.status === "paid" ? "color:var(--money)" : "color:var(--ink-3);text-decoration:line-through"}`}>{money(s.amount_cents)}</span>
                <span class="num faint" style="font-size:11px">{ago(s.at, now)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="small muted" style="margin-top:10px">No sales in this period yet.</p>
      )}
    </section>
  );
}

export function snippet(origin: string, key: string) {
  return `<script defer data-site="${key}" src="${origin}/js/script.js"></script>`;
}

function Install({ site, origin }: { site: SiteLite; origin: string }) {
  return (
    <section class="card install" data-testid="install">
      <h3 class="sec">Waiting for the first visit to {site.domain}</h3>
      <p class="small muted" style="margin:6px 0 0">Paste this into the &lt;head&gt; of every page. No cookies, no consent banner needed.</p>
      <pre>
        <code>{snippet(origin, site.public_key)}</code>
      </pre>
      <p class="small muted" style="margin:10px 0 0">
        Then connect your payment provider on <a href="/setup">Setup</a> so sales show up next to the visits that made them.
      </p>
    </section>
  );
}

export function DashboardPage(props: { data: DashData; sites: SiteLite[]; site: SiteLite; period: Period; tab: BreakdownTab; origin: string; currency: string; now: number; hasEvents: boolean }) {
  const { data, site, period, tab } = props;
  const money = moneyFormatter(props.currency);
  const base: Record<string, string> = { site: site.id, period, tab };
  return (
    <Layout
      title={site.name}
      nav={
        <TopBar current="dash">
          {props.sites.length > 1 ? (
            <form class="site-pick" method="get" action="/">
              <label for="site" class="sr-only">Site</label>
              <select id="site" name="site" onchange="this.form.submit()">
                {props.sites.map((s) => (
                  <option value={s.id} selected={s.id === site.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input type="hidden" name="period" value={period} />
              <noscript>
                <button class="btn ghost" type="submit">Go</button>
              </noscript>
            </form>
          ) : (
            <span class="num faint small">{site.domain}</span>
          )}
        </TopBar>
      }
    >
      <style>{raw(DASH_CSS)}</style>
      <main class="wrap" data-testid="dashboard">
        {!props.hasEvents ? <Install site={site} origin={props.origin} /> : null}
        <Headline data={data} money={money} period={period} base={base} />
        <Notes data={data} />
        <MoneyFlow data={data} money={money} />
        <div class="grid2">
          <div>
            <Sources data={data} money={money} tab={tab} base={base} />
            <Traffic data={data} money={money} money2={moneyFormatter(props.currency, 2)} />
          </div>
          <div>
            <Leaks data={data} money={money} />
            <RecentSales data={data} money={money} now={props.now} />
            <Pages data={data} money={money} />
          </div>
        </div>
      </main>
    </Layout>
  );
}
