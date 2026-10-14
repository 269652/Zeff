#!/usr/bin/env node
/**
 * whatsapp-mcp — a stdio MCP server that reads your WhatsApp chats for Zeff with Playwright,
 * deterministically (no LLM) and read-only. It ATTACHES to the automation Chrome (the account's —
 * WHATSAPP_CDP_ENDPOINT, else CHRONO_CDP_ENDPOINT, default http://127.0.0.1:9222), where WhatsApp Web
 * is linked to your phone — Zeff never links it (that's your QR scan).
 *
 * The messages of the active chats are read from what WhatsApp Web has decrypted for display
 * (whatsapp_messages); where it doesn't offer that, the CHAT LIST — each chat's last message
 * (whatsapp_chats). No chat is ever opened: opening one in WhatsApp Web marks its messages read
 * (blue ticks to the sender), so Zeff doesn't.
 *
 * This file speaks MCP and shapes the results; everything that knows WhatsApp Web's insides is in
 * adapter.mjs and contract.json (what it expects: module names, selectors, words) — an update of
 * WhatsApp Web is fixed there. `whatsapp_selftest` says what no longer holds.
 *
 * Tools:
 *   whatsapp_status          -> is Chrome reachable, is WhatsApp Web open and linked (+ contract drift)
 *   whatsapp_selftest        -> the contract against the live tab: what holds, what drifted, what broke
 *   whatsapp_chats {days}    -> the chats with a message in the last days, newest first (the list
 *                               scrolled through) — { messages } in the mail sync's shape
 *   whatsapp_history {chat}  -> ONE chat's whole history: its earlier messages loaded from WhatsApp's
 *                               store until there are none — the chat not opened. With fromPhone the
 *                               chat IS opened (its unread messages then count as read) and scrolled
 *                               up, "older messages from your phone" fetched again and again first.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectToChrome, ChromeConnectError, withTabLock } from "../../../scripts/chrome-cdp.mjs";
import { serveMcp } from "../../../scripts/automation/mcp-stdio.mjs";
import { report } from "../../../scripts/automation/contract.mjs";
import { contract as loadContract, css, inPage, parseWhen, readRows, readState, readHeader, readMessages, readHistory, scrollChatTop, sentSeen, selfCheck } from "./adapter.mjs";

export { parseWhen };

const CDP = process.env.WHATSAPP_CDP_ENDPOINT || process.env.CHRONO_CDP_ENDPOINT || "http://127.0.0.1:9222";
const log = (...a) => process.stderr.write(`[whatsapp-mcp] ${a.join(" ")}\n`);
const debug = (...a) => process.env.WHATSAPP_DEBUG && log(...a);

const HOME = "https://web.whatsapp.com/";
const isWhatsapp = (u) => /^https:\/\/web\.whatsapp\.com\//i.test(u);
const LINK_ERROR = "WhatsApp Web isn't linked in the automation Chrome (it shows the QR code) — sign in: link it there with your phone (WhatsApp → Verknüpfte Geräte), then sync again.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quote = (name) => name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** "No internals" with the contract's words: which part of WhatsApp Web's insides wasn't found. */
const noInternals = (got) => JSON.stringify({ error: got.error, missing: got.missing, hint: "WhatsApp Web changed: run whatsapp_selftest, then update src/plugins/whatsapp/contract.json (or data/automation/whatsapp.json)." });

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

async function whatsappPage(browser, C, { openIfMissing }) {
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
    const s = await inPage(page, readState, { contract: C }).catch(() => "loading");
    if (s === "chats") return page;
    if (s === "link") throw new Error(LINK_ERROR);
    if (s === "elsewhere") throw new Error("WhatsApp Web is open in another window — Zeff doesn't take it over; use it there or press „Hier verwenden“ in the automation Chrome yourself, then sync again.");
    await sleep(1000);
  }
  throw new Error("WhatsApp Web's chat list didn't show (still loading?).");
}

const toMail = (m, { unread = m.unread, extra = false } = {}) => ({
  id: m.id,
  convId: `wa:${m.chat}`,
  folder: "WhatsApp",
  from: m.from,
  fromEmail: null,
  subject: m.chat,
  preview: m.text,
  receivedAt: new Date(m.t * 1000).toISOString(),
  unread,
  ...(extra ? { group: m.group, toMe: m.toMe } : {}),
});

// ---------------------------------------------------------------------------
// The chat list (the fallback)
// ---------------------------------------------------------------------------

async function whatsappChats({ days = 3, maxChats = 150, openIfMissing = false, launch = openIfMissing } = {}) {
  const C = loadContract();
  const since = Date.now() - Math.min(120, Math.max(1, Number(days) || 3)) * 864e5;
  const cap = Math.min(500, Math.max(1, Number(maxChats) || 150));
  const archived = new RegExp(`^(${C.texts.archived.join("|")})$`, "i");
  const browser = await connectToChrome(CDP, { launchUrls: launch ? [HOME] : [] });
  try {
    const page = await whatsappPage(browser, C, { openIfMissing: !!openIfMissing });
    const pane = page.locator(css(C.selectors.chatList));
    const start = await pane.evaluate((el) => el.scrollTop).catch(() => 0);
    await pane.evaluate((el) => (el.scrollTop = 0)).catch(() => {});
    await sleep(400);
    const chats = new Map();
    let older = 0;
    for (let pass = 0; pass < 60 && chats.size < cap; pass++) {
      const got = await inPage(page, readRows, { contract: C });
      if (!got.ready) throw new Error("WhatsApp Web's chat list is gone (signed out?).");
      for (const r of got.rows) {
        if (!r.name || chats.has(r.name) || archived.test(r.name)) continue;
        const at = parseWhen(r.when, new Date(), got.lang);
        chats.set(r.name, { ...r, at });
        // Pinned chats come first, whatever their age: only the unpinned ones (newest first) end the list.
        if (at && Date.parse(at) < since) older++;
      }
      debug(`pass ${pass}: ${got.rows.length} rows, ${chats.size} chats, ${older} older`);
      if (older >= 5 || got.scrollTop >= got.scrollMax - 2) break;
      await pane.evaluate((el) => (el.scrollTop += el.clientHeight * 0.8));
      await sleep(500);
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

// ---------------------------------------------------------------------------
// Opening a chat (only: fetching from the phone, sending)
// ---------------------------------------------------------------------------

/** The chat found by its exact name through the search and opened (that marks it read, as you'd do); checked that it is that one. */
async function openChat(page, C, name, { nothingSent = "" } = {}) {
  await page.bringToFront().catch(() => {});
  const search = page.locator(css(C.selectors.search)).first();
  await search.click({ timeout: 15000 });
  await search.fill("");
  await search.pressSequentially(name, { delay: 15 });
  // The result with exactly that name — as a locator (found again on each try: WhatsApp redraws
  // the results while they come in), once they've settled.
  const result = page.locator(`${css(C.selectors.chatList)} span[title="${quote(name)}"]`).first();
  await sleep(800);
  try {
    await result.click({ timeout: 10000 });
  } catch {
    await search.fill("").catch(() => {});
    throw new Error(`There's no WhatsApp chat “${name}” (written exactly like that)${nothingSent}.`);
  }
  await page.locator(css(C.selectors.main)).waitFor({ timeout: 15000 });
  return search;
}

/**
 * The chat opened (found by its exact name through WhatsApp's search — that marks it read, as you'd
 * do) and scrolled up to its beginning: each time WhatsApp offers older messages from your phone,
 * they're fetched — until nothing more comes. What came in is then in WhatsApp's store.
 */
async function pullFromPhone(page, C, name, { rounds = 300, idleRounds = 6 } = {}) {
  const search = await openChat(page, C, name);
  const header = await inPage(page, readHeader, { contract: C });
  if (!header.includes(name)) throw new Error(`Another chat was opened (${header.slice(0, 80)}).`);
  // The link itself, clicked like you would (a real mouse click — its handler sits on an inner element).
  const older = page.locator(css(C.selectors.main)).getByText(new RegExp(C.texts.olderFromPhone.join("|"), "i")).last();
  let height = 0;
  let idle = 0;
  let fetched = 0;
  let stuck = 0;
  for (let i = 0; i < rounds && idle < idleRounds; i++) {
    const h = (await inPage(page, scrollChatTop, { contract: C }).catch(() => null)) ?? 0;
    await sleep(1200);
    let clicked = false;
    if (await older.isVisible().catch(() => false)) {
      await older.click({ timeout: 5000 }).catch((e) => debug(`click: ${e.message.split("\n")[0]}`));
      clicked = true;
      fetched++;
      // Until the older messages are in (the list grows) — the phone has to answer.
      let grown = false;
      for (let w = 0; w < 30 && !grown; w++) {
        await sleep(1000);
        grown = ((await inPage(page, scrollChatTop, { contract: C }).catch(() => null)) ?? 0) > h;
      }
      debug(`round ${i}: fetched from the phone — ${grown ? "more came" : "nothing came (yet)"}`);
      // The link stays but nothing comes (the phone offline, or nothing older): give up after a few.
      stuck = grown ? 0 : stuck + 1;
      if (stuck >= 3) break;
    }
    if (h > height || clicked) {
      height = Math.max(height, h);
      idle = 0;
    } else idle++;
  }
  await search.fill("").catch(() => {});
  return { fetched, stuck: stuck >= 3 };
}

async function whatsappHistory({ chat = "", maxLoads = 400, fromPhone = false, openIfMissing = false, launch = openIfMissing || fromPhone } = {}) {
  const name = String(chat).trim();
  if (!name) throw new Error("Which chat? (its name, as in WhatsApp)");
  const C = loadContract();
  const browser = await connectToChrome(CDP, { launchUrls: launch ? [HOME] : [] });
  try {
    let page = await whatsappPage(browser, C, { openIfMissing: !!openIfMissing || !!fromPhone });
    let phone = null;
    if (fromPhone) {
      // Its exact name first (the search wants it so): what the store calls it.
      const exact = await inPage(page, readHistory, { contract: C, name, maxLoads: 1, settleMs: 0 });
      if (exact.error === "no-internals") return noInternals(exact);
      if (exact.error === "not-found") throw new Error(`There's no WhatsApp chat “${name}”.`);
      if (exact.error === "ambiguous") throw new Error(`Several chats match “${name}”: ${exact.candidates.join(", ")} — please be exact.`);
      if (!exact.error) {
        phone = { fetched: 0 };
        // WhatsApp Web reloads itself now and then (an update, memory): the tab found again, the
        // chat opened again — what came from the phone so far is kept in its store.
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            phone.fetched += (await pullFromPhone(page, C, exact.chat)).fetched;
            break;
          } catch (e) {
            if (!/closed|detached|crash|navigat|Target/i.test(String(e?.message || e))) throw e;
            debug(`the WhatsApp tab went away (${String(e?.message || e).slice(0, 80)}) — again`);
            await sleep(5000);
            page = await whatsappPage(browser, C, { openIfMissing: true });
          }
        }
      }
    }
    const got = await inPage(page, readHistory, { contract: C, name, maxLoads: Math.min(2000, Math.max(1, Number(maxLoads) || 400)), settleMs: 1500 });
    if (got.error === "not-found") throw new Error(`There's no WhatsApp chat “${name}”.`);
    if (got.error === "ambiguous") throw new Error(`Several chats match “${name}”: ${got.candidates.join(", ")} — please be exact.`);
    if (got.error === "no-internals") return noInternals(got);
    if (got.error) return JSON.stringify({ error: got.error });
    debug(`${got.chat}: ${got.messages.length} messages after ${got.loads} loads${got.complete ? " (from the beginning)" : ""}`);
    return JSON.stringify({
      chat: got.chat,
      complete: got.complete,
      loads: got.loads,
      fromPhone: phone ? phone.fetched : null,
      messages: got.messages.map((m) => toMail(m, { unread: false })),
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function whatsappMessages({ days = 3, maxLoads = 4, maxMessages = 3000, openIfMissing = false, launch = openIfMissing } = {}) {
  const C = loadContract();
  const span = Math.min(120, Math.max(1, Number(days) || 3));
  const browser = await connectToChrome(CDP, { launchUrls: launch ? [HOME] : [] });
  try {
    const page = await whatsappPage(browser, C, { openIfMissing: !!openIfMissing });
    const got = await inPage(page, readMessages, { contract: C, since: Math.floor(Date.now() / 1000) - span * 86400, maxLoads: Math.min(10, Math.max(0, Number(maxLoads) || 0)), maxMessages });
    if (got.error) return noInternals(got);
    debug(`${got.chats} chats, ${got.messages.length} messages`);
    return JSON.stringify({ messages: got.messages.map((m) => toMail(m, { extra: true })) });
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Send a message to a chat — on your click (an Auto-Aktion), never by itself: the chat found by its
 * exact name through WhatsApp Web's search and opened (that marks it read, as you'd do), checked
 * that it's that chat, the text typed (line breaks as Shift+Enter) and sent; seen as sent.
 */
async function whatsappSend({ chat = "", text = "", dryRun = false } = {}) {
  const name = String(chat).trim();
  const body = String(text).trim();
  if (!name || (!body && !dryRun)) throw new Error("Chat and text are missing.");
  const C = loadContract();
  const browser = await connectToChrome(CDP, { launchUrls: [HOME] });
  try {
    const page = await whatsappPage(browser, C, { openIfMissing: true });
    await openChat(page, C, name, { nothingSent: " — nothing sent" });
    const box = page.locator(css(C.selectors.composer)).last();
    await box.waitFor({ timeout: 15000 });
    // That chat and no other: else nothing is typed.
    const header = await inPage(page, readHeader, { contract: C });
    if (!header.includes(name)) throw new Error(`Another chat was opened (${header.slice(0, 80)}) — nothing sent.`);
    // A check only: the chat found and open, nothing typed.
    if (dryRun) return JSON.stringify({ chat: name, dryRun: true, header: header.slice(0, 120) });
    await box.click();
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await page.keyboard.insertText(lines[i]);
      if (i < lines.length - 1) await page.keyboard.press("Shift+Enter");
    }
    await page.keyboard.press("Enter");
    // Seen as sent: the chat's last outgoing message starts with it.
    const start = lines.find(Boolean)?.slice(0, 40) ?? "";
    let seen = false;
    for (let i = 0; i < 20 && !seen; i++) {
      seen = await inPage(page, sentSeen, { contract: C, start }).catch(() => false);
      if (!seen) await sleep(500);
    }
    return JSON.stringify({ chat: name, sentAt: Date.now(), seen });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Status and self-test
// ---------------------------------------------------------------------------

async function whatsappStatus() {
  let browser;
  try {
    browser = await connectToChrome(CDP, {});
  } catch (e) {
    return JSON.stringify({ chrome: false, linked: false, message: String(e?.message || e) });
  }
  try {
    const C = loadContract();
    const page = (browser.contexts()[0]?.pages() ?? []).find((p) => isWhatsapp(p.url()));
    const state = page ? await inPage(page, readState, { contract: C }).catch(() => "loading") : null;
    const linked = state === "chats";
    // Linked: the contract is looked at too (cheap, read-only) — a drift is told before it breaks a sync.
    let drift = null;
    if (linked) {
      const r = report("whatsapp", await inPage(page, selfCheck, { contract: C }).catch(() => []), C);
      drift = r.ok && !r.drifted ? null : { ok: r.ok, summary: r.summary };
    }
    return JSON.stringify({ chrome: true, open: !!page, linked, state, ...(drift ? { drift } : {}) });
  } finally {
    await browser.close().catch(() => {});
  }
}

/** The contract against the live tab (WhatsApp Web open and linked): what holds, what drifted, what broke. */
async function whatsappSelftest({ openIfMissing = false, launch = openIfMissing } = {}) {
  const C = loadContract();
  const browser = await connectToChrome(CDP, { launchUrls: launch ? [HOME] : [] });
  try {
    const page = await whatsappPage(browser, C, { openIfMissing: !!openIfMissing });
    return JSON.stringify(report("whatsapp", await inPage(page, selfCheck, { contract: C }), C));
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

const OPEN = { type: "boolean", description: "Open WhatsApp Web in the automation Chrome when it isn't (default false)." };
const LAUNCH = { type: "boolean", description: "Start the automation Chrome when it isn't running (default: as openIfMissing)." };
const TOOLS = [
  { name: "whatsapp_status", description: "Check whether Chrome (with the debug port) is reachable and WhatsApp Web is open and linked — and whether WhatsApp Web still matches what the driver expects (drift).", inputSchema: { type: "object", properties: {} } },
  {
    name: "whatsapp_selftest",
    description: "Check the driver's contract against the live WhatsApp Web tab, read-only (module names and members, selectors, the shape of the data — types and counts, never content). Returns JSON { ok, drifted, failed, drift, summary, checks }: after an update of WhatsApp Web, this says what to fix in contract.json.",
    inputSchema: { type: "object", properties: { openIfMissing: OPEN, launch: LAUNCH } },
  },
  {
    name: "whatsapp_chats",
    description: "Read the chats with a message in the last days from WhatsApp Web's chat list — read-only: each chat's name and last message (sender, text, time, unread); opens no chat, so nothing is marked read. Returns JSON { messages }.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back (default 3, at most 120)." },
        maxChats: { type: "number", description: "At most this many chats (default 150)." },
        openIfMissing: OPEN,
        launch: LAUNCH,
      },
    },
  },
  {
    name: "whatsapp_history",
    description:
      "ONE chat's whole history, read-only — its earlier messages loaded from WhatsApp Web's store (and on demand from the phone) until none are left; the chat is NOT opened (no read receipts). Returns JSON { chat, complete, loads, messages } in the mail sync's shape.",
    inputSchema: {
      type: "object",
      properties: {
        chat: { type: "string", description: "The chat's name as WhatsApp shows it (exactly, else regardless of case, else the one name containing it)." },
        maxLoads: { type: "number", description: "At most this many loads of earlier messages (default 400, at most 2000)." },
        fromPhone: { type: "boolean", description: "Also fetch older messages from the phone: OPENS the chat (its unread messages count as read) and scrolls it up to its beginning, fetching each time WhatsApp offers older messages (default false)." },
        openIfMissing: OPEN,
        launch: LAUNCH,
      },
      required: ["chat"],
    },
  },
  {
    name: "whatsapp_send",
    description: "Send a message to a WhatsApp chat (found by its exact name) through WhatsApp Web — only on the user's click. Opens the chat (marks it read), types and sends. Returns JSON { chat, sentAt, seen }.",
    inputSchema: { type: "object", properties: { chat: { type: "string", description: "The chat's exact name." }, text: { type: "string", description: "The message." } }, required: ["chat", "text"] },
  },
  {
    name: "whatsapp_messages",
    description: "Read the messages of the chats active in the last days from WhatsApp Web — read-only: what it has decrypted for display, earlier ones loaded from its local store; no chat opened, nothing marked read. Returns JSON { messages } — or { error: \"no-internals\" } when WhatsApp Web doesn't offer that (use whatsapp_chats then).",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back (default 3, at most 120)." },
        maxLoads: { type: "number", description: "How often a chat's earlier messages are loaded at most (default 4)." },
        openIfMissing: OPEN,
        launch: LAUNCH,
      },
    },
  },
];

const locked = (tool, fn) => (args) => withTabLock("WhatsApp", tool, () => fn(args), debug);

// Imported (for a test of parseWhen): no server.
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  serveMcp({
    name: "whatsapp",
    tools: TOOLS,
    log,
    handlers: {
      whatsapp_status: () => whatsappStatus(),
      whatsapp_selftest: locked("whatsapp_selftest", whatsappSelftest),
      whatsapp_chats: locked("whatsapp_chats", whatsappChats),
      whatsapp_messages: locked("whatsapp_messages", whatsappMessages),
      whatsapp_history: locked("whatsapp_history", whatsappHistory),
      whatsapp_send: locked("whatsapp_send", whatsappSend),
    },
  });
  log(`ready (CDP ${CDP})`);
}
