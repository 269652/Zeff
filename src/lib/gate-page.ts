/**
 * The gate's login page (src/lib/gate.ts): no React, no layout, no database — one self-contained document with a password field
 * that posts to /api/gate. English and German by the browser's language.
 */
const SCRIPT = `
const L = (navigator.language || "en").toLowerCase().startsWith("de")
  ? { title: "Anmelden", pw: "Passwort", btn: "Anmelden", bad: "Falsches Passwort.", slow: "Zu viele Versuche – warte ein paar Minuten." }
  : { title: "Sign in", pw: "Password", btn: "Sign in", bad: "Wrong password.", slow: "Too many tries – wait a few minutes." };
const $ = (id) => document.getElementById(id);
$("t").textContent = L.title; $("pw").placeholder = L.pw; $("pw").setAttribute("aria-label", L.pw); $("go").textContent = L.btn;
$("f").onsubmit = async (e) => {
  e.preventDefault();
  $("go").disabled = true; $("msg").textContent = "";
  try {
    const r = await fetch("/api/gate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: $("pw").value }) });
    if (r.ok) return location.reload();
    $("msg").textContent = r.status === 429 ? L.slow : L.bad;
  } catch (err) { $("msg").textContent = String(err); }
  $("go").disabled = false; $("pw").select();
};
$("pw").focus();
`;

export function gatePage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Zeff</title>
<style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#18181b;--mut:#71717a;--ac:#4f46e5;--bad:#dc2626;--line:#d4d4d8}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--fg:#fafafa;--mut:#a1a1aa;--ac:#818cf8;--bad:#f87171;--line:#3f3f46}}
html,body{height:100%;margin:0}body{display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{width:min(22rem,calc(100vw - 32px))}h1{font-size:1.25rem;margin:0 0 1rem;text-align:center}
input{box-sizing:border-box;width:100%;padding:.6rem .75rem;border:1px solid var(--line);border-radius:.5rem;background:transparent;color:inherit;font:inherit}
button{margin-top:.75rem;width:100%;padding:.6rem;border:0;border-radius:.5rem;background:var(--ac);color:var(--bg);font:inherit;font-weight:600;cursor:pointer}
button:disabled{opacity:.5}#msg{min-height:1.5em;margin:.5rem 0 0;color:var(--bad);text-align:center;font-size:.9rem}
</style></head>
<body><main><h1 id="t">Zeff</h1><form id="f"><input id="pw" type="password" autocomplete="current-password" required><button id="go" type="submit"></button></form><p id="msg" role="status" aria-live="polite"></p></main>
<script>${SCRIPT}</script></body></html>`;
}
