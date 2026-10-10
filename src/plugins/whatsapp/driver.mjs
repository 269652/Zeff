#!/usr/bin/env node
/**
 * whatsapp-mcp — a stdio MCP server that reads your WhatsApp chats for Zeff with Playwright,
 * deterministically (no LLM) and read-only. It ATTACHES to the automation Chrome (the account's —
 * WHATSAPP_CDP_ENDPOINT, else ROAR_CDP_ENDPOINT, default http://127.0.0.1:9222), where WhatsApp Web
 * is linked to your phone — Zeff never links it (that's your QR scan).
 *
 * The messages of the active chats are read from what WhatsApp Web has decrypted for display
 * (whatsapp_messages); where it doesn't offer that, the CHAT LIST — each chat's last message
 * (whatsapp_chats). No chat is ever opened: opening one in WhatsApp Web marks its messages read
 * (blue ticks to the sender), so Zeff doesn't.
 *
 * Tools:
 *   whatsapp_status          -> is Chrome reachable, is WhatsApp Web open and linked
 *   whatsapp_chats {days}    -> the chats with a message in the last days, newest first (the list
 *                               scrolled through) — { messages } in the mail sync's shape
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectToChrome, ChromeConnectError, withTabLock } from "../../../scripts/chrome-cdp.mjs";

const CDP = process.env.WHATSAPP_CDP_ENDPOINT || process.env.ROAR_CDP_ENDPOINT || "http://127.0.0.1:9222";
const log = (...a) => process.stderr.write(`[whatsapp-mcp] ${a.join(" ")}\n`);
const debug = (...a) => process.env.WHATSAPP_DEBUG && log(...a);

const HOME = "https://web.whatsapp.com/";
const isWhatsapp = (u) => /^https:\/\/web\.whatsapp\.com\//i.test(u);
const LINK_ERROR = "WhatsApp Web isn't linked in the automation Chrome (it shows the QR code) — sign in: link it there with your phone (WhatsApp → Verknüpfte Geräte), then sync again.";

// ---------------------------------------------------------------------------
// When: the list's time column — "15:45", "3:45 PM", "Gestern", "Freitag", "09.10.2026", "10/9/26"
// ---------------------------------------------------------------------------

const WEEKDAYS = { sonntag: 0, sunday: 0, montag: 1, monday: 1, dienstag: 2, tuesday: 2, mittwoch: 3, wednesday: 3, donnerstag: 4, thursday: 4, freitag: 5, friday: 5, samstag: 6, saturday: 6 };

export function parseWhen(text, now = new Date(), lang = "de") {
  const t = String(text || "").replace(/ | /g, " ").trim();
  const at = (d, h = 12, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString();
  let m = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(t);
  if (m) {
    let h = +m[1];
    if (m[3]) h = (h % 12) + (/pm/i.test(m[3]) ? 12 : 0);
    return at(now, h, +m[2]);
  }
  if (/^(heute|today)$/i.test(t)) return at(now);
  if (/^(gestern|yesterday)$/i.test(t)) return at(new Date(now.getTime() - 864e5));
  const wd = WEEKDAYS[t.toLowerCase()];
  if (wd !== undefined) {
    const back = (now.getDay() - wd + 7) % 7 || 7;
    return at(new Date(now.getTime() - back * 864e5));
  }
  m = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/.exec(t);
  if (m) {
    let [a, b, c] = [+m[1], +m[2], +m[3]];
    let y, mo, d;
    if (a > 999) [y, mo, d] = [a, b, c]; // 2026-10-09
    // 10/9/26 (US) or 09.10.2026 / 9/10/2026 (elsewhere): a number over 12 settles it, else the language.
    else if (b > 12 || (a <= 12 && t.includes("/") && /^en(-us)?$/i.test(lang))) [mo, d, y] = [a, b, c];
    else [d, mo, y] = [a, b, c];
    if (y < 100) y += 2000;
    // Not in the future: the other way round, then.
    if (new Date(y, mo - 1, d) > now && d <= 12) [mo, d] = [d, mo];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return at(new Date(y, mo - 1, d));
  }
  return null;
}

// ---------------------------------------------------------------------------
// The chat list
// ---------------------------------------------------------------------------

/** Runs IN the WhatsApp tab: the chat rows rendered now (the list is virtual — only those near the view). */
function readRows() {
  const pane = document.querySelector("#pane-side");
  if (!pane) return { ready: false, rows: [], lang: document.documentElement.lang || "" };
  const WHEN = /^(\d{1,2}:\d{2}(\s?[AP]M)?|heute|today|gestern|yesterday|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,4}[./-]\d{1,2}[./-]\d{1,4})$/i;
  const items = [...pane.querySelectorAll('[role="listitem"], [role="row"]')].filter((r) => !r.parentElement?.closest('[role="listitem"], [role="row"]'));
  const rows = items.map((r) => {
    const titles = [...r.querySelectorAll("span[title]")].map((s) => s.getAttribute("title")?.trim() || "").filter(Boolean);
    const lines = (r.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const name = titles[0] || lines[0] || "";
    const when = lines.find((l) => WHEN.test(l.replace(/ | /g, " "))) || "";
    const unreadLabel = [...r.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label") || "").find((l) => /ungelesen|unread/i.test(l)) || "";
    const unreadCount = +(/(\d+)/.exec(unreadLabel)?.[1] || 0);
    // The last message: the list shows it in one line (a group's with "Anna: " before it); its tooltip has it in full.
    const line = lines.find((l) => l !== name && l !== when && !/^\d+$/.test(l) && !/(ungelesen|unread)/i.test(l)) || "";
    const full = titles.slice(1).sort((a, b) => b.length - a.length)[0] || "";
    const prefix = /^([^:\n]{1,40}):\s/.exec(line)?.[1] || "";
    const text = full && full.length >= line.length - prefix.length - 2 ? full : prefix ? line.slice(prefix.length + 1).trim() : line;
    // Yours: the ticks (sent, delivered, read) before it.
    const mine = !!r.querySelector('[data-icon*="check"], [data-icon^="status-"], [data-icon*="msg-time"]');
    return { name, when, text, sender: prefix && !full.startsWith(`${prefix}:`) ? prefix : "", mine, unread: unreadCount > 0 || !!unreadLabel, unreadCount };
  });
  return { ready: true, rows, lang: document.documentElement.lang || "", scrollTop: pane.scrollTop, scrollMax: pane.scrollHeight - pane.clientHeight };
}

/** Runs IN the tab: what WhatsApp Web shows instead of the chats — the QR code (not linked), "open in another window", loading. */
function readState() {
  const text = (document.body?.innerText || "").slice(0, 4000);
  if (document.querySelector("#pane-side")) return "chats";
  if (document.querySelector('canvas[aria-label*="QR" i], [data-ref] canvas, [data-testid="qrcode"]') || /scanne den QR|scan the QR|mit telefonnummer|log in with phone|steps to log in|whatsapp auf deinem computer|use whatsapp on your computer/i.test(text)) return "link";
  if (/in einem anderen fenster|open in another window|hier verwenden|use here/i.test(text)) return "elsewhere";
  return "loading";
}

async function whatsappPage(browser, { openIfMissing }) {
  const context = browser.contexts()[0];
  if (!context) throw new ChromeConnectError("The automation Chrome has no window open.");
  let page = context.pages().find((p) => isWhatsapp(p.url()));
  if (!page) {
    if (!openIfMissing) throw new Error(`WhatsApp Web isn't open in the automation Chrome — open ${HOME} there (or press Sync on Zeff's WhatsApp page).`);
    page = await context.newPage();
    await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => debug(`opening WhatsApp: ${e}`));
  }
  // Until the chats show (a fresh tab loads its store first — up to a minute or two).
  for (let i = 0; i < 120; i++) {
    const s = await page.evaluate(readState).catch(() => "loading");
    if (s === "chats") return page;
    if (s === "link") throw new Error(LINK_ERROR);
    if (s === "elsewhere") throw new Error("WhatsApp Web is open in another window — Zeff doesn't take it over; use it there or press „Hier verwenden“ in the automation Chrome yourself, then sync again.");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("WhatsApp Web's chat list didn't show (still loading?).");
}

async function whatsappChats({ days = 3, maxChats = 150, openIfMissing = false, launch = openIfMissing } = {}) {
  const since = Date.now() - Math.min(120, Math.max(1, Number(days) || 3)) * 864e5;
  const cap = Math.min(500, Math.max(1, Number(maxChats) || 150));
  const browser = await connectToChrome(CDP, { launchUrls: launch ? [HOME] : [] });
  try {
    const page = await whatsappPage(browser, { openIfMissing: !!openIfMissing });
    const pane = page.locator("#pane-side");
    const start = await pane.evaluate((el) => el.scrollTop).catch(() => 0);
    await pane.evaluate((el) => (el.scrollTop = 0)).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    const chats = new Map();
    let older = 0;
    for (let pass = 0; pass < 60 && chats.size < cap; pass++) {
      const got = await page.evaluate(readRows);
      if (!got.ready) throw new Error("WhatsApp Web's chat list is gone (signed out?).");
      for (const r of got.rows) {
        if (!r.name || chats.has(r.name) || /^(archiviert|archived)$/i.test(r.name)) continue;
        const at = parseWhen(r.when, new Date(), got.lang);
        chats.set(r.name, { ...r, at });
        // Pinned chats come first, whatever their age: only the unpinned ones (newest first) end the list.
        if (at && Date.parse(at) < since) older++;
      }
      debug(`pass ${pass}: ${got.rows.length} rows, ${chats.size} chats, ${older} older`);
      if (older >= 5 || got.scrollTop >= got.scrollMax - 2) break;
      await pane.evaluate((el) => (el.scrollTop += el.clientHeight * 0.8));
      await new Promise((r) => setTimeout(r, 500));
    }
    // Back to where the list was.
    await pane.evaluate((el, top) => (el.scrollTop = top), start).catch(() => {});
    const messages = [...chats.values()]
      .filter((c) => c.text && (!c.at || Date.parse(c.at) >= since))
      .map((c) => ({
        convId: `wa:${c.name}`,
        folder: "WhatsApp",
        from: c.mine ? "Ich" : c.sender || c.name,
        fromEmail: null,
        subject: c.name,
        preview: c.text,
        receivedAt: c.at,
        unread: c.unread,
      }));
    return JSON.stringify({ messages });
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Runs IN the WhatsApp tab: the messages of the chats active since `since` (seconds) — from what
 * WhatsApp Web has decrypted for display (its own collections), earlier ones loaded from its local
 * store as needed (loadEarlierMsgs — what scrolling up in a chat would load). No chat is opened or
 * marked seen: read receipts go only when you open a chat.
 */
async function readMessages({ since, maxLoads, maxMessages }) {
  const req = window.require;
  if (typeof req !== "function") return { error: "no-internals" };
  let C, load;
  try {
    C = req("WAWebCollections");
    load = req("WAWebChatLoadMessages");
  } catch {
    return { error: "no-internals" };
  }
  if (!C?.Chat?.getModelsArray) return { error: "no-internals" };
  const MEDIA = { image: "Bild", video: "Video", ptt: "Sprachnachricht", audio: "Audio", document: "Dokument", location: "Standort", vcard: "Kontakt", multi_vcard: "Kontakte", poll_creation: "Umfrage", album: "Album" };
  const nameOf = (c) => c?.formattedName || c?.name || c?.pushname || c?.verifiedName || c?.id?.user || "";
  const lastAt = (c) => Math.max(c.t || 0, ...(c.msgs?.getModelsArray?.() ?? []).map((m) => m.t || 0));
  const chats = C.Chat.getModelsArray().filter((c) => lastAt(c) >= since && !c.archive && !/@(newsletter|broadcast)$/.test(c.id?._serialized ?? "") && c.id?.user !== "status");
  const out = [];
  const seen = new Set();
  for (const chat of chats) {
    const msgs = () => chat.msgs?.getModelsArray?.() ?? [];
    // Nothing loaded of it yet: its latest messages first (what the list's preview comes from).
    if (!msgs().length && load.loadRecentMsgs) {
      try {
        await load.loadRecentMsgs({ chat, msgs: chat.msgs });
      } catch {
        // as it is
      }
    }
    // Earlier ones, from WhatsApp's own store, until the window is covered (a few times at most).
    for (let i = 0; i < maxLoads && msgs().length && msgs()[0].t >= since; i++) {
      const before = msgs().length;
      try {
        // ({ chat, msgs }): the shape it takes now — the chat alone, as it took it before.
        await load.loadEarlierMsgs({ chat, msgs: chat.msgs }).catch(() => load.loadEarlierMsgs(chat));
      } catch {
        break;
      }
      if (msgs().length === before) break;
    }
    const title = chat.formattedTitle || chat.name || nameOf(chat.contact) || chat.id?.user || "?";
    const group = !!chat.isGroup || /@g\.us$/.test(chat.id?._serialized ?? "");
    for (const m of msgs()) {
      const id = m.id?._serialized ?? `${chat.id?._serialized}|${m.t}`;
      if (m.t < since || m.isNotification || m.revokeTimestamp || seen.has(id)) continue;
      seen.add(id);
      const media = MEDIA[m.type];
      const text = m.type === "chat" ? m.body : media ? `[${media}]${m.caption ? ` ${m.caption}` : m.type === "poll_creation" && m.pollName ? ` ${m.pollName}` : ""}` : "";
      if (!text?.trim()) continue;
      const fromMe = !!m.id?.fromMe;
      out.push({
        id,
        chat: title,
        from: fromMe ? "Ich" : group ? nameOf(m.senderObj) || m.notifyName || "?" : title,
        t: m.t,
        text: text.slice(0, 2000),
        unread: !fromMe && chat.unreadCount > 0 && msgs().indexOf(m) >= msgs().length - chat.unreadCount,
      });
    }
  }
  out.sort((a, b) => b.t - a.t);
  return { messages: out.slice(0, maxMessages), chats: chats.length };
}

async function whatsappMessages({ days = 3, maxLoads = 4, maxMessages = 3000, openIfMissing = false, launch = openIfMissing } = {}) {
  const span = Math.min(120, Math.max(1, Number(days) || 3));
  const browser = await connectToChrome(CDP, { launchUrls: launch ? [HOME] : [] });
  try {
    const page = await whatsappPage(browser, { openIfMissing: !!openIfMissing });
    const got = await page.evaluate(readMessages, { since: Math.floor(Date.now() / 1000) - span * 86400, maxLoads: Math.min(10, Math.max(0, Number(maxLoads) || 0)), maxMessages });
    if (got.error) return JSON.stringify({ error: got.error });
    debug(`${got.chats} chats, ${got.messages.length} messages`);
    return JSON.stringify({
      messages: got.messages.map((m) => ({
        id: m.id,
        convId: `wa:${m.chat}`,
        folder: "WhatsApp",
        from: m.from,
        fromEmail: null,
        subject: m.chat,
        preview: m.text,
        receivedAt: new Date(m.t * 1000).toISOString(),
        unread: m.unread,
      })),
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function whatsappStatus() {
  let browser;
  try {
    browser = await connectToChrome(CDP, {});
  } catch (e) {
    return JSON.stringify({ chrome: false, linked: false, message: String(e?.message || e) });
  }
  try {
    const page = (browser.contexts()[0]?.pages() ?? []).find((p) => isWhatsapp(p.url()));
    const state = page ? await page.evaluate(readState).catch(() => "loading") : null;
    return JSON.stringify({ chrome: true, open: !!page, linked: state === "chats", state });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio server (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

const TOOLS = [
  { name: "whatsapp_status", description: "Check whether Chrome (with the debug port) is reachable and WhatsApp Web is open and linked.", inputSchema: { type: "object", properties: {} } },
  {
    name: "whatsapp_chats",
    description: "Read the chats with a message in the last days from WhatsApp Web's chat list — read-only: each chat's name and last message (sender, text, time, unread); opens no chat, so nothing is marked read. Returns JSON { messages }.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back (default 3, at most 120)." },
        maxChats: { type: "number", description: "At most this many chats (default 150)." },
        openIfMissing: { type: "boolean", description: "Open WhatsApp Web in the automation Chrome when it isn't (default false)." },
        launch: { type: "boolean", description: "Start the automation Chrome when it isn't running (default: as openIfMissing)." },
      },
    },
  },
  {
    name: "whatsapp_messages",
    description: "Read the messages of the chats active in the last days from WhatsApp Web — read-only: what it has decrypted for display, earlier ones loaded from its local store; no chat opened, nothing marked read. Returns JSON { messages } — or { error: \"no-internals\" } when WhatsApp Web doesn't offer that (use whatsapp_chats then).",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back (default 3, at most 120)." },
        maxLoads: { type: "number", description: "How often a chat's earlier messages are loaded at most (default 4)." },
        openIfMissing: { type: "boolean", description: "Open WhatsApp Web in the automation Chrome when it isn't (default false)." },
        launch: { type: "boolean", description: "Start the automation Chrome when it isn't running (default: as openIfMissing)." },
      },
    },
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
  if (method === "initialize") return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "whatsapp", version: "0.1.0" } });
  if (method === "notifications/initialized") return;
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      if (name === "whatsapp_status") return ok(id, textResult(await whatsappStatus()));
      if (name === "whatsapp_chats") return ok(id, textResult(await withTabLock("WhatsApp", name, () => whatsappChats(args), debug)));
      if (name === "whatsapp_messages") return ok(id, textResult(await withTabLock("WhatsApp", name, () => whatsappMessages(args), debug)));
      return ok(id, textResult(`Unknown tool "${name}".`, true));
    } catch (e) {
      log("tool error:", String(e));
      return ok(id, textResult(`Error: ${String(e?.message || e).slice(0, 300)}`, true));
    }
  }
  if (id !== undefined) ok(id, {});
}

// Imported (for a test of parseWhen): no server.
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
