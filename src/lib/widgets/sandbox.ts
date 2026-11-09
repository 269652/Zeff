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
  // The widget as it is now, to look at later (the lesson's timeline): its body with what was typed and chosen written
  // into it, canvases (Chart.js, three.js, drawings) as pictures, SVG (JSXGraph, KaTeX) as it stands — no scripts.
  var snap = function () {
    try {
      var root = document.body.cloneNode(true);
      var from = document.body.querySelectorAll("input,textarea,select"), to = root.querySelectorAll("input,textarea,select");
      for (var i = 0; i < from.length; i++) {
        var a = from[i], b = to[i];
        if (a.type === "checkbox" || a.type === "radio") { if (a.checked) b.setAttribute("checked", ""); else b.removeAttribute("checked"); }
        else if (a.tagName === "SELECT") { for (var k = 0; k < a.options.length; k++) if (a.options[k].selected) b.options[k].setAttribute("selected", ""); }
        else if (a.tagName === "TEXTAREA") b.textContent = a.value;
        else b.setAttribute("value", a.value);
      }
      var cs = document.body.querySelectorAll("canvas"), cd = root.querySelectorAll("canvas");
      for (var j = 0; j < cs.length; j++) {
        try { var img = document.createElement("img"); img.src = cs[j].toDataURL("image/png"); img.style.cssText = cs[j].style.cssText; img.width = cs[j].clientWidth || cs[j].width; img.height = cs[j].clientHeight || cs[j].height; cd[j].replaceWith(img); } catch (e) {}
      }
      var scripts = root.querySelectorAll("script");
      for (var s = 0; s < scripts.length; s++) scripts[s].remove();
      var html = root.innerHTML;
      return html.length <= 3000000 ? html : undefined;
    } catch (e) { return undefined; }
  };
  window.zeff = {
    report: function (r) { r = r || {}; send({ type: "result", score: r.score, correct: r.correct, total: r.total, note: r.note, answers: r.answers, done: r.done === true, snapshot: snap() }); },
    resize: function (h) { send({ type: "resize", height: h }); },
    // Something went wrong in the widget: told to the page (the teacher hears of it), once per message.
    error: function (m) { m = String(m || "error").slice(0, 400); if (said[m]) return; said[m] = 1; send({ type: "error", message: m }); }
  };
  var said = {};
  // An error the widget didn't catch: a friendly note at the top (what still works keeps working), and told.
  var note = function () {
    try {
      if (!document.body || document.getElementById("zeff-widget-error")) return;
      var d = document.createElement("div");
      d.id = "zeff-widget-error";
      d.setAttribute("role", "status");
      d.style.cssText = "margin:0 0 10px;padding:8px 12px;border-radius:10px;border-left:4px solid #d97706;background:rgba(217,119,6,.1);font-size:14px";
      var l = (document.documentElement.lang || "de").slice(0, 2);
      d.textContent = l === "de" ? "Hier hakt etwas im Widget — dein Lehrer weiß Bescheid und baut es neu." : l === "es" ? "Algo falló en este widget — tu profesor ya lo sabe y lo rehará." : "Something in this widget broke — your teacher has been told and will rebuild it.";
      document.body.insertBefore(d, document.body.firstChild);
    } catch (e) {}
  };
  window.addEventListener("error", function (e) { var m = (e && e.message) || "error"; if (e && e.lineno) m += " (line " + e.lineno + ")"; window.zeff.error(m); note(); });
  window.addEventListener("unhandledrejection", function (e) { var r = e && e.reason; window.zeff.error(String((r && r.message) || r || "error")); note(); });
  var last = 0;
  var fit = function () { var h = Math.ceil(document.documentElement.scrollHeight); if (Math.abs(h - last) > 4) { last = h; window.zeff.resize(h); } };
  if (window.ResizeObserver) new ResizeObserver(fit).observe(document.documentElement);
  window.addEventListener("load", fit);
})();
</script>`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** A library's text inside its tag: it can't close the tag early. */
const inScript = (code: string) => code.replace(/<\/(script)/gi, "<\\/$1");
const inStyle = (css: string) => css.replace(/<\/(style)/gi, "<\\/$1");

/**
 * The document the frame shows (srcdoc): our rules, the bridge, the libraries, then the widget. The libraries either
 * by address (`libs` + `libBase`) or — what the page does, so it works on the phone too — `inline`: their code put in
 * (the page fetched it: /api/widgets/bundle), then the frame loads nothing at all.
 */
export function buildSrcdoc(html: string, opts: ({ libs?: string[]; libBase: string } | { inline: { js: string[]; css: string[] } }) & { dark?: boolean; lang?: string }): string {
  const inline = "inline" in opts ? opts.inline : null;
  const base = "libBase" in opts ? opts.libBase.replace(/\/+$/, "") : "";
  const libs = "libs" in opts ? [...new Set(opts.libs ?? [])].filter((l) => Object.prototype.hasOwnProperty.call(WIDGET_LIBS, l)) : [];
  const from = inline ? "" : ` ${base}/`;
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline'${from}`,
    `style-src 'unsafe-inline'${from}`,
    `font-src${from} data:`,
    "img-src data: blob:",
    "media-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    // Code exercises (the kit) run in a Worker made from a blob — nothing from outside.
    "worker-src blob:",
  ].join("; ");
  const css = inline
    ? inline.css.map((c) => `<style>${inStyle(c)}</style>`)
    : libs.flatMap((l) => WIDGET_LIBS[l].css ?? []).map((f) => `<link rel="stylesheet" href="${esc(`${base}/${f}`)}">`);
  const js = inline ? inline.js.map((c) => `<script>${inScript(c)}</script>`) : libs.flatMap((l) => WIDGET_LIBS[l].js ?? []).map((f) => `<script src="${esc(`${base}/${f}`)}"></script>`);
  const theme = `<style>:root{color-scheme:${opts.dark ? "dark" : "light"}}html,body{margin:0;padding:12px;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:${opts.dark ? "#18181b" : "#fff"};color:${opts.dark ? "#ececf1" : "#18181b"}}button{font:inherit}</style>`;
  const lang = /^[a-z]{2}$/.test(opts.lang ?? "") ? opts.lang : "de";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(csp)}"><meta name="viewport" content="width=device-width,initial-scale=1">${theme}${css.join("")}${BRIDGE}${js.join("")}</head><body>${html}</body></html>`;
}

export type WidgetMessage = { type: "result"; score: number; correct?: number; total?: number; note?: string; /** The exercise is over (the lesson goes on). */ done?: boolean; /** What was asked and answered (the lesson's timeline shows it). */ answers?: { q: string; a: string; ok?: boolean }[]; /** The widget as it looked (its body, no scripts — the timeline shows it later). */ snapshot?: string } | { type: "resize"; height: number } | { type: "error"; message: string };

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A snapshot at most this long (a drawing with its canvases as pictures can be big); longer: left out, the result counts. */
export const MAX_SNAPSHOT = 3_000_000;

/** The answers a result carries: at most 50, question and answer as text (300 characters each), right or not if known. */
function answersOf(v: unknown): { q: string; a: string; ok?: boolean }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: { q: string; a: string; ok?: boolean }[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (o.q === undefined || o.a === undefined) continue;
    out.push({ q: String(o.q).slice(0, 300), a: String(o.a).slice(0, 300), ...(typeof o.ok === "boolean" ? { ok: o.ok } : {}) });
    if (out.length === 50) break;
  }
  return out.length ? out : undefined;
}

/** A message from a widget's frame, checked: a result (score 0–1, from correct/total if not given) or its height. */
export function parseWidgetMessage(data: unknown): WidgetMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.zeffWidget !== 1) return null;
  if (m.type === "resize") {
    const h = n(m.height);
    return h === undefined ? null : { type: "resize", height: Math.max(40, Math.min(4000, Math.round(h))) };
  }
  if (m.type === "error") return typeof m.message === "string" && m.message.trim() ? { type: "error", message: m.message.slice(0, 400) } : null;
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
    ...(m.done === true ? { done: true } : {}),
    ...(answersOf(m.answers) ? { answers: answersOf(m.answers) } : {}),
    ...(typeof m.snapshot === "string" && m.snapshot.trim() && m.snapshot.length <= MAX_SNAPSHOT ? { snapshot: m.snapshot } : {}),
  };
}

/** The experience a widget's result is worth: up to 5, by the score. */
export const xpForResult = (r: { type: "result"; score: number }) => Math.round(5 * Math.max(0, Math.min(1, r.score)));
