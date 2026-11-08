// Zeff on the phone: your todos, ticked off here — live over WebRTC while the phone is at home with the PC
// (rtc.js), kept on the phone and queued while it's away. The queue goes to the PC when the phone is back:
// each change once (the PC remembers the ids it applied), in the order you made them.
import { connect, parsePairing } from "./rtc.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};

// ---------------------------------------------------------------------------------------------------------------------
// Words (English and German)
// ---------------------------------------------------------------------------------------------------------------------

const DE = navigator.language?.toLowerCase().startsWith("de");
const WORDS = {
  "Pair your phone": ["Pair your phone", "Handy koppeln"],
  welcome1: ["Zeff on your phone: your todos, ticked off here — straight to your PC over your Wi-Fi, with no server in between.", "Zeff auf dem Handy: deine Todos, hier abgehakt — direkt über dein WLAN zum PC, ohne Server dazwischen."],
  welcome2: ["On the PC: the Zeff icon in the tray → Phone → Pair a phone.", "Am PC: das Zeff-Symbol in der Taskleiste → Phone → Pair a phone."],
  welcome3: ["Scan the code with this phone's camera and open the link.", "Den Code mit der Kamera dieses Handys scannen und den Link öffnen."],
  welcome4: ["Phone and PC need to be on the same Wi-Fi to connect. What you tick while away is sent when you're back home.", "Handy und PC müssen im selben WLAN sein. Was du unterwegs abhakst, wird gesendet, sobald du wieder zu Hause bist."],
  live: ["Live", "Verbunden"],
  connecting: ["Connecting …", "Verbinde …"],
  away: ["Not at home", "Nicht zu Hause"],
  denied: ["Unpaired — scan again", "Entkoppelt — neu scannen"],
  waiting: ["{n} waiting", "{n} wartend"],
  "Nothing open.": ["Nothing open.", "Nichts offen."],
  closed: ["Done lately ({n})", "Zuletzt erledigt ({n})"],
  synced: ["As of {time}", "Stand {time}"],
  never: ["Not synced yet", "Noch nicht abgeglichen"],
  "Flag important": ["Flag important", "Als wichtig markieren"],
  "will be sent": ["will be sent at home", "wird zu Hause gesendet"],
  due: ["due {d}", "fällig {d}"],
};
const tr = (key, vars = {}) => (WORDS[key]?.[DE ? 1 : 0] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
document.documentElement.lang = DE ? "de" : "en";
for (const n of document.querySelectorAll("[data-t]")) n.textContent = tr(n.dataset.t);

// ---------------------------------------------------------------------------------------------------------------------
// What the phone keeps: the pairing, the todos as last seen, the changes not yet on the PC
// ---------------------------------------------------------------------------------------------------------------------

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`zeff.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`zeff.${key}`, JSON.stringify(value));
    } catch {
      // full or blocked: it lives on in memory until the page closes
    }
  },
};

// A pairing link (the QR code): kept, and taken out of the address bar — it holds this phone's secret.
const fromLink = parsePairing(location.hash);
if (fromLink) {
  store.set("pairing", fromLink);
  history.replaceState(null, "", location.pathname + location.search);
}
// Ask the browser to keep what we store (a phone low on space may otherwise clear it — and the queue with it).
navigator.storage?.persist?.().catch(() => {});

let pairing = store.get("pairing", null);
let snapshot = store.get("snapshot", { at: null, todos: [] });
let outbox = store.get("outbox", []);
let conn = null;
let state = pairing ? "away" : "none";

const newId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** The todos as you see them: the PC's last word with your changes on top that it hasn't confirmed yet. */
function view() {
  const todos = new Map(snapshot.todos.map((t) => [t.id, { ...t }]));
  for (const op of outbox) {
    const t = todos.get(op.todoId);
    if (!t) continue;
    t.pending = true;
    if (op.kind === "status") {
      t.status = op.status;
      t.doneAt = op.status === "open" ? null : op.at;
    } else if (op.kind === "flag") t.flagged = op.flagged;
  }
  return [...todos.values()];
}

/** A change of yours: on the phone at once, to the PC now (live) or later (queued). */
function change(op) {
  outbox.push({ id: newId(), at: new Date().toISOString(), ...op });
  store.set("outbox", outbox);
  render();
  flush();
}

function flush() {
  if (conn && outbox.length) conn.send({ t: "ops", ops: outbox });
}

// ---------------------------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------------------------

const today = () => new Date().toLocaleDateString("sv-SE");
const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function todoItem(t) {
  const closed = t.status !== "open";
  const box = el("input", { type: "checkbox", checked: closed, onchange: () => change({ kind: "status", todoId: t.id, status: box.checked ? "done" : "open" }) });
  const meta = el("span", { className: "meta" });
  const bits = [];
  if (t.ticket) bits.push(document.createTextNode(t.ticket));
  if (t.due && !closed) bits.push(el("span", { className: t.due.slice(0, 10) <= today() ? "due-now" : "", textContent: tr("due", { d: fmtDay(t.due.slice(0, 10)) }) }));
  if (t.pending) bits.push(el("span", { className: "pending", textContent: tr("will be sent") }));
  bits.forEach((b, i) => meta.append(...(i ? [" · ", b] : [b])));
  const text = el("span", { className: "text" }, t.text, ...(bits.length ? [meta] : []));
  const star = el("button", {
    type: "button",
    textContent: t.flagged ? "★" : "☆",
    title: tr("Flag important"),
    ariaLabel: tr("Flag important"),
    onclick: () => change({ kind: "flag", todoId: t.id, flagged: !t.flagged }),
  });
  star.setAttribute("aria-pressed", String(!!t.flagged));
  return el("li", { className: `todo${closed ? " closed" : ""}` }, el("label", {}, box, text), star);
}

function render() {
  const s = $("status");
  s.className = `status ${state === "none" ? "away" : state}`;
  const waiting = outbox.length ? ` · ${tr("waiting", { n: outbox.length })}` : "";
  $("statusText").textContent = state === "none" ? tr("away") : tr(state) + waiting;
  s.hidden = state === "none";
  $("welcome").hidden = !!pairing && state !== "denied";
  $("list").hidden = !pairing;
  if (!pairing) return;
  const all = view();
  // Yours first; the flagged on top, then by when they're due, then the newest.
  const order = (a, b) => (b.flagged - a.flagged) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.id - a.id;
  const open = all.filter((t) => t.status === "open" && t.owner !== "other").sort(order);
  const waitingFor = all.filter((t) => t.status === "open" && t.owner === "other").sort(order);
  const done = all.filter((t) => t.status !== "open").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  $("open").replaceChildren(...[...open, ...waitingFor].map(todoItem));
  $("empty").hidden = open.length + waitingFor.length > 0;
  $("empty").textContent = tr("Nothing open.");
  $("doneBox").hidden = !done.length;
  $("doneTitle").textContent = tr("closed", { n: done.length });
  $("done").replaceChildren(...done.map(todoItem));
  $("foot").textContent = snapshot.at
    ? `${pairing.name} · ${tr("synced", { time: new Date(snapshot.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) })}`
    : tr("never");
}

// ---------------------------------------------------------------------------------------------------------------------
// The connection: tried when the page opens, comes back to the front, the network changes — and every 20 s
// while it's away (at home the PC answers within a second; away nothing does, and that costs nothing)
// ---------------------------------------------------------------------------------------------------------------------

let trying = false;
async function tryConnect() {
  if (!pairing || conn || trying || state === "denied") return;
  trying = true;
  state = "connecting";
  render();
  try {
    const c = await connect(pairing);
    conn = c;
    state = "live";
    c.onMessage(onMessage);
    c.onClose(() => {
      if (conn !== c) return;
      conn = null;
      state = "away";
      render();
    });
    flush();
    c.send({ t: "sync" });
  } catch (err) {
    state = err.message === "denied" ? "denied" : "away";
    if (state === "denied") {
      store.set("pairing", null);
      pairing = null;
    }
  } finally {
    trying = false;
    render();
  }
}

function onMessage(msg) {
  if (msg.t === "snapshot" && Array.isArray(msg.todos)) {
    snapshot = { at: msg.at, todos: msg.todos };
    store.set("snapshot", snapshot);
    render();
  } else if (msg.t === "applied" && Array.isArray(msg.results)) {
    // Done (or no longer needed) on the PC: off the queue. One that failed stays and goes again next time.
    const settled = new Set(msg.results.filter((r) => r.ok).map((r) => r.id));
    outbox = outbox.filter((op) => !settled.has(op.id));
    store.set("outbox", outbox);
    render();
  }
}

$("status").onclick = () => {
  if (conn) conn.send({ t: "sync" });
  else tryConnect();
};
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && tryConnect());
addEventListener("online", tryConnect);
setInterval(() => document.visibilityState === "visible" && tryConnect(), 20000);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render();
tryConnect();
