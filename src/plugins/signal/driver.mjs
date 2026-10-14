#!/usr/bin/env node
/**
 * signal-mcp — a stdio MCP server that reads your Signal chats for Zeff from Signal Desktop,
 * deterministically (no LLM). Signal has no web app: Zeff ATTACHES to Signal Desktop over its debug
 * port (SIGNAL_CDP_ENDPOINT, default http://127.0.0.1:9339 — Signal started with
 * --remote-debugging-port=9339; local only). Signal Desktop is linked to your phone — Zeff never links it.
 *
 * This file starts Signal, speaks MCP and shapes the results; everything that knows Signal Desktop's
 * insides (ConversationController, the redux store, the chat loaders) is in adapter.mjs and
 * contract.json (what it expects) — an update of Signal is fixed there. Reading puts the messages
 * into Signal's in-memory store only: no chat is opened, nothing marked read, no read receipt sent.
 * Signal's database itself (SQLCipher) isn't touched — its key isn't extracted.
 *
 * Tools:
 *   signal_status            -> is Signal running, with the debug port, linked and loaded (+ contract drift)
 *   signal_selftest          -> the contract against the live app: what holds, what drifted, what broke
 *   signal_messages {days}   -> the messages of the chats active in the last days — { messages } in
 *                               the mail sync's shape
 *   signal_chats {days}      -> each active chat's last message only (from the chat list)
 *   signal_history {chat}    -> ONE chat's whole history, as far as Signal Desktop has it
 *   signal_send {chat,text}  -> on your click only: the chat opened in Signal (that marks it read),
 *                               the text typed and sent
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withTabLock } from "../../../scripts/chrome-cdp.mjs";
import { serveMcp } from "../../../scripts/automation/mcp-stdio.mjs";
import { report } from "../../../scripts/automation/contract.mjs";
import { attach, composerText, findChat, focusComposer, readChats, readMessages, readState, selfCheck, sentSince } from "./adapter.mjs";

const CDP = (process.env.SIGNAL_CDP_ENDPOINT || "http://127.0.0.1:9339").replace(/\/$/, "");
const PORT = /:(\d+)$/.exec(CDP)?.[1] ?? "9339";
// Windows: Signal's usual install. macOS / Linux: no default - SIGNAL_EXE, or start Signal yourself with the port.
const EXE = process.env.SIGNAL_EXE || (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "Programs", "signal-desktop", "Signal.exe") : "");
const log = (...a) => process.stderr.write(`[signal-mcp] ${a.join(" ")}\n`);
const debug = (...a) => process.env.SIGNAL_DEBUG && log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const NO_PORT_ERROR = `Signal Desktop is running without its debug port — quit Signal once (tray icon → Quit); Zeff then starts it with the port (or set up the autostart on Zeff's Signal page).`;
const NOT_RUNNING = "Signal Desktop isn't running.";
const LINK_ERROR = "Signal Desktop isn't linked (it shows the QR code) — link it with your phone (Signal → Settings → Linked devices), then sync again.";

// ---------------------------------------------------------------------------
// Signal Desktop: running? started with the port
// ---------------------------------------------------------------------------

function signalRunning() {
  try {
    return /Signal\.exe/i.test(execFileSync("tasklist", ["/FI", "IMAGENAME eq Signal.exe", "/NH"], { encoding: "utf8", windowsHide: true }));
  } catch {
    return false;
  }
}

async function portUp() {
  return fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
}

/** Signal reachable over its port — started (in the tray, with the port) when it isn't running and `launch`. */
async function ensureSignal({ launch }) {
  if (await portUp()) return;
  if (signalRunning()) throw new Error(NO_PORT_ERROR);
  if (!launch) throw new Error(NOT_RUNNING);
  if (!EXE) throw new Error(`Signal Desktop isn't running with its debug port. On this system start it yourself with --remote-debugging-port=${PORT} (e.g. signal-desktop --remote-debugging-port=${PORT}), or set SIGNAL_EXE to its program so Zeff can start it.`);
  if (!fs.existsSync(EXE)) throw new Error(`Signal Desktop isn't installed (${EXE}).`);
  log(`starting Signal with --remote-debugging-port=${PORT}`);
  spawn(EXE, ["--start-in-tray", `--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (await portUp()) return;
  }
  throw new Error("Signal Desktop didn't open its debug port within a minute.");
}

// ---------------------------------------------------------------------------
// Signal's window (the adapter does the CDP)
// ---------------------------------------------------------------------------

/** Signal's main window: Signal started first when `launch` and it isn't running. `run(fn, arg)` evaluates in its app (adapter.mjs). */
async function connect({ launch = false } = {}) {
  await ensureSignal({ launch });
  return attach(CDP);
}

/** Signal connected and loaded — its chats there. */
async function ready(opts) {
  const s = await connect(opts);
  try {
    for (let i = 0; i < 120; i++) {
      const state = await s.run(readState).catch(() => "loading");
      if (state === "chats") return s;
      if (state === "link") throw new Error(LINK_ERROR);
      await sleep(1000);
    }
    throw new Error("Signal Desktop didn't finish loading its chats.");
  } catch (e) {
    s.close();
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const toMail = (m) => ({
  id: m.id,
  convId: `sg:${m.chat}`,
  folder: "Signal",
  from: m.from,
  fromEmail: null,
  subject: m.chat,
  preview: m.text,
  receivedAt: new Date(m.t).toISOString(),
  unread: !!m.unread,
  group: !!m.group,
  toMe: !!m.toMe,
});

async function signalMessages({ days = 3, maxLoads = 4, maxMessages = 3000, launch = false } = {}) {
  const span = Math.min(120, Math.max(1, Number(days) || 3));
  const s = await ready({ launch });
  try {
    const got = await s.run(readMessages, { since: Date.now() - span * 864e5, maxLoads: Math.min(20, Math.max(0, Number(maxLoads) || 0)), maxMessages });
    debug(`${got.chats} chats (${got.loaded} loaded), ${got.messages.length} messages`);
    return JSON.stringify({ messages: got.messages.map(toMail) });
  } finally {
    s.close();
  }
}

async function signalChats({ days = 3, launch = false } = {}) {
  const span = Math.min(120, Math.max(1, Number(days) || 3));
  const s = await ready({ launch });
  try {
    const rows = await s.run(readChats, { since: Date.now() - span * 864e5 });
    return JSON.stringify({
      messages: rows.map((c) => ({
        convId: `sg:${c.chat}`,
        folder: "Signal",
        from: c.mine ? "Ich" : c.group ? c.sender || c.chat : c.chat,
        fromEmail: null,
        subject: c.chat,
        preview: c.text,
        receivedAt: new Date(c.at).toISOString(),
        unread: c.unread,
        group: c.group,
      })),
    });
  } finally {
    s.close();
  }
}

async function signalHistory({ chat = "", maxLoads = 400, launch = false } = {}) {
  const name = String(chat).trim();
  if (!name) throw new Error("Which chat? (its name, as in Signal)");
  const s = await ready({ launch });
  try {
    const got = await s.run(readMessages, { since: 0, maxLoads: Math.min(2000, Math.max(1, Number(maxLoads) || 400)), maxMessages: 100000, chat: name });
    if (got.error === "not-found") throw new Error(`There's no Signal chat “${name}”.`);
    if (got.error === "ambiguous") throw new Error(`Several chats match “${name}”: ${got.candidates.join(", ")} — please be exact.`);
    const messages = got.messages.sort((a, b) => a.t - b.t).map((m) => ({ ...toMail(m), unread: false }));
    return JSON.stringify({ chat: got.chat, complete: !!got.complete, messages });
  } finally {
    s.close();
  }
}

// ---------------------------------------------------------------------------
// Sending (on your click only)
// ---------------------------------------------------------------------------

async function key(cdp, k, { shift = false } = {}) {
  const base = { key: k, code: k, windowsVirtualKeyCode: k === "Enter" ? 13 : 0, modifiers: shift ? 8 : 0 };
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(k === "Enter" && !shift ? { text: "\r" } : {}) });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

/**
 * Send a message to a chat — on your click (an Auto-Aktion), never by itself: the chat found by its
 * exact name and opened in Signal (that marks it read, as you'd do), checked that it's that chat,
 * the text typed (line breaks as Shift+Enter) and sent; seen as sent in the chat.
 */
async function signalSend({ chat = "", text = "", dryRun = false } = {}) {
  const name = String(chat).trim();
  const body = String(text).trim();
  if (!name || (!body && !dryRun)) throw new Error("Chat and text are missing.");
  const s = await ready({ launch: true });
  try {
    const found = await s.run(findChat, { name, open: true });
    if (found.error === "not-found") throw new Error(`There's no Signal chat “${name}” (written exactly like that) — nothing sent.`);
    if (found.error === "ambiguous") throw new Error(`Several Signal chats are called “${name}” — nothing sent.`);
    if (found.error === "blocked") throw new Error(`“${name}” is blocked in Signal — nothing sent.`);
    // Until Signal shows that chat (it switches a moment later) and its message field has the focus.
    let focus = "none";
    for (let i = 0; i < 30 && focus !== "ok"; i++) {
      await sleep(300);
      focus = await s.run(focusComposer, { id: found.id });
    }
    if (focus === "other") throw new Error("Another chat is open in Signal — nothing sent.");
    if (focus !== "ok") throw new Error("Signal's message field didn't show — nothing sent.");
    if (dryRun) return JSON.stringify({ chat: found.title, dryRun: true });
    if (await s.run(composerText)) throw new Error(`There's an unsent draft in “${name}” in Signal — nothing sent (send or clear it there first).`);
    const at = Date.now();
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await s.cdp("Input.insertText", { text: lines[i] });
      if (i < lines.length - 1) await key(s.cdp, "Enter", { shift: true });
    }
    await sleep(200);
    await key(s.cdp, "Enter");
    const start = lines.find(Boolean)?.slice(0, 40) ?? "";
    let seen = false;
    for (let i = 0; i < 20 && !seen; i++) {
      await sleep(500);
      seen = await s.run(sentSince, { id: found.id, at: at - 2000, start }).catch(() => false);
    }
    if (!seen && (await s.run(composerText).catch(() => null))) throw new Error("Signal didn't send the message — it's still in the message field there.");
    return JSON.stringify({ chat: found.title, sentAt: Date.now(), seen });
  } finally {
    s.close();
  }
}

// ---------------------------------------------------------------------------
// Status and self-test
// ---------------------------------------------------------------------------

async function signalStatus({ launch = false } = {}) {
  // Started (in the tray, with its port) when it isn't running — on your click ("Sign in").
  if (launch) {
    try {
      await ensureSignal({ launch: true });
    } catch (e) {
      return JSON.stringify({ chrome: false, open: signalRunning(), linked: false, state: "error", message: String(e?.message || e) });
    }
    for (let i = 0; i < 60; i++) {
      const s = await attach(CDP).catch(() => null);
      const state = s ? await s.run(readState).catch(() => "loading") : "loading";
      s?.close();
      if (state !== "loading") break;
      await sleep(1000);
    }
  }
  const running = signalRunning();
  const port = await portUp();
  if (!port) return JSON.stringify({ chrome: false, open: running, linked: false, state: running ? "no-port" : "not-running", message: running ? NO_PORT_ERROR : NOT_RUNNING });
  let s;
  try {
    s = await attach(CDP);
    const state = await s.run(readState).catch(() => "loading");
    const linked = state === "chats";
    // Linked: the contract is looked at too (cheap, read-only) — a drift is told before it breaks a sync.
    let drift = null;
    if (linked) {
      const r = report("signal", await s.run(selfCheck).catch(() => []), s.contract);
      drift = r.ok && !r.drifted ? null : { ok: r.ok, summary: r.summary };
    }
    return JSON.stringify({ chrome: true, open: true, linked, state, ...(drift ? { drift } : {}) });
  } catch (e) {
    return JSON.stringify({ chrome: true, open: true, linked: false, state: "error", message: String(e?.message || e) });
  } finally {
    s?.close();
  }
}

/** The contract against the live app (Signal running with its port, linked): what holds, what drifted, what broke. */
async function signalSelftest({ launch = false } = {}) {
  const s = await ready({ launch });
  try {
    return JSON.stringify(report("signal", await s.run(selfCheck), s.contract));
  } finally {
    s.close();
  }
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

const LAUNCH = { type: "boolean", description: "Start Signal Desktop (in the tray, with its debug port) when it isn't running (default false)." };
const TOOLS = [
  { name: "signal_status", description: "Check whether Signal Desktop runs with its debug port, is linked and has loaded its chats — and whether Signal still matches what the driver expects (drift).", inputSchema: { type: "object", properties: { launch: LAUNCH } } },
  {
    name: "signal_selftest",
    description: "Check the driver's contract against the live Signal Desktop, read-only (globals and their members, the redux state's layout, the shape of the data — types and counts, never content). Returns JSON { ok, drifted, failed, drift, summary, checks }: after an update of Signal Desktop, this says what to fix in contract.json.",
    inputSchema: { type: "object", properties: { launch: LAUNCH } },
  },
  {
    name: "signal_messages",
    description: "Read the messages of the Signal chats active in the last days from Signal Desktop — read-only: no chat opened, nothing marked read. Returns JSON { messages } in the mail sync's shape.",
    inputSchema: { type: "object", properties: { days: { type: "number", description: "How many days back (default 3, at most 120)." }, maxLoads: { type: "number", description: "How often a chat's earlier messages are loaded at most (default 4)." }, launch: LAUNCH } },
  },
  {
    name: "signal_chats",
    description: "Read each Signal chat's last message (the chat list) for the chats active in the last days — read-only. Returns JSON { messages }.",
    inputSchema: { type: "object", properties: { days: { type: "number", description: "How many days back (default 3, at most 120)." }, launch: LAUNCH } },
  },
  {
    name: "signal_history",
    description: "ONE Signal chat's whole history as far as Signal Desktop has it, read-only — the chat not opened. Returns JSON { chat, complete, messages } in the mail sync's shape.",
    inputSchema: { type: "object", properties: { chat: { type: "string", description: "The chat's name as Signal shows it (exactly, else regardless of case, else the one name containing it)." }, maxLoads: { type: "number", description: "At most this many loads of earlier messages (default 400)." }, launch: LAUNCH }, required: ["chat"] },
  },
  {
    name: "signal_send",
    description: "Send a message to a Signal chat (found by its exact name) through Signal Desktop — only on the user's click. Opens the chat (marks it read), types and sends. Returns JSON { chat, sentAt, seen }.",
    inputSchema: { type: "object", properties: { chat: { type: "string", description: "The chat's exact name." }, text: { type: "string", description: "The message." } }, required: ["chat", "text"] },
  },
];

const locked = (tool, fn) => (args) => withTabLock("Signal", tool, () => fn(args), debug);

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  serveMcp({
    name: "signal",
    tools: TOOLS,
    log,
    handlers: {
      signal_status: (args) => signalStatus(args),
      signal_selftest: locked("signal_selftest", signalSelftest),
      signal_messages: locked("signal_messages", signalMessages),
      signal_chats: locked("signal_chats", signalChats),
      signal_history: locked("signal_history", signalHistory),
      signal_send: locked("signal_send", signalSend),
    },
  });
  log(`ready (CDP ${CDP})`);
}
