/**
 * How to write a widget — what every AI that builds one reads (the Workspace assistant's widget tools, a page's "✨ Widget"
 * block, the Learn teacher): the sandbox's rules, the bridge (bridge.ts CALL_METHODS — said from the same list the page
 * checks against), the kit's parts (kit/kit.js) and the libraries (sandbox.ts WIDGET_LIBS). One text, so a widget written
 * anywhere works everywhere. Client-safe (pure).
 */
import { CALL_METHODS } from "./bridge";
import { WIDGET_LIBS } from "./sandbox";

const calls = () =>
  Object.entries(CALL_METHODS)
    .filter(([name]) => !["state.get", "state.set"].includes(name))
    .map(([name, m]) => `- \`zeff.call("${name}", ${m.args || "{}"})\` → ${m.returns} — ${m.what}${m.need === "write" ? " (needs the user's OK: `writes`)" : m.need === "ai" ? " (needs the user's OK: `ai`)" : ""}`)
    .join("\n");

export const WIDGET_GUIDE = `# Widgets: small apps Zeff runs in a sandbox

A widget is ONE HTML fragment — elements, <style> and inline <script> (no <html>/<head>, no build step, plain modern JavaScript). Zeff shows it in a sandboxed frame wherever it is put: a block of a page, the assistant's answer, a lesson.
- No network: fetch/XHR/WebSocket fail; no external scripts, fonts or pictures (inline <svg> and data: URLs are fine). Data comes only through \`zeff\` (below).
- No storage of its own (localStorage is gone on reload): keep what must stay with \`zeff.state\`.
- Its height follows its content. Light or dark: :root has the page's color-scheme — use currentColor, transparent backgrounds, or the kit's parts (they follow it).
- An uncaught error shows a small note and is reported; catch what you expect and say it in words.

## Libraries — name them in \`libs\`; the kit is always there
${Object.entries(WIDGET_LIBS)
  .map(([k, v]) => `- ${k}: ${v.what}`)
  .join("\n")}

## The bridge: \`window.zeff\` (every call returns a Promise; it rejects with a plain message — show it)
- \`zeff.db.list()\`, \`zeff.db.schema(db)\`, \`zeff.db.rows(db, { where?, contains?, sort?, desc?, limit? })\`, \`zeff.db.add(db, values)\`, \`zeff.db.update(db, rowId, values)\` — db: a database's id (best) or title.
- Rows come as \`{ id, title, values: { "Field": value } }\`: numbers as numbers, checkboxes true/false, a choice as its name, several as a list, dates "YYYY-MM-DD", people and related rows by name. Write values the same way (a new choice name makes the option).
- \`zeff.state.get()\` / \`zeff.state.set(value)\` — this widget's own memory (JSON, kept with it).
- \`zeff.ai(prompt, { schema? })\` → { text } (or the object of the JSON schema) — sparingly.
- \`zeff.toast(text)\`, \`zeff.open(rowId)\` (opens a row's page in Zeff).
- \`zeff.on("changed", fn)\` — something in the workspace changed (also this widget's own write): read again.
- \`zeff.flow.run(name, input)\` → { status, output, error } — Zeff's server side: a flow does what a widget can't (web requests and APIs, reading a web page, lookups, AI extraction, writing rows); \`zeff.flow.list()\` names them. Name the flows it runs as \`flows\`. Real data from the internet (a protein from the PDB, measurements, prices) comes this way.
- Widgets on one page work together: \`zeff.page.set(key, value)\` / \`zeff.page.get(key?)\` share values (kept with the page) — the others hear \`zeff.on("page", ({ key, value }) => …)\`; \`zeff.emit(name, detail)\` sends a message the others hear with \`zeff.on(name, detail => …)\`. A picker in one widget, the chart in another: the picker sets "selected", the chart listens. Use the keys and names the other widgets on the page already use.
- Results for the whole of Zeff: \`zeff.publish(name, value, { unit?, label? })\` — a number, a text, a list, a table (a list of row objects). Other widgets anywhere read it with \`zeff.values.get(name)\` (\`zeff.values.list()\` names them) and hear \`zeff.on("value", ({ name, value }) => …)\`; a view shows it as \`{{ outputs.name }}\`; a number is a Kennzahl (formulas: kennzahl("name")); the assistant can pour a published table into a database. Publish what others could compute on (a total, a fitted curve's parameters, a simulation's results table) under a clear name; a name is this widget's once published.
(In a Learn lesson only \`zeff.report\` and the libraries are there — no databases, flows, page or published values.)
- \`zeff.context\` — where it is: { page?: { id, title }, databases: [{ id, title }] } (the databases shown on its page first).
- \`zeff.report({ score: 0..1, correct?, total?, answers?, done? })\` — only for exercises (a lesson counts it).
The calls underneath (zeff.call(name, args)):
${calls()}

## Permissions
Reading needs nothing. Writing (db.add, db.update), zeff.ai and zeff.flow.run need the user's OK: give the ids of the databases it writes to as \`writes\`, \`ai: true\` when it asks the AI, the flows it runs as \`flows\`. The user sees what it asks for and allows it once; until then such a call rejects with "not allowed". Never write anywhere the user didn't ask for.

## The kit: \`window.ZeffKit\` — use its parts, they are tested and look like Zeff
- \`ZeffKit.form(el, { db, fields?, title?, submit?, done?, values?, reset?, onSaved? })\` — a form that adds a row: reads the fields itself; fields: names or { name, label?, required?, placeholder?, help?, default?, long?, width: "half" }; values: set on every row unasked ({ Status: "New" }). Returns { el, ready }.
- \`ZeffKit.table(el, { db, columns?, where?, contains?, sort?, desc?, limit?, search?, empty?, title?, format?, onRow?, open? })\` — the rows, reading again on "changed"; format: { Field: (value, row) => text or node }; open: true opens a row on click. Returns { el, reload }.
- \`ZeffKit.stats(el, [{ label, value, detail?, tone?: "good"|"warn"|"bad" }])\` — figures side by side.
- \`ZeffKit.mount(el, exerciseSet)\` — exercises/quiz cards ({ title, items: [{ type: "choice"|"number"|"text"|…, q, … }] }).
- \`ZeffKit.plot({ x:[a,b], y:[c,d], height })\` (an SVG with .curve(f)/.point/.arrow), \`ZeffKit.expr("a*x^2", ["a","x"])\` (a safe formula → function of an object), \`ZeffKit.fmt(text)\` (**bold**, \`code\`, $math$ → HTML).
- \`ZeffKit.h(tag, { cls, text, html, onclick, … }, ...children)\` — make elements. Classes: zk-btn (+ pri), zk-in (inputs), zk-row, zk-muted, zk-tbl, zk-stat. Call \`ZeffKit.style()\` once when you use them without a part.

## The science kit (on ZeffKit too) — science and maths as real apps, not toys
- Numbers: \`ZeffKit.linspace(a, b, n)\`, \`ZeffKit.ode((t, y) => dy, y0, [t0, t1], { steps } | { tol })\` (RK4 or adaptive RK45; y a number or a list) → { t, y }, \`ZeffKit.integrate(f, a, b)\`, \`ZeffKit.root(f, a, b)\`, \`ZeffKit.minimize(f, a, b)\`, \`ZeffKit.derivative(f, x)\`, \`ZeffKit.grid((x, y) => z, xs, ys)\` (for Plotly surface/contour), \`ZeffKit.fit(points, degree)\` → { coef, f, r2 }.
- Colour: \`ZeffKit.colormap("viridis"|"plasma"|"inferno"|"magma"|"cividis"|"turbo"|"coolwarm", t)\`, \`ZeffKit.colormapScale(name)\` (Plotly's colorscale). Formulas: \`ZeffKit.tex(el, latex)\` (with katex).
- 3D (libs: three): \`const s = ZeffKit.scene(el, { height: 420, camera: [0, 0, 6], autoRotate, bloom, background })\` → { THREE, scene, camera, renderer, controls, add(obj), label(obj, text, [x,y,z]), onFrame((dt, t) => …), fit(obj) } — lights, orbit controls, labels, resize, dark mode done. \`ZeffKit.isosurface((x, y, z) => value, { resolution: 64, bounds: 1.5, color, colorBy: (x,y,z) => 0..1, map })\` → a mesh where value > 0: organic shapes (a brain, a heart, a cell, an orbital) from fields; \`new THREE.SimplexNoise().noise3d(x, y, z)\` for folds and texture.
- Answers (libs: mathjs, algebrite, katex, plotly): \`ZeffKit.pods(el, [{ title, tex | text | table: { head, rows } | plot: { expr, var, from, to } | plotly: { data, layout } }])\` — results one under the other; \`ZeffKit.alpha(el, { examples })\` — a complete Wolfram|Alpha-like calculator: a question in words, the AI (ai: true) only says what to compute, mathjs and Algebrite compute it here, every step shown.
- Ambition: these libraries make full apps possible — a symbolic calculator, a molecule viewer, an orbit simulator, a lab with physics, a 3D anatomy model with labels, a network explorer, a star chart. Build the real thing the user asked for, complete and interactive (controls, sliders, hover, labels), not a sketch of it.

## Example — a 3D brain with labelled lobes (libs: three)
\`\`\`html
<div id="v"></div>
<script>
  const s = ZeffKit.scene("#v", { height: 460, camera: [0, 0.5, 3.4], autoRotate: true });
  const N = new THREE.SimplexNoise();
  const brain = ZeffKit.isosurface((x, y, z) => {
    const half = (cx) => 1 - ((x - cx) ** 2 / 0.42 + y ** 2 / 0.55 + z ** 2 / 0.9);  // two hemispheres
    const folds = 0.07 * N.noise3d(x * 7, y * 7, z * 7);                              // gyri and sulci
    return Math.max(half(-0.36), half(0.36)) + folds - (Math.abs(x) < 0.03 ? 0.4 : 0);   // the fissure between them
  }, { resolution: 72, bounds: 1.2, colorBy: (x, y, z) => (z > 0.3 ? 0.15 : y > 0.25 ? 0.45 : z < -0.4 ? 0.7 : 0.9), map: "plasma" });
  s.add(brain);
  [["Frontal lobe", [0, 0.3, 0.95]], ["Parietal lobe", [0, 0.8, -0.2]], ["Occipital lobe", [0, 0.2, -1.05]], ["Temporal lobe", [0.85, -0.35, 0.2]]].forEach(([n, p]) => s.label(brain, n, p));
</script>
\`\`\`

## Look
Calm and dense: no big headings, no explanations of how to use it, one accent colour at most, the main thing first. Works at 360 px wide. Labels in the user's language.

## Example — a form that fills database 12 and its last entries under it
\`\`\`html
<div id="f"></div><div id="t" style="margin-top:16px"></div>
<script>
  ZeffKit.form("#f", { db: 12, fields: [{ name: "Name", required: true }, { name: "E-Mail", width: "half" }, { name: "Topic", width: "half" }], values: { Status: "New" }, submit: "Send" });
  ZeffKit.table("#t", { db: 12, columns: ["Name", "Topic", "Status"], sort: "Created", desc: true, limit: 5, open: true });
</script>
\`\`\`
with writes: [12].`;
