/**
 * The page the proxy answers with while Zeff is locked: no React, no layout, no database (nothing of Zeff is rendered) —
 * one self-contained document that asks the key (WebAuthn, PIN required) and posts the answer to /api/lock. English and
 * German by the browser's language. It starts the question by itself when the key is plugged in.
 */
const SCRIPT = `
const L = (navigator.language || "en").toLowerCase().startsWith("de")
  ? { title: "Zeff ist gesperrt", plug: "Steck den Sicherheitsschlüssel (YubiKey) ein.", ready: "Schlüssel erkannt – Zeff fragt nach PIN und Berührung.", btn: "Entsperren", touch: "Gib die PIN ein und berühre den Schlüssel, wenn er blinkt …", cancelled: "Abgebrochen oder Zeit abgelaufen.", reset: "Ausgesperrt? Lösche data/lock.json neben der Datenbank." }
  : { title: "Zeff is locked", plug: "Plug in your security key (YubiKey).", ready: "Key found – Zeff asks for the PIN and a touch.", btn: "Unlock", touch: "Enter the PIN and touch the key when it blinks …", cancelled: "Cancelled or timed out.", reset: "Locked out? Delete data/lock.json next to the database." };
const $ = (id) => document.getElementById(id);
const dec = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const enc = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
let busy = false, shown = null;
const say = (t, bad) => { $("msg").textContent = t; $("msg").className = bad ? "bad" : ""; };
async function post(body) {
  const r = await fetch("/api/lock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || ("HTTP " + r.status));
  return j;
}
async function unlock() {
  if (busy) return;
  busy = true; $("go").disabled = true; say(L.touch);
  try {
    const o = (await post({ step: "unlock-options" })).options;
    const c = await navigator.credentials.get({ publicKey: { challenge: dec(o.challenge), rpId: o.rpId, allowCredentials: o.allowCredentials.map((k) => ({ type: k.type, id: dec(k.id) })), userVerification: "required", timeout: 60000 } });
    const r = c.response;
    await post({ step: "unlock-verify", challenge: o.challenge, id: c.id, clientDataJSON: enc(r.clientDataJSON), authenticatorData: enc(r.authenticatorData), signature: enc(r.signature) });
    location.reload();
  } catch (e) {
    say(e && (e.name === "NotAllowedError" || e.name === "AbortError") ? L.cancelled : (e && e.message) || String(e), true);
    busy = false; $("go").disabled = false;
  }
}
async function look() {
  try {
    const s = await (await fetch("/api/lock", { cache: "no-store" })).json();
    if (!s.locked) return location.reload();
    const present = s.keyPresent === true;
    $("go").disabled = busy || !present;
    if (!busy && shown !== present) { say(present ? L.ready : L.plug); if (present && shown === false) unlock(); }
    shown = present;
  } catch {}
}
$("t").textContent = L.title; $("go").textContent = L.btn; $("reset").textContent = L.reset;
$("go").onclick = unlock;
look(); setInterval(look, 1000);
`;

export function lockPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Zeff</title>
<style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#18181b;--mut:#71717a;--ac:#4f46e5;--bad:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--fg:#fafafa;--mut:#a1a1aa;--ac:#818cf8;--bad:#f87171}}
html,body{height:100%;margin:0}body{display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{width:min(26rem,calc(100vw - 32px));text-align:center}
h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:.5rem 0;color:var(--mut)}
button{margin-top:1rem;padding:.6rem 1.4rem;border:0;border-radius:.5rem;background:var(--ac);color:var(--bg);font:inherit;font-weight:600;cursor:pointer}
button:disabled{opacity:.4;cursor:default}#msg.bad{color:var(--bad)}#reset{font-size:.8rem;margin-top:2rem}
</style></head>
<body><main><h1 id="t">Zeff</h1><p id="msg" role="status" aria-live="polite"></p><button id="go" type="button" disabled></button><p id="reset"></p></main>
<script>${SCRIPT}</script></body></html>`;
}
