#!/usr/bin/env node
/**
 * signal-mcp — a stdio MCP server that reads your Signal chats for Zeff from Signal Desktop,
 * deterministically (no LLM). Signal has no web app: Zeff ATTACHES to Signal Desktop over its debug
 * port (SIGNAL_CDP_ENDPOINT, default http://127.0.0.1:9339 — Signal started with
 * --remote-debugging-port=9339; local only). Signal Desktop is linked to your phone — Zeff never links it.
 *
 * Signal's app runs in its window's isolated (preload) world: its ConversationController (every
 * chat, its last message, unread count) and each chat's own loaders (loadNewestMessages,
 * loadOlderMessages — what scrolling a chat would load from Signal's local database). Reading puts
 * the messages into Signal's in-memory store only: no chat is opened, nothing marked read, no read
 * receipt sent. Signal's database itself (SQLCipher) isn't touched — its key isn't extracted.
 *
 * Tools:
 *   signal_status            -> is Signal running, with the debug port, linked and loaded
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

const CDP = (process.env.SIGNAL_CDP_ENDPOINT || "http://127.0.0.1:9339").replace(/\/$/, "");
const PORT = /:(\d+)$/.exec(CDP)?.[1] ?? "9339";
const EXE = process.env.SIGNAL_EXE || path.join(process.env.LOCALAPPDATA || "", "Programs", "signal-desktop", "Signal.exe");
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
// CDP: Signal's window, its isolated world
// ---------------------------------------------------------------------------

/** Signal's main window over CDP: `run(fn, arg)` evaluates fn(arg) in its isolated world; `cdp` sends raw commands. */
async function connect({ launch = false } = {}) {
  await ensureSignal({ launch });
  const list = await (await fetch(`${CDP}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const target = list.find((t) => t.type === "page" && /background\.html/.test(t.url)) || list.find((t) => t.type === "page" && /signal-desktop/i.test(t.url));
  if (!target?.webSocketDebuggerUrl) throw new Error("Signal Desktop's window isn't there (still starting?).");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("Signal Desktop's debug port didn't accept the connection."));
  });
  let id = 0;
  const pending = new Map();
  const contexts = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === "Runtime.executionContextCreated") contexts.push(m.params.context);
    else if (m.method === "Runtime.executionContextDestroyed") {
      const i = contexts.findIndex((c) => c.id === m.params.executionContextId);
      if (i >= 0) contexts.splice(i, 1);
    }
  };
  ws.onclose = () => {
    for (const r of pending.values()) r({ error: { message: "Signal Desktop closed the connection." } });
    pending.clear();
  };
  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await cdp("Runtime.enable");
  const isolated = async () => {
    for (let i = 0; i < 60; i++) {
      const c = contexts.find((x) => x.auxData?.type === "isolated" && /Electron Isolated/i.test(x.name)) || contexts.find((x) => x.auxData?.type === "isolated");
      if (c) return c.id;
      await sleep(250);
    }
    throw new Error("Signal Desktop's app context isn't there (still starting?).");
  };
  const run = async (fn, arg) => {
    const r = await cdp("Runtime.evaluate", { expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`, contextId: await isolated(), awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`Signal: ${r.exceptionDetails.exception?.description?.split("\n")[0] || r.exceptionDetails.text}`);
    return r.result?.value;
  };
  return { run, cdp, close: () => ws.close() };
}

/** Runs IN Signal: its state — loaded (the inbox), linked (an account), still starting. */
function readState() {
  const s = window.reduxStore?.getState?.();
  if (!s || !window.ConversationController) return "loading";
  if (s.app?.appView === "Installer" || s.app?.appView === "Standalone") return "link";
  if (s.app?.appView !== "Inbox" || !s.app?.hasInitialLoadCompleted) return "loading";
  return window.ConversationController.getOurConversationId?.() ? "chats" : "link";
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
// Reading (runs IN Signal's isolated world)
// ---------------------------------------------------------------------------

/**
 * Runs IN Signal: the messages of the chats active since `since` (ms) — each chat's newest messages
 * loaded into Signal's memory if they aren't yet, earlier ones as needed (what scrolling up would
 * load). The chat you have open isn't touched (its view would jump): what it shows is read as is.
 * No chat opened, nothing marked read.
 */
async function readMessages({ since, maxLoads, maxMessages, chat = null }) {
  const CC = window.ConversationController;
  const store = () => window.reduxStore.getState().conversations;
  const ourId = CC.getOurConversationId();
  const ourAci = CC.get(ourId)?.get("serviceId");
  // The chat open in Signal (Signal 8: in its navigation state; older: in conversations).
  const st = window.reduxStore.getState();
  const selected = st.nav?.selectedLocation?.details?.conversationId ?? st.conversations.selectedConversationId;
  const titleOf = (c) => c?.getTitle?.() || c?.get?.("name") || c?.get?.("profileName") || "?";
  const lastAt = (c) => Math.max(c.get("active_at") || 0, c.get("timestamp") || 0);
  let convs;
  if (chat) {
    const all = CC.getAll().filter((c) => c.id !== ourId && ["private", "group"].includes(c.get("type")));
    const want = String(chat).trim();
    let found = all.filter((c) => titleOf(c) === want);
    if (!found.length) found = all.filter((c) => titleOf(c).toLowerCase() === want.toLowerCase());
    if (!found.length) found = all.filter((c) => titleOf(c).toLowerCase().includes(want.toLowerCase()));
    if (found.length !== 1) return { error: found.length ? "ambiguous" : "not-found", candidates: found.slice(0, 12).map(titleOf) };
    convs = found;
  } else {
    convs = CC.getAll().filter((c) => c.id !== ourId && ["private", "group"].includes(c.get("type")) && !c.get("isArchived") && !c.isBlocked?.() && lastAt(c) >= since);
  }
  const ids = (c) => store().messagesByConversation[c.id]?.messageIds ?? [];
  const msgOf = (id) => store().messagesLookup[id];
  const MEDIA = (a) => {
    const t = String(a?.contentType || "");
    if (a?.flags & 1 || /audio\/(aac|ogg)/.test(t)) return "Sprachnachricht";
    if (t.startsWith("image/gif")) return "GIF";
    if (t.startsWith("image/")) return "Bild";
    if (t.startsWith("video/")) return "Video";
    if (t.startsWith("audio/")) return "Audio";
    return "Dokument";
  };
  const out = [];
  const seen = new Set();
  let loaded = 0;
  // A chat with unread messages loads around the first unread one — without waiting for it: until
  // its messages are there (Signal says it's done loading).
  const settled = async (c) => {
    for (let i = 0; i < 50; i++) {
      const s = store().messagesByConversation[c.id];
      if (s?.messageIds?.length && !s.messageLoadingState) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  for (const c of convs) {
    if (c.id !== selected) {
      if (!ids(c).length) {
        try {
          await c.loadNewestMessages(undefined, undefined);
          await settled(c);
          loaded++;
        } catch {
          // as it is
        }
      }
      // Earlier ones until the window is covered (a chat's whole history: until no more come).
      for (let i = 0; i < maxLoads && ids(c).length; i++) {
        const oldest = msgOf(ids(c)[0]);
        if (!oldest || (oldest.sent_at || 0) < since) break;
        const before = ids(c).length;
        try {
          await c.loadOlderMessages(oldest.id);
        } catch {
          break;
        }
        if (ids(c).length === before) break;
      }
    }
    const title = titleOf(c);
    const group = c.get("type") === "group";
    const unreadCount = c.get("unreadCount") || 0;
    const list = ids(c).map(msgOf).filter(Boolean);
    list.forEach((m, i) => {
      if (m.type !== "incoming" && m.type !== "outgoing") return;
      if ((m.sent_at || 0) < since || m.isErased || m.deletedForEveryone || m.storyId || seen.has(m.id)) return;
      seen.add(m.id);
      const media = m.sticker ? "Sticker" : m.attachments?.length ? MEDIA(m.attachments[0]) : m.poll ? "Umfrage" : null;
      const body = (m.body || "").trim();
      const text = media ? `[${media}]${body ? ` ${body}` : m.poll?.question ? ` ${m.poll.question}` : ""}` : body;
      if (!text) return;
      const fromMe = m.type === "outgoing";
      const sender = fromMe ? null : CC.get(m.sourceServiceId) || CC.get(m.source);
      out.push({
        id: m.id,
        chat: title,
        from: fromMe ? "Ich" : group ? titleOf(sender) : title,
        t: m.sent_at,
        text: text.slice(0, 4000),
        unread: !fromMe && (m.readStatus === 1 || (unreadCount > 0 && i >= list.length - unreadCount)),
        group,
        toMe: group && !fromMe && (!!m.mentionsMe || (!!ourAci && m.quote?.authorAci === ourAci)),
      });
    });
  }
  out.sort((a, b) => b.t - a.t);
  // One chat: from its beginning when its oldest message (Signal's metrics) is loaded.
  const oldest = chat ? store().messagesByConversation[convs[0].id]?.metrics?.oldest : null;
  const complete = chat ? !!oldest && ids(convs[0])[0] === oldest.id : undefined;
  return { messages: out.slice(0, maxMessages), chats: convs.length, loaded, chat: chat ? titleOf(convs[0]) : undefined, complete };
}

/** Runs IN Signal: each active chat's last message, from what its chat list shows. */
function readChats({ since }) {
  const CC = window.ConversationController;
  const ourId = CC.getOurConversationId();
  return CC.getAll()
    .filter((c) => c.id !== ourId && ["private", "group"].includes(c.get("type")) && !c.get("isArchived") && !c.isBlocked?.() && (c.get("timestamp") || c.get("active_at") || 0) >= since && c.get("lastMessage"))
    .map((c) => ({
      chat: c.getTitle(),
      group: c.get("type") === "group",
      at: c.get("timestamp") || c.get("active_at"),
      text: String(c.get("lastMessage") || "").slice(0, 2000),
      // Only your own messages have a status (sent, delivered, read).
      mine: c.get("lastMessageStatus") != null,
      sender: c.get("lastMessageAuthor") || "",
      unread: (c.get("unreadCount") || 0) > 0,
    }));
}

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

/** Runs IN Signal: the chat with exactly this name (else why not) — opened when `open`. "Notiz an mich" / "Note to Self": yours. */
function findChat({ name, open }) {
  const CC = window.ConversationController;
  const ourId = CC.getOurConversationId();
  const found = /^(notiz an mich|note to self)$/i.test(name) ? [CC.get(ourId)].filter(Boolean) : CC.getAll().filter((c) => c.id !== ourId && ["private", "group"].includes(c.get("type")) && c.getTitle() === name);
  if (found.length !== 1) return { error: found.length ? "ambiguous" : "not-found" };
  const c = found[0];
  if (c.isBlocked?.()) return { error: "blocked" };
  if (open) window.reduxActions.conversations.showConversation({ conversationId: c.id });
  return { id: c.id, title: c.id === ourId ? name : c.getTitle() };
}

/** Runs IN Signal: the open chat's composer focused — if it's that chat. */
function focusComposer({ id }) {
  const st = window.reduxStore.getState();
  if ((st.nav?.selectedLocation?.details?.conversationId ?? st.conversations.selectedConversationId) !== id) return "other";
  const el = document.querySelector(".module-composition-input__input .ql-editor");
  if (!el) return "none";
  el.focus();
  return document.activeElement === el ? "ok" : "unfocused";
}

/** Runs IN Signal: the composer's text now. */
function composerText() {
  return document.querySelector(".module-composition-input__input .ql-editor")?.innerText?.trim() ?? null;
}

/** Runs IN Signal: whether that chat's newest outgoing message since `at` starts with `start`. */
function sentSince({ id, at, start }) {
  const s = window.reduxStore.getState().conversations;
  const ids = s.messagesByConversation[id]?.messageIds ?? [];
  return ids.map((i) => s.messagesLookup[i]).some((m) => m?.type === "outgoing" && (m.sent_at || 0) >= at && String(m.body || "").startsWith(start));
}

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

async function signalStatus({ launch = false } = {}) {
  // Started (in the tray, with its port) when it isn't running — on your click ("Sign in").
  if (launch) {
    try {
      await ensureSignal({ launch: true });
    } catch (e) {
      return JSON.stringify({ chrome: false, open: signalRunning(), linked: false, state: "error", message: String(e?.message || e) });
    }
    for (let i = 0; i < 60; i++) {
      const s = await connect({}).catch(() => null);
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
    s = await connect({});
    const state = await s.run(readState).catch(() => "loading");
    return JSON.stringify({ chrome: true, open: true, linked: state === "chats", state });
  } catch (e) {
    return JSON.stringify({ chrome: true, open: true, linked: false, state: "error", message: String(e?.message || e) });
  } finally {
    s?.close();
  }
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio server (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

const LAUNCH = { type: "boolean", description: "Start Signal Desktop (in the tray, with its debug port) when it isn't running (default false)." };
const TOOLS = [
  { name: "signal_status", description: "Check whether Signal Desktop runs with its debug port, is linked and has loaded its chats.", inputSchema: { type: "object", properties: { launch: LAUNCH } } },
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

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function ok(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "signal", version: "0.1.0" } });
  if (method === "notifications/initialized") return;
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      if (name === "signal_status") return ok(id, textResult(await signalStatus(args)));
      if (name === "signal_messages") return ok(id, textResult(await withTabLock("Signal", name, () => signalMessages(args), debug)));
      if (name === "signal_chats") return ok(id, textResult(await withTabLock("Signal", name, () => signalChats(args), debug)));
      if (name === "signal_history") return ok(id, textResult(await withTabLock("Signal", name, () => signalHistory(args), debug)));
      if (name === "signal_send") return ok(id, textResult(await withTabLock("Signal", name, () => signalSend(args), debug)));
      return ok(id, textResult(`Unknown tool "${name}".`, true));
    } catch (e) {
      log("tool error:", String(e));
      return ok(id, textResult(`Error: ${String(e?.message || e).slice(0, 300)}`, true));
    }
  }
  if (id !== undefined) ok(id, {});
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  let buf = "";
  process.stdin.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      Promise.resolve(handle(msg)).catch((e) => log("handler error:", String(e)));
    }
  });
  process.stdin.on("end", () => process.exit(0));
  log(`ready (CDP ${CDP})`);
}
