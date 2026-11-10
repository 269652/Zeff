/**
 * Pictures inside a message — what an agent (the Learn teacher) writes as a fenced block in its text, shown right there
 * in a sandboxed widget frame instead of described or drawn in ASCII:
 *
 *   ```svg     an SVG drawing (as written; no scripts)
 *   ```plot    { fn | fns, params?, x?, y?, vectors?, points? } — curves y = f(x) with a slider per parameter, vectors as
 *              arrows ({ x, y, from?: [x, y], label?, color? }), labelled points
 *   ```chart   a Chart.js configuration ({ type, data, options })
 *   ```widget  { spec } (an exercise set — lib/widgets/spec.ts) or { html, libs?, title?, writes?, ai? } (a widget of its
 *              own — writes: the ids of the databases it asks to write to, ai: whether it asks the AI; the user allows it)
 *
 * splitBlocks cuts a text into its prose and these blocks; blockWidget makes a block's widget (its HTML and libraries)
 * or says what's wrong with it. Client-safe (pure).
 */
import { checkSpec, specHasMath, specHtml, type ExerciseSet } from "./spec";
import { checkWidgetHtml } from "./sandbox";
import { noWants, wantsOf, type WidgetWants } from "./bridge";

export const BLOCK_KINDS = ["svg", "plot", "chart", "widget"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export type Segment = { text: string } | { kind: BlockKind; body: string };

/** A message cut into its prose and its picture blocks (a block still being written — no closing fence yet — is prose). */
export function splitBlocks(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /```(svg|plot|chart|widget)[ \t]*\r?\n([\s\S]*?)\r?\n```/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ kind: m[1] as BlockKind, body: m[2] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.filter((s) => !("text" in s) || s.text.trim());
}

export type BlockWidget = { ok: true; html: string; libs: string[]; title: string; /** What it asks to be allowed. */ wants: WidgetWants } | { ok: false; why: string };

const json = (body: string): unknown => JSON.parse(body);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Data for a script inside the frame: as JSON that can't end its script tag. */
const data = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

type PlotCfg = {
  fn?: string;
  fns?: (string | { fn: string; label?: string; color?: string })[];
  params?: Record<string, { min: number; max: number; step?: number; value?: number }>;
  x?: [number, number];
  y?: [number, number];
  vectors?: { x: number; y: number; from?: [number, number]; label?: string; color?: string }[];
  points?: { x: number; y: number; label?: string; color?: string }[];
  title?: string;
  /** One unit as long on both axes (default: without curves — vectors, points). */
  equal?: boolean;
};

const COLORS = ["#6d28d9", "#0891b2", "#d97706", "#16a34a", "#db2777"];

function plotWidget(c: PlotCfg): BlockWidget {
  const fns = [...(c.fn ? [c.fn] : []), ...(c.fns ?? [])].map((f, i) => (typeof f === "string" ? { fn: f, color: COLORS[i % COLORS.length] } : { color: COLORS[i % COLORS.length], ...f }));
  if (!fns.length && !c.vectors?.length && !c.points?.length) return { ok: false, why: "plot: give fn (or fns), vectors or points" };
  if (fns.some((f) => typeof f.fn !== "string" || !f.fn.trim())) return { ok: false, why: "plot: each fn is a formula of x" };
  const ok2 = (r: unknown) => r === undefined || (Array.isArray(r) && r.length === 2 && r.every((n) => typeof n === "number") && r[0] < r[1]);
  if (!ok2(c.x) || !ok2(c.y)) return { ok: false, why: "plot: x and y are [min, max]" };
  // Without a window given: one around the vectors and points (and the origin), else -5…5.
  const xs = [0, ...(c.vectors ?? []).flatMap((v) => [v.x, v.from?.[0] ?? 0]), ...(c.points ?? []).map((p) => p.x)];
  const ys = [0, ...(c.vectors ?? []).flatMap((v) => [v.y, v.from?.[1] ?? 0]), ...(c.points ?? []).map((p) => p.y)];
  const span = (v: number[]): [number, number] => {
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    const pad = Math.max(1, (hi - lo) * 0.25);
    return [Math.floor(lo - pad), Math.ceil(hi + pad)];
  };
  const cfg = { ...c, fns, x: c.x ?? (fns.length ? [-5, 5] : span(xs)), y: c.y ?? (fns.length ? [-5, 5] : span(ys)) };
  const html = `<div id="p"></div><div id="s" style="display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center;max-width:520px;margin:8px auto 0"></div>
<script>
(function () {
  var c = ${data(cfg)};
  var names = Object.keys(c.params || {});
  var vals = {};
  names.forEach(function (n) { var p = c.params[n]; vals[n] = p.value != null ? p.value : (p.min + p.max) / 2; });
  var svg = ZeffKit.plot({ x: c.x, y: c.y, height: 320, equal: c.equal != null ? !!c.equal : !c.fns.length });
  svg.style.display = "block"; svg.style.margin = "0 auto";
  document.getElementById("p").appendChild(svg);
  var curves = c.fns.map(function (f) {
    var g = ZeffKit.expr(f.fn, ["x"].concat(names));
    var at = function (x) { vals.x = x; return g(vals); };
    return { g: g, c: svg.curve(at, { color: f.color }) };
  });
  (c.vectors || []).forEach(function (v, i) { var f = v.from || [0, 0]; svg.arrow(f[0], f[1], f[0] + v.x, f[1] + v.y, { label: v.label, color: v.color || ${data(COLORS)}[i % 5] }); });
  (c.points || []).forEach(function (p) { svg.point(p.x, p.y, { label: p.label, color: p.color }); });
  var s = document.getElementById("s");
  names.forEach(function (n) {
    var p = c.params[n];
    var out = document.createElement("b"); out.textContent = vals[n];
    var r = document.createElement("input"); r.type = "range"; r.min = p.min; r.max = p.max; r.step = p.step || (p.max - p.min) / 100; r.value = vals[n]; r.style.accentColor = "#6d28d9"; r.setAttribute("aria-label", n);
    r.oninput = function () { vals[n] = Number(r.value); out.textContent = Math.round(vals[n] * 1000) / 1000; curves.forEach(function (k) { k.c.update(function (x) { vals.x = x; return k.g(vals); }); }); };
    var l = document.createElement("i"); l.textContent = n;
    s.appendChild(l); s.appendChild(r); s.appendChild(out);
  });
})();
</script>`;
  return { ok: true, html, libs: [], title: c.title ?? "Plot", wants: noWants };
}

/** A block's widget, or what's wrong with it (said in the message, and to the agent). */
export function blockWidget(kind: BlockKind, body: string): BlockWidget {
  try {
    if (kind === "svg") {
      const svg = body.trim();
      if (!/^<svg[\s>]/i.test(svg)) return { ok: false, why: "svg: the block must be one <svg …>…</svg>" };
      const clean = svg.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
      return { ok: true, html: `<div style="text-align:center">${clean}</div><style>svg{max-width:100%;height:auto}</style>`, libs: [], title: "Drawing", wants: noWants };
    }
    if (kind === "plot") return plotWidget(json(body) as PlotCfg);
    if (kind === "chart") {
      const cfg = json(body) as { type?: unknown; data?: unknown };
      if (!cfg || typeof cfg.type !== "string" || !cfg.data) return { ok: false, why: "chart: a Chart.js configuration { type, data, options? }" };
      return { ok: true, html: `<div style="position:relative;max-width:640px;margin:0 auto"><canvas id="c"></canvas></div><script>new Chart(document.getElementById("c"), ${data(cfg)});</script>`, libs: ["chart"], title: "Chart", wants: noWants };
    }
    const w = json(body) as { spec?: unknown; html?: unknown; libs?: unknown; title?: unknown; writes?: unknown; ai?: unknown };
    if (w.spec) {
      const problems = checkSpec(w.spec);
      if (problems.length) return { ok: false, why: `widget: ${problems.join("; ")}` };
      const set = w.spec as ExerciseSet;
      return { ok: true, html: specHtml(set), libs: specHasMath(set) ? ["katex"] : [], title: set.title ?? String(w.title ?? "Exercise"), wants: noWants };
    }
    if (typeof w.html === "string") {
      const c = checkWidgetHtml(w.html);
      if (!c.ok) return { ok: false, why: `widget: ${c.why}` };
      return { ok: true, html: w.html, libs: Array.isArray(w.libs) ? w.libs.map(String) : [], title: String(w.title ?? "Widget"), wants: wantsOf(w.writes, w.ai) };
    }
    return { ok: false, why: "widget: { spec } or { html, libs? }" };
  } catch (e) {
    return { ok: false, why: `${kind}: not valid JSON (${e instanceof Error ? e.message : String(e)})` };
  }
}

/** Shown in place of a block that can't be: what it was meant to be (escaped). */
export const brokenBlockHtml = (why: string) => `<p>${esc(why)}</p>`;
