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
- \`zeff.context\` — where it is: { page?: { id, title }, databases: [{ id, title }] } (the databases shown on its page first).
- \`zeff.report({ score: 0..1, correct?, total?, answers?, done? })\` — only for exercises (a lesson counts it).
The calls underneath (zeff.call(name, args)):
${calls()}

## Permissions
Reading needs nothing. Writing (db.add, db.update) and zeff.ai need the user's OK: give the ids of the databases it writes to as \`writes\` and \`ai: true\` when it asks the AI. The user sees what it asks for and allows it once; until then such a call rejects with "not allowed". Never write anywhere the user didn't ask for.

## The kit: \`window.ZeffKit\` — use its parts, they are tested and look like Zeff
- \`ZeffKit.form(el, { db, fields?, title?, submit?, done?, values?, reset?, onSaved? })\` — a form that adds a row: reads the fields itself; fields: names or { name, label?, required?, placeholder?, help?, default?, long?, width: "half" }; values: set on every row unasked ({ Status: "New" }). Returns { el, ready }.
- \`ZeffKit.table(el, { db, columns?, where?, contains?, sort?, desc?, limit?, search?, empty?, title?, format?, onRow?, open? })\` — the rows, reading again on "changed"; format: { Field: (value, row) => text or node }; open: true opens a row on click. Returns { el, reload }.
- \`ZeffKit.stats(el, [{ label, value, detail?, tone?: "good"|"warn"|"bad" }])\` — figures side by side.
- \`ZeffKit.mount(el, exerciseSet)\` — exercises/quiz cards ({ title, items: [{ type: "choice"|"number"|"text"|…, q, … }] }).
- \`ZeffKit.plot({ x:[a,b], y:[c,d], height })\` (an SVG with .curve(f)/.point/.arrow), \`ZeffKit.expr("a*x^2", ["a","x"])\` (a safe formula → function of an object), \`ZeffKit.fmt(text)\` (**bold**, \`code\`, $math$ → HTML).
- \`ZeffKit.h(tag, { cls, text, html, onclick, … }, ...children)\` — make elements. Classes: zk-btn (+ pri), zk-in (inputs), zk-row, zk-muted, zk-tbl, zk-stat. Call \`ZeffKit.style()\` once when you use them without a part.

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
