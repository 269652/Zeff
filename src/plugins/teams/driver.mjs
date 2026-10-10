#!/usr/bin/env node
/**
 * teams-mcp — a stdio MCP server that reads your Teams messages for Zeff, deterministically
 * (no LLM) and read-only. It ATTACHES to the automation Chrome (the one Chrono/Punch/Outlook use;
 * default http://127.0.0.1:9222, override with TEAMS_CDP_ENDPOINT) and reads the Teams web
 * app's OWN local cache (IndexedDB) in its tab — no clicks, no requests, nothing is marked read,
 * no token or password is touched.
 *
 * Tools:
 *   teams_status                         -> is Chrome reachable, is Teams open and signed in
 *   teams_messages {pmDays, openIfMissing} -> JSON { tenantId, userId, messages, unresolved }:
 *                                           where you were @mentioned (the Activity feed's
 *                                           mentions) and what colleagues wrote you in 1:1 chats
 *                                           over the last pmDays days, each with sender, time,
 *                                           place, content (HTML) and an "Open in Teams" link
 *   teams_send {to, text, dryRun}        -> sends a 1:1 chat message to a colleague (by display
 *                                           name): opens your chat with them in the Teams tab,
 *                                           checks it's theirs, types the text and sends it. The
 *                                           ONLY writing tool — run on your click in Zeff.
 */
import { connectToChrome, ChromeConnectError, withTabLock } from "../../../scripts/chrome-cdp.mjs";

const CDP = process.env.TEAMS_CDP_ENDPOINT || process.env.CHRONO_CDP_ENDPOINT || "http://127.0.0.1:9222";
const TEAMS_URL = "https://teams.microsoft.com/v2/";
const log = (...a) => process.stderr.write(`[teams-mcp] ${a.join(" ")}\n`);
/** Step-by-step logging when TEAMS_DEBUG is set. */
const debug = (...a) => process.env.TEAMS_DEBUG && log(...a);

const isTeamsUrl = (u) => /^https:\/\/teams\.(microsoft\.com|cloud\.microsoft|live\.com)\//i.test(u);
const isLoginUrl = (u) => /login\.microsoftonline\.com|login\.live\.com|login\.windows\.net/i.test(u);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs IN the Teams tab: reads the Activity feed's mentions and the 1:1 chats from the Teams
 * web app's IndexedDB (read-only transactions) and joins them with their messages and places.
 * Self-contained — Playwright ships it to the page as source.
 */
async function readTeams({ pmSince, chatSince = 0 }) {
  const dbs = await indexedDB.databases();
  const dbName = (part) => dbs.find((d) => d.name && d.name.split(":")[1] === part)?.name;
  const actName = dbName("activity-manager");
  if (!actName || !dbName("replychain-manager") || !dbName("conversation-manager")) {
    return { error: "Teams hasn't stored its data in this tab yet — let it finish loading, then sync again." };
  }
  // "Teams:activity-manager:react-web-client:<tenant>:<user>:<locale>"
  const [, , , tenantId, userId] = actName.split(":");
  const open = (name) => new Promise((ok, no) => { const r = indexedDB.open(name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const req = (r) => new Promise((ok) => { r.onsuccess = () => ok(r.result); r.onerror = () => ok(undefined); });
  // Plain text for search. Teams enforces Trusted Types (no DOMParser on strings), so tags are stripped by hand.
  const text = (html) =>
    String(html || "")
      .replace(/<(br|\/p|\/div|\/li|\/blockquote)\b[^>]*>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();

  const cm = await open(dbName("conversation-manager"));
  const convs = new Map(((await req(cm.transaction("conversations", "readonly").objectStore("conversations").getAll())) || []).map((c) => [c.id, c]));
  cm.close();

  /** Where a message was written, and its "Open in Teams" link. */
  const placeOf = (m, replyChainId) => {
    const conv = convs.get(m.conversationId);
    const tp = (conv && conv.threadProperties) || {};
    const base = `https://teams.microsoft.com/l/message/${m.conversationId}/${m.id}`;
    if (conv && conv.type === "Topic") {
      const team = convs.get(tp.spaceId || conv.teamId);
      const ttp = (team && team.threadProperties) || {};
      const teamName = ttp.spaceThreadTopic || ttp.topic || "";
      const channelName = (typeof tp.topic === "string" && tp.topic) || "General";
      const q = new URLSearchParams({ tenantId, groupId: ttp.groupId || "", parentMessageId: replyChainId || m.id, teamName, channelName, createdTime: String(m.originalArrivalTime) });
      return { place: teamName ? `${teamName} › ${channelName}` : channelName, channel: true, link: `${base}?${q}` };
    }
    const topic = typeof tp.topic === "string" && tp.topic.trim() ? tp.topic.trim() : null;
    const oneOnOne = /@unq\.gbl\.spaces$/.test(m.conversationId);
    const place = topic || (oneOnOne ? `Chat with ${m.isSentByCurrentUser ? "…" : m.imDisplayName || "…"}` : conv && conv.type === "Meeting" ? "Meeting chat" : "Group chat");
    return { place, channel: false, link: `${base}?context=${encodeURIComponent('{"contextType":"chat"}')}` };
  };

  const out = new Map();
  const add = (m, replyChainId, extra) => {
    const key = `${m.conversationId}|${m.id}`;
    if (out.has(key)) return;
    const p = placeOf(m, replyChainId);
    const props = m.properties || {};
    out.set(key, {
      key,
      conversationId: m.conversationId,
      replyChainId: replyChainId || null,
      messageId: m.id,
      place: p.place,
      senderName: m.imDisplayName || null,
      senderId: m.creator || null,
      sentAt: m.originalArrivalTime,
      subject: (typeof props.subject === "string" && props.subject.trim()) || (typeof props.title === "string" && props.title.trim()) || null,
      html: m.content || "",
      text: text(m.content),
      link: p.link,
      ...extra,
    });
  };
  const usable = (m) => m && !m.deletionInfo && /^(RichText|Text)/.test(m.messageType || "");

  // Where you were mentioned: the Activity feed's mentions…
  const act = await open(actName);
  const feed = ((await req(act.transaction("feed-items", "readonly").objectStore("feed-items").getAll())) || []).filter((i) => /^mention/i.test(i.activityType));
  act.close();

  // …with their messages. One transaction, kept busy: it closes as soon as nothing is pending.
  const rc = await open(dbName("replychain-manager"));
  const chains = rc.transaction("replychains", "readonly").objectStore("replychains");
  let unresolved = 0;
  for (const i of feed) {
    const chainId = i.sourceReplyChainId || i.sourceMessageId;
    const chain = await req(chains.get([i.sourceThreadId, chainId]));
    const m = chain && Object.values(chain.messageMap || {}).find((x) => x.id === i.sourceMessageId);
    if (!usable(m)) { unresolved++; continue; }
    add(m, chainId, { kind: "mention", mentionType: i.activitySubtype || "person", isRead: !!i.isRead });
  }

  // PMs: what colleagues wrote you in 1:1 chats lately.
  for (const c of convs.values()) {
    if (!/@unq\.gbl\.spaces$/.test(c.id)) continue;
    const list = (await req(chains.getAll(IDBKeyRange.bound([c.id, ""], [c.id, "￿"])))) || [];
    for (const ch of list) {
      for (const m of Object.values(ch.messageMap || {})) {
        if (!usable(m) || m.isSentByCurrentUser || !(m.originalArrivalTime >= pmSince)) continue;
        add(m, ch.replyChainId, { kind: "pm", mentionType: null, isRead: null });
      }
    }
  }

  // Chats lately (1:1, group and meeting chats — not channels), both ways, yours too: the
  // conversations as they went (what was agreed in a chat becomes work too).
  if (chatSince) {
    for (const c of convs.values()) {
      if (c.type === "Topic" || c.type === "Space" || !(Number(c.lastMessageTimeUtc || 0) >= chatSince)) continue;
      const list = (await req(chains.getAll(IDBKeyRange.bound([c.id, ""], [c.id, "\uffff"])))) || [];
      const all = list.flatMap((ch) => Object.values(ch.messageMap || {}).map((m) => ({ m, chain: ch.replyChainId })));
      // A 1:1 chat: named for the other one (also on your own messages there).
      const other = /@unq\.gbl\.spaces$/.test(c.id) ? all.find(({ m }) => !m.isSentByCurrentUser && m.imDisplayName)?.m.imDisplayName : null;
      for (const { m, chain } of all) {
        if (!usable(m) || !(m.originalArrivalTime >= chatSince)) continue;
        add(m, chain, { kind: "chat", mentionType: null, isRead: null, mine: !!m.isSentByCurrentUser, ...(other ? { place: `Chat with ${other}` } : {}) });
      }
    }
  }
  rc.close();
  return { tenantId, userId, messages: [...out.values()], unresolved };
}

/**
 * The Teams tab (signed in), opening one when asked and there is none. A tab on Microsoft's
 * sign-in page counts as it (Teams sent it there) — so no new tab each time, and the error says
 * to sign in. A new tab gets its time to land (Teams' redirects) before it's judged.
 */
async function teamsPage(browser, { openIfMissing = false } = {}) {
  const context = browser.contexts()[0];
  if (!context) throw new ChromeConnectError("The automation Chrome has no window open.");
  let page = context.pages().find((p) => isTeamsUrl(p.url())) ?? context.pages().find((p) => isLoginUrl(p.url()));
  if (!page) {
    if (!openIfMissing) throw new Error(`Teams isn't open in the automation Chrome — open ${TEAMS_URL} there (or press Sync on Zeff's Teams page).`);
    page = await context.newPage();
    await page.goto(TEAMS_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => debug(`opening Teams: ${e}`));
    for (let i = 0; i < 20 && !isLoginUrl(page.url()) && !/\/v2\/|_#|\/l\//.test(page.url()); i++) await sleep(500);
    await sleep(1500);
  }
  if (isLoginUrl(page.url())) throw new Error("Teams shows its sign-in page — sign in in the automation Chrome, then sync again.");
  return page;
}

/** Attach to the automation Chrome — started when it isn't running only when `launch` (a sync by hand). */
async function connect(launch) {
  return connectToChrome(CDP, { launchUrls: launch ? [TEAMS_URL] : [] });
}

async function teamsStatus() {
  let browser;
  try {
    browser = await connect(false);
  } catch (e) {
    return e instanceof ChromeConnectError ? e.message : `Cannot reach Chrome on ${CDP}. (${String(e).slice(0, 120)})`;
  }
  try {
    const page = await teamsPage(browser);
    return `Connected. Teams is open (${(await page.title()).slice(0, 80)}).`;
  } catch (e) {
    return String(e?.message || e);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function teamsMessages({ pmDays = 90, chatDays = 0, openIfMissing = false, launch = openIfMissing } = {}) {
  const days = Math.max(1, Math.min(3650, Number(pmDays) || 90));
  const chatSince = Number(chatDays) > 0 ? Date.now() - Math.min(30, Number(chatDays)) * 864e5 : 0;
  const browser = await connect(!!launch);
  try {
    const page = await teamsPage(browser, { openIfMissing: !!openIfMissing });
    let r = null;
    // A Teams tab that just opened may need a moment before its data is there.
    for (let i = 0; i < 12; i++) {
      r = await page.evaluate(readTeams, { pmSince: Date.now() - days * 864e5, chatSince }).catch((e) => ({ error: String(e?.message || e).split("\n")[0] }));
      if (!r.error || !/hasn't stored/.test(r.error)) break;
      await sleep(5000);
    }
    if (r.error) throw new Error(r.error);
    debug(`${r.messages.length} messages, ${r.unresolved} mentions without their message`);
    return JSON.stringify(r);
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Sending a 1:1 message
// ---------------------------------------------------------------------------

/**
 * Runs IN the Teams tab: a colleague by display name (Teams' own profiles cache) and your 1:1
 * chat with them, if there is one. Read-only.
 */
async function findPerson({ name }) {
  const dbs = (await indexedDB.databases()).map((d) => d.name);
  const open = (n) => new Promise((ok, no) => { const r = indexedDB.open(n); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const req = (r) => new Promise((ok) => { r.onsuccess = () => ok(r.result); r.onerror = () => ok(undefined); });
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const pName = dbs.find((n) => n && n.split(":")[1] === "profiles");
  const cName = dbs.find((n) => n && n.split(":")[1] === "conversation-manager");
  if (!pName || !cName) return { error: "Teams hasn't stored its data in this tab yet — let it finish loading." };
  const pdb = await open(pName);
  const profiles = (await req(pdb.transaction("profiles", "readonly").objectStore("profiles").getAll())) || [];
  pdb.close();
  const want = norm(name);
  const hits = profiles.filter((x) => x && x.displayName && x.mri && (norm(x.displayName) === want || norm(`${x.givenName || ""} ${x.surname || ""}`) === want));
  const p = hits[0];
  if (!p) return { error: `Teams knows nobody called “${name}”.` };
  if (hits.length > 1 && new Set(hits.map((h) => h.mri)).size > 1) return { error: `“${name}” isn't unique in Teams.` };
  const cm = await open(cName);
  const convs = (await req(cm.transaction("conversations", "readonly").objectStore("conversations").getAll())) || [];
  cm.close();
  const chat = convs.find((c) => /@unq\.gbl\.spaces$/.test(c.id) && (c.members || []).some((m) => m.id === p.mri));
  return { displayName: p.displayName, upn: p.userPrincipalName || p.$$email || null, convId: chat ? chat.id : null };
}

/**
 * Runs IN the Teams tab: the message you just sent in your chat with someone (the newest of
 * yours there containing `probe`) — as the sync gives messages: key, ids, link, text. Read-only.
 */
async function findSent({ name, convId, probe }) {
  const dbs = (await indexedDB.databases()).map((d) => d.name);
  const open = (n) => new Promise((ok, no) => { const r = indexedDB.open(n); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const req = (r) => new Promise((ok) => { r.onsuccess = () => ok(r.result); r.onerror = () => ok(undefined); });
  const text = (html) => String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  let conv = convId;
  if (!conv) {
    // A new chat: the 1:1 one with them now.
    const cm = await open(dbs.find((n) => n && n.split(":")[1] === "conversation-manager"));
    const convs = (await req(cm.transaction("conversations", "readonly").objectStore("conversations").getAll())) || [];
    cm.close();
    conv = convs.filter((c) => /@unq\.gbl\.spaces$/.test(c.id)).sort((a, b) => Number(b.lastMessageTimeUtc || 0) - Number(a.lastMessageTimeUtc || 0))[0]?.id;
  }
  if (!conv) return null;
  const rc = await open(dbs.find((n) => n && n.split(":")[1] === "replychain-manager"));
  const list = (await req(rc.transaction("replychains", "readonly").objectStore("replychains").getAll(IDBKeyRange.bound([conv, ""], [conv, "\uffff"])))) || [];
  rc.close();
  const want = String(probe || "").replace(/\s+/g, " ").trim();
  const mine = list
    .flatMap((ch) => Object.values(ch.messageMap || {}).map((m) => ({ m, chain: ch.replyChainId })))
    // Not one still pending (its id -1 or temporary until Teams has it).
    .filter(({ m }) => m.isSentByCurrentUser && !m.deletionInfo && Number(m.id) > 0 && text(m.content).includes(want))
    .sort((a, b) => Number(b.m.originalArrivalTime || 0) - Number(a.m.originalArrivalTime || 0))[0];
  if (!mine) return null;
  const { m, chain } = mine;
  return {
    key: `${conv}|${m.id}`,
    conversationId: conv,
    replyChainId: chain || null,
    messageId: m.id,
    place: `Chat with ${name}`,
    senderName: m.imDisplayName || null,
    senderId: m.creator || null,
    sentAt: m.originalArrivalTime,
    subject: null,
    html: m.content || "",
    text: text(m.content),
    link: `https://teams.microsoft.com/l/message/${conv}/${m.id}?context=${encodeURIComponent('{"contextType":"chat"}')}`,
    kind: "chat",
    mentionType: null,
    isRead: null,
  };
}

const COMPOSE = '[data-tid="ckeditor"]';
/** The send button — Teams names it either way. */
const SEND = '[data-tid="newMessageCommands-send"], [data-tid="sendMessageCommands-send"]';
/** Whitespace-blind, for comparing what's in the box with what's to send. */
const flat = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * Send `text` to a colleague's 1:1 chat: their chat opened in the Teams tab (by its web route —
 * a new chat by their address when there's none yet), the window title checked to be theirs,
 * the text typed (lines with Shift+Enter) and sent with the send button, then checked to be in
 * the chat. `dryRun`: only opened and checked — nothing typed.
 */
async function teamsSend({ to, text, dryRun = false }) {
  const name = String(to || "").trim();
  const body = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!name) throw new Error("An wen? (to fehlt)");
  if (!body && !dryRun) throw new Error("Kein Text.");
  const browser = await connect(false);
  try {
    const page = await teamsPage(browser);
    const who = await page.evaluate(findPerson, { name });
    if (who.error) throw new Error(who.error);
    const route = who.convId
      ? `https://teams.microsoft.com/_#/l/chat/${encodeURIComponent(who.convId)}/conversations`
      : who.upn
        ? `https://teams.microsoft.com/_#/l/chat/0/0?users=${encodeURIComponent(who.upn)}`
        : null;
    if (!route) throw new Error(`There's no chat and no address for ${who.displayName}.`);
    debug(`opening ${who.convId ? "the chat" : "a new chat"} with ${who.displayName}`);
    // Their chat open already (the window title names them): no reload — else to it.
    const open = (await page.title()).split("|").map((x) => x.trim()).includes(who.displayName) && (await page.locator(COMPOSE).first().isVisible().catch(() => false));
    if (!open) await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Theirs: the window title names them ("Chat | Christopher Lorenz | Microsoft Teams").
    const theirs = await page
      .waitForFunction((n) => document.title.split("|").map((x) => x.trim()).includes(n), who.displayName, { timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    if (!theirs) throw new Error(`The chat with ${who.displayName} didn't open (window: “${(await page.title()).slice(0, 80)}”) — nothing sent.`);
    const box = page.locator(COMPOSE).first();
    await box.waitFor({ state: "visible", timeout: 30000 });
    const away = await page.evaluate(() => {
      const t = document.body.innerText || "";
      const m = /([^\n]{0,60}(außer Haus|out of office|abwesend)[^\n]{0,60})/i.exec(t);
      return m ? m[1].trim() : null;
    });
    if (dryRun) return JSON.stringify({ ok: true, dryRun: true, to: who.displayName, newChat: !who.convId, away });
    // A draft in the box: this very message (a try that didn't get to send it) goes out as it is; another one stays — nothing sent.
    const draft = flat(await box.innerText());
    const lines = body.split("\n");
    if (draft && draft !== flat(body)) throw new Error(`The chat with ${who.displayName} already holds another draft — nothing sent.`);
    if (!draft) {
      await box.click();
      for (let i = 0; i < lines.length; i++) {
        if (i) await page.keyboard.press("Shift+Enter");
        if (lines[i]) await page.keyboard.insertText(lines[i]);
      }
    }
    // Send: the visible send button, else Ctrl+Enter (sends with either Teams setting).
    const button = page.locator(SEND).filter({ visible: true }).first();
    if (await button.isVisible().catch(() => false)) await button.click({ timeout: 5000 });
    else {
      await box.click();
      await page.keyboard.press("Control+Enter");
    }
    // Sent: the box empties and the text shows in the chat.
    const probe = lines.find((l) => l.trim().length >= 8)?.trim().slice(0, 40) ?? body.slice(0, 40);
    const sent = await page
      .waitForFunction(
        ({ sel, probe }) => {
          const b = document.querySelector(sel);
          return (!b || !b.innerText.trim()) && (document.body.innerText || "").includes(probe);
        },
        { sel: COMPOSE, probe },
        { timeout: 30000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!sent) throw new Error(`The message to ${who.displayName} may not have gone out — check the chat.`);
    // The message as Teams keeps it (its id, its link) — so what's sent can be found again.
    let message = null;
    for (let i = 0; i < 20 && !message; i++) {
      message = await page.evaluate(findSent, { name: who.displayName, convId: who.convId, probe }).catch(() => null);
      if (!message) await sleep(1000);
    }
    return JSON.stringify({ ok: true, to: who.displayName, newChat: !who.convId, away, message });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio server (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "teams_status",
    description: "Check whether Chrome (with the debug port) is reachable and Teams is open and signed in there.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "teams_messages",
    description:
      "Read where you were @mentioned in Teams and what colleagues wrote you in 1:1 chats, from the Teams web app's own cache in the automation Chrome — read-only: no clicks, nothing marked read. Returns JSON { tenantId, userId, messages: [{ key, kind: 'mention'|'pm', mentionType, place, senderName, sentAt, subject, html, text, link, ... }], unresolved }.",
    inputSchema: {
      type: "object",
      properties: {
        pmDays: { type: "number", description: "How many days back to read 1:1 chats (default 90)." },
        chatDays: { type: "number", description: "Also every chat (1:1, group, meeting — not channels) of the last N days, both ways, yours included, as kind 'chat' (default 0: none)." },
        openIfMissing: { type: "boolean", description: "Open Teams in the automation Chrome when it isn't (default false)." },
        launch: { type: "boolean", description: "Start the automation Chrome when it isn't running (default: as openIfMissing)." },
      },
    },
  },
  {
    name: "teams_send",
    description:
      "Send a 1:1 chat message to a colleague (by display name) through the Teams tab in the automation Chrome: opens your chat with them, checks it's theirs, types and sends. dryRun: only open and check. Returns JSON { ok, to, newChat, away }.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "The colleague's display name, e.g. 'Christopher Lorenz'." },
        text: { type: "string", description: "The message (plain text; new lines are kept)." },
        dryRun: { type: "boolean", description: "Only open the chat and check it — nothing typed or sent." },
      },
      required: ["to"],
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
  if (method === "initialize") {
    return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "teams", version: "0.1.0" } });
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      if (name === "teams_status") return ok(id, textResult(await teamsStatus()));
      if (name === "teams_messages") return ok(id, textResult(await withTabLock("Teams", name, () => teamsMessages(args), debug)));
      if (name === "teams_send") return ok(id, textResult(await withTabLock("Teams", name, () => teamsSend(args), debug)));
      return ok(id, textResult(`Unknown tool "${name}".`, true));
    } catch (e) {
      log("tool error:", String(e));
      return ok(id, textResult(`Error: ${String(e?.message || e).slice(0, 300)}`, true));
    }
  }
  if (id !== undefined) ok(id, {});
}

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
