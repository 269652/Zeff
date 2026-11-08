/**
 * Interactive widgets — a building block of Zeff: a small program (HTML/JS) an agent writes on the fly (a quiz, a plot
 * with sliders, a surface to turn, cards to flip), shown in a sandboxed frame: no access to Zeff (an opaque origin: no
 * cookies, no storage of Zeff's), no network (CSP connect-src 'none'), only the libraries Zeff ships (WIDGET_LIBS,
 * served by /api/widgets/lib). It talks back through one narrow bridge — `zeff.report({ score, correct, total, note })`
 * and its own height — and Zeff checks every message before anything comes of it. Client-safe (pure).
 */

/** The libraries a widget may use: name → the files (under node_modules) Zeff serves for it. */
export const WIDGET_LIBS: Record<string, { js?: string[]; css?: string[]; what: string }> = {
  katex: { js: ["katex/katex.min.js", "katex/contrib/auto-render.min.js"], css: ["katex/katex.min.css"], what: "math formulas (katex.render, renderMathInElement)" },
  jsxgraph: { js: ["jsxgraph/jsxgraphcore.js"], css: ["jsxgraph/jsxgraph.css"], what: "interactive geometry, function plots with sliders (JXG.JSXGraph.initBoard)" },
  three: { js: ["three/three.min.js"], what: "3D (window.THREE, r159): surfaces, curves in space" },
  chart: { js: ["chart/chart.umd.js"], what: "charts (window.Chart)" },
};

/** The most a widget's HTML may be. */
export const MAX_WIDGET_HTML = 300_000;

/** Whether a widget's HTML may be shown: not too big, and nothing that would lead the frame elsewhere or loosen its rules. */
export function checkWidgetHtml(html: string): { ok: true } | { ok: false; why: string } {
  if (typeof html !== "string" || !html.trim()) return { ok: false, why: "empty" };
  if (html.length > MAX_WIDGET_HTML) return { ok: false, why: `too big (${html.length} characters, at most ${MAX_WIDGET_HTML})` };
  if (/<base[\s>]/i.test(html)) return { ok: false, why: "<base> isn't allowed" };
  if (/<meta[^>]+http-equiv\s*=\s*["']?\s*(refresh|content-security-policy)/i.test(html)) return { ok: false, why: "a meta refresh or a Content-Security-Policy of its own isn't allowed" };
  return { ok: true };
}

/** The bridge: the only way out of the frame (postMessage to the page, which checks the sender is this frame). */
const BRIDGE = `<script>
(function () {
  var send = function (m) { m.zeffWidget = 1; parent.postMessage(m, "*"); };
  window.zeff = {
    report: function (r) { r = r || {}; send({ type: "result", score: r.score, correct: r.correct, total: r.total, note: r.note }); },
    resize: function (h) { send({ type: "resize", height: h }); }
  };
  var last = 0;
  var fit = function () { var h = Math.ceil(document.documentElement.scrollHeight); if (Math.abs(h - last) > 4) { last = h; window.zeff.resize(h); } };
  if (window.ResizeObserver) new ResizeObserver(fit).observe(document.documentElement);
  window.addEventListener("load", fit);
})();
</script>`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The document the frame shows (srcdoc): our rules, the bridge, the libraries asked for, then the widget. */
export function buildSrcdoc(html: string, opts: { libs?: string[]; libBase: string; dark?: boolean }): string {
  const base = opts.libBase.replace(/\/+$/, "");
  const libs = [...new Set(opts.libs ?? [])].filter((l) => Object.prototype.hasOwnProperty.call(WIDGET_LIBS, l));
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${base}/`,
    `style-src 'unsafe-inline' ${base}/`,
    `font-src ${base}/ data:`,
    "img-src data: blob:",
    "media-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join("; ");
  const css = libs.flatMap((l) => WIDGET_LIBS[l].css ?? []).map((f) => `<link rel="stylesheet" href="${esc(`${base}/${f}`)}">`);
  const js = libs.flatMap((l) => WIDGET_LIBS[l].js ?? []).map((f) => `<script src="${esc(`${base}/${f}`)}"></script>`);
  const theme = `<style>:root{color-scheme:${opts.dark ? "dark" : "light"}}html,body{margin:0;padding:12px;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:${opts.dark ? "#18181b" : "#fff"};color:${opts.dark ? "#ececf1" : "#18181b"}}button{font:inherit}</style>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(csp)}"><meta name="viewport" content="width=device-width,initial-scale=1">${theme}${css.join("")}${BRIDGE}${js.join("")}</head><body>${html}</body></html>`;
}

export type WidgetMessage = { type: "result"; score: number; correct?: number; total?: number; note?: string } | { type: "resize"; height: number };

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A message from a widget's frame, checked: a result (score 0–1, from correct/total if not given) or its height. */
export function parseWidgetMessage(data: unknown): WidgetMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.zeffWidget !== 1) return null;
  if (m.type === "resize") {
    const h = n(m.height);
    return h === undefined ? null : { type: "resize", height: Math.max(40, Math.min(4000, Math.round(h))) };
  }
  if (m.type !== "result") return null;
  const correct = n(m.correct);
  const total = n(m.total);
  let score = n(m.score);
  if (score === undefined && correct !== undefined && total) score = correct / total;
  if (score === undefined) return null;
  const note = typeof m.note === "string" ? m.note.slice(0, 500) : undefined;
  return {
    type: "result",
    score: Math.max(0, Math.min(1, score)),
    ...(correct !== undefined ? { correct: Math.max(0, Math.round(correct)) } : {}),
    ...(total !== undefined ? { total: Math.max(0, Math.round(total)) } : {}),
    ...(note ? { note } : {}),
  };
}

/** The experience a widget's result is worth: up to 5, by the score. */
export const xpForResult = (r: { type: "result"; score: number }) => Math.round(5 * Math.max(0, Math.min(1, r.score)));
