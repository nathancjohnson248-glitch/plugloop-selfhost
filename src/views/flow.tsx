/**
 * Money flow, server-rendered: sources → landing pages → checkout → kept / refunded / never paid.
 * Uses the hosted app's pure model and Sankey layout (src/lib/dash/flow.ts) unchanged; this file only
 * draws it. Two drawings ship in the page: a wide one with pages, and a compact one for phones.
 */
import { flowModel, layoutFlow, type FlowModel, type Outcome } from "../lib/dash/flow";
import { sourceLabel } from "../lib/dash/insights";
import type { DashData } from "../lib/dash/types";

const OUT_LABEL: Record<Outcome, string> = { kept: "Kept", refunded: "Refunded & churned", left: "Never paid" };
const OUT_FILL: Record<Outcome, string> = { kept: "#0f7b4f", refunded: "#b4321f", left: "#a8a298" };
const OUT_BAND: Record<Outcome, string> = { kept: "rgba(15,123,79,.30)", refunded: "rgba(180,50,31,.26)", left: "rgba(114,109,100,.18)" };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const nameOf = (id: string, label: string) => (id === "__other" ? label : sourceLabel(label));

function Drawing(props: { model: FlowModel; money: (c: number) => string; width: number; height: number; padStart: number; padEnd: number; compact: boolean; id: string }) {
  const { model: m, money, width, height, compact } = props;
  const lay = layoutFlow(m, { width, height, vertical: false, padStart: props.padStart, padEnd: props.padEnd, padCross: compact ? 14 : 22, nodeThickness: compact ? 8 : 10, gap: compact ? 10 : 14, minNode: 6 });
  const node = new Map(lay.nodes.map((n) => [n.id, n]));
  const fs = compact ? 10.5 : 12.5;
  const fsSmall = compact ? 9.5 : 11.5;
  const nameLen = compact ? 13 : 20;
  const checkout = node.get("checkout")!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-labelledby={`${props.id}-t`} class="flow-svg" style={`max-width:${width}px`}>
      <title id={`${props.id}-t`}>
        Money flow: {money(m.checkout)} reached checkout. {money(m.kept)} kept, {money(m.refunded)} refunded or churned, {money(m.left)} never paid.
      </title>
      <g>
        {lay.links.map((l) => (
          <path d={l.d} fill={l.outcome ? OUT_BAND[l.outcome] : "rgba(43,75,255,.14)"} />
        ))}
      </g>
      <g>
        {lay.nodes.map((n) => {
          const fill = n.id === "checkout" ? "#2b4bff" : n.id.startsWith("o:") ? OUT_FILL[n.id.slice(2) as Outcome] : "#14130f";
          return <rect x={n.x} y={n.y} width={n.w} height={Math.max(1, n.h)} rx="2" fill={fill} />;
        })}
      </g>
      <g font-family="Geist, ui-sans-serif, system-ui, sans-serif" font-size={fs} fill="#14130f">
        {m.sources.map((s) => {
          const n = node.get(`s:${s.id}`)!;
          const cy = n.y + n.h / 2;
          return (
            <text x={n.x - 8} y={cy} text-anchor="end">
              <tspan x={n.x - 8} dy="-0.15em">{clip(nameOf(s.id, s.label), nameLen)}</tspan>
              <tspan x={n.x - 8} dy="1.2em" font-family="Geist Mono, ui-monospace, monospace" font-size={fsSmall} fill="#6b675f">{money(s.checkout)}</tspan>
            </text>
          );
        })}
        {m.pages.map((p) => {
          const n = node.get(`p:${p.id}`)!;
          return (
            <text x={n.x + n.w + 6} y={n.y + n.h / 2} dy="0.35em" font-size={fsSmall} paint-order="stroke" stroke="#faf8f5" stroke-width="4" stroke-linejoin="round">
              {clip(p.label, 22)}
            </text>
          );
        })}
        <text x={checkout.x + checkout.w / 2} y={Math.max(fs, checkout.y - 8)} text-anchor="middle" font-weight="600" paint-order="stroke" stroke="#faf8f5" stroke-width="4" stroke-linejoin="round">
          Checkout <tspan font-family="Geist Mono, ui-monospace, monospace" font-weight="500">{money(m.checkout)}</tspan>
        </text>
        {(["kept", "refunded", "left"] as const).map((k) => {
          const n = node.get(`o:${k}`)!;
          if (!n || m[k] <= 0) return null;
          const x = n.x + n.w + 8;
          return (
            <text x={x} y={n.y + n.h / 2}>
              <tspan x={x} dy="-0.15em">{compact && k === "refunded" ? "Refunded" : OUT_LABEL[k]}</tspan>
              <tspan x={x} dy="1.2em" font-family="Geist Mono, ui-monospace, monospace" font-size={fsSmall} fill={k === "kept" ? "#0f7b4f" : k === "refunded" ? "#b4321f" : "#6b675f"}>{money(m[k])}</tspan>
            </text>
          );
        })}
      </g>
    </svg>
  );
}

export function MoneyFlow(props: { data: DashData; money: (c: number) => string }) {
  const wide = flowModel(props.data, { maxSources: 5, maxPages: 4 });
  const narrow = flowModel({ ...props.data, pageFlows: [] }, { maxSources: 4 });
  if (wide.checkout <= 0)
    return (
      <section class="flow" aria-label="Money flow" data-testid="money-flow">
        <h3 class="sec">Money flow</h3>
        <p class="muted small">Once a visitor starts a checkout, this shows where the money went: sources, the pages they landed on, checkout, then kept, refunded or never paid.</p>
      </section>
    );
  const h = Math.max(300, Math.min(420, 120 + wide.sources.length * 56));
  return (
    <section class="flow" aria-label="Money flow" data-testid="money-flow">
      <div class="sec-row">
        <h3 class="sec">Money flow</h3>
        <span class="num faint small">sources → pages → checkout → outcome</span>
      </div>
      <div class="flow-wide">
        <Drawing id="fw" model={wide} money={props.money} width={1040} height={h} padStart={170} padEnd={150} compact={false} />
      </div>
      <div class="flow-narrow">
        <Drawing id="fn" model={narrow} money={props.money} width={360} height={Math.max(250, 70 + narrow.sources.length * 52)} padStart={98} padEnd={84} compact={true} />
      </div>
    </section>
  );
}
