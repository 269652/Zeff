#!/usr/bin/env node
/**
 * gmail-mcp — a stdio MCP server that reads your Gmail inbox for Zeff with Playwright,
 * deterministically (no LLM) and read-only. It ATTACHES to the automation Chrome (the account's —
 * GMAIL_CDP_ENDPOINT, else ROAR_CDP_ENDPOINT, default http://127.0.0.1:9222), where your Google
 * session signs Gmail in — no password is ever handled here.
 *
 * Tools:
 *   gmail_status            -> is Chrome reachable, is Gmail signed in
 *   gmail_mail {days}       -> the inbox's mails of the last days, read from the list as Gmail
 *                              shows it (sender, subject, snippet, time, unread), page by page
 *                              (#inbox/p2 …) in a Gmail tab — no mail is opened, none marked read
 */
import { connectToChrome, ChromeConnectError, withTabLock } from "../../../scripts/chrome-cdp.mjs";

const CDP = process.env.GMAIL_CDP_ENDPOINT || process.env.ROAR_CDP_ENDPOINT || "http://127.0.0.1:9222";
const log = (...a) => process.stderr.write(`[gmail-mcp] ${a.join(" ")}\n`);
const debug = (...a) => process.env.GMAIL_DEBUG && log(...a);

/** An account: Gmail's number (mail/u/0) or the address (mail/u/me@gmail.com — Gmail goes to its number). */
const inboxUrl = (account = 0) => `https://mail.google.com/mail/u/${encodeURIComponent(String(account)).replace(/%40/g, "@")}/#inbox`;
/**
 * The inbox's mails of the last days as ONE flat list — a search (in:inbox newer_than:Nd), page n.
 * #inbox itself may be split into sections (priority inbox, multiple inboxes) that don't page as one.
 */
const listUrl = (account, days, page) => `https://mail.google.com/mail/u/${account}/#search/in%3Ainbox+newer_than%3A${days}d${page > 1 ? `/p${page}` : ""}`;
const isGmail = (u) => /^https:\/\/mail\.google\.com\/mail\//i.test(u);
const isLogin = (u) => /accounts\.google\.com|ServiceLogin|signin/i.test(u);

// ---------------------------------------------------------------------------
// Dates: the date cell's tooltip — "Fri, Oct 9, 2026, 3:45 PM" or "Fr., 9. Okt. 2026, 15:45"
// ---------------------------------------------------------------------------

const MONTHS = {
  januar: 1, january: 1, jan: 1, jän: 1, februar: 2, february: 2, feb: 2, "märz": 3, maerz: 3, march: 3, mar: 3, mär: 3,
  april: 4, apr: 4, mai: 5, may: 5, juni: 6, june: 6, jun: 6, juli: 7, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, oktober: 10, october: 10, okt: 10, oct: 10, november: 11, nov: 11,
  dezember: 12, december: 12, dez: 12, dec: 12,
};

function parseTitle(title) {
  const t = String(title || "").replace(/\u202f|\u00a0/g, " ");
  const year = /\b(20\d{2})\b/.exec(t)?.[1];
  const mon = /\b([A-Za-zÄÖÜäöüß]{3,9})\.?\s/.exec(t.replace(/^[A-Za-zÄÖÜäöüß]{2,4}\.?,\s*/, ""));
  const month = mon ? MONTHS[mon[1].toLowerCase()] : undefined;
  // "9. Okt." (day before) or "Oct 9," (day after)
  const day = /(\d{1,2})\.\s*[A-Za-zÄÖÜäöüß]{3,9}/.exec(t)?.[1] ?? /[A-Za-z]{3,9}\.?\s+(\d{1,2}),/.exec(t)?.[1];
  const tm = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(t);
  if (!year || !month || !day) return null;
  let h = tm ? +tm[1] : 12;
  if (tm?.[3]) h = (h % 12) + (/pm/i.test(tm[3]) ? 12 : 0);
  return new Date(+year, month - 1, +day, h, tm ? +tm[2] : 0).toISOString();
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/** Runs IN the Gmail tab: the inbox rows shown, as they read (none opened). */
function readRows() {
  // Gmail keeps views it left (hidden) in the page: only the rows shown.
  return [...document.querySelectorAll("tr.zA")]
    .filter((r) => r.offsetParent !== null)
    .map((r) => {
      const who = r.querySelector("span[email]");
      const subject = r.querySelector(".bog")?.textContent?.trim() || "";
      const snippet = (r.querySelector(".y2")?.textContent || "").replace(/^\s*[-–]\s*/, "").trim();
      const dateEl = r.querySelector("td.xW span[title], td.xW [title]") || r.querySelector("span[title]");
      const thread = r.querySelector("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id") || r.querySelector("[data-thread-id]")?.getAttribute("data-thread-id")?.replace(/^#?thread-f:/, "") || "";
      return {
        thread,
        from: who?.getAttribute("name") || who?.textContent?.trim() || "",
        fromEmail: who?.getAttribute("email") || null,
        subject,
        preview: snippet,
        title: dateEl?.getAttribute("title") || "",
        unread: r.classList.contains("zE"),
      };
    });
}

async function gmailPage(browser, { openIfMissing, account }) {
  const context = browser.contexts()[0];
  if (!context) throw new ChromeConnectError("The automation Chrome has no window open.");
  let page = context.pages().find((p) => isGmail(p.url())) ?? context.pages().find((p) => isLogin(p.url()) && /google/i.test(p.url()));
  if (!page) {
    if (!openIfMissing) throw new Error(`Gmail isn't open in the automation Chrome — open ${inboxUrl(account)} there (or press Sync on Zeff's Nachrichten page).`);
    page = await context.newPage();
    await page.goto(inboxUrl(account), { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => debug(`opening Gmail: ${e}`));
  }
  return page;
}

const EMPTY = /keine Konversationen|no conversations|Posteingang ist leer|inbox is empty|keine Nachrichten entsprechen|no messages matched/i;

/**
 * One list page shown: its rows — once Gmail has rendered THEM (not the last page's still: its first
 * row is another), or says there are none. A page that stays the last one: the list's end.
 */
async function listPage(page, url, before) {
  if (page.url() !== url) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => debug(`${url}: ${e}`));
  for (let i = 0; i < 40; i++) {
    if (isLogin(page.url())) throw new Error("Gmail shows Google's sign-in — sign in in the automation Chrome, then sync again.");
    const rows = await page.evaluate(readRows).catch(() => []);
    if (rows.length && rows[0].thread !== before) return rows;
    const empty = await page
      .evaluate((re) => [...document.querySelectorAll('div[role="main"]')].some((m) => m.offsetParent !== null && new RegExp(re, "i").test(m.textContent || "")), EMPTY.source)
      .catch(() => false);
    if (empty) return [];
    await new Promise((r) => setTimeout(r, 750));
  }
  if (before) return []; // still the last page: there's no further one
  throw new Error("Gmail's mail list didn't show (still loading?).");
}

/** The account's number as Gmail shows it (an address resolved by going to it) — signed out: Google's sign-in. */
async function accountNumber(page, account) {
  if (/^\d+$/.test(String(account))) return String(account);
  await page.goto(inboxUrl(account), { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => debug(`account ${account}: ${e}`));
  for (let i = 0; i < 40; i++) {
    if (isLogin(page.url())) throw new Error(`Gmail shows Google's sign-in for ${account} — sign in to that account in the automation Chrome, then sync again.`);
    const n = /\/mail\/u\/(\d+)\//.exec(page.url())?.[1];
    if (n) return n;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Gmail didn't open ${account}'s mailbox.`);
}

async function gmailMail({ days = 3, maxPages = 10, account = 0, folder = "Gmail", openIfMissing = false, launch = openIfMissing } = {}) {
  const span = Math.min(120, Math.max(1, Math.round(Number(days) || 3)));
  const since = Date.now() - span * 864e5;
  const browser = await connectToChrome(CDP, { launchUrls: launch ? [inboxUrl(account)] : [] });
  try {
    const page = await gmailPage(browser, { openIfMissing: !!openIfMissing, account });
    const n = await accountNumber(page, account);
    const messages = [];
    const seen = new Set();
    let before = null;
    for (let p = 1; p <= Math.min(30, Math.max(1, Number(maxPages) || 10)); p++) {
      const rows = await listPage(page, listUrl(n, span, p), before);
      if (!rows.length) break;
      before = rows[0].thread;
      let older = false;
      let fresh = 0;
      for (const r of rows) {
        const at = parseTitle(r.title);
        if (at && Date.parse(at) < since) {
          older = true;
          continue;
        }
        const id = r.thread || `${r.from}|${r.subject}|${r.title}`;
        if (seen.has(id) || !r.subject) continue;
        seen.add(id);
        fresh++;
        messages.push({ convId: `gmail:${id}`, folder, from: r.from, fromEmail: r.fromEmail, subject: r.subject, preview: r.preview, receivedAt: at, unread: r.unread });
      }
      debug(`page ${p}: ${rows.length} rows, ${messages.length} kept`);
      // The list is newest first: once older ones show, the rest are older too; nothing new: its end.
      if (older || !fresh || rows.length < 20) break;
    }
    // Back to the inbox's first page, as you'd expect to find it.
    if (page.url() !== inboxUrl(n)) await page.goto(inboxUrl(n), { waitUntil: "domcontentloaded" }).catch(() => {});
    return JSON.stringify({ messages });
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * The Google accounts signed in in the automation Chrome — Google's own account list (what its
 * account switcher shows), read with the browser's session: address, name, Gmail's number (u/N).
 * Read-only; nothing opened, Chrome not started.
 */
async function gmailAccounts() {
  const browser = await connectToChrome(CDP, {});
  try {
    const ctx = browser.contexts()[0];
    if (!ctx) throw new ChromeConnectError("The automation Chrome has no window open.");
    const r = await ctx.request.get("https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&mo=1&origin=https://mail.google.com", { timeout: 20000 });
    const text = await r.text();
    // window.parent.postMessage('<the list, escaped>', …)
    const raw = /postMessage\('(.*?)',\s*'/s.exec(text)?.[1];
    if (!raw) return JSON.stringify({ accounts: [] });
    const json = raw.replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, "/");
    const list = JSON.parse(json)?.[1] ?? [];
    const accounts = list
      .filter((a) => Array.isArray(a) && typeof a[3] === "string" && a[3].includes("@"))
      .map((a, i) => ({ email: a[3].toLowerCase(), name: typeof a[2] === "string" ? a[2] : "", number: i }));
    return JSON.stringify({ accounts });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function gmailStatus() {
  let browser;
  try {
    browser = await connectToChrome(CDP, {});
  } catch (e) {
    return JSON.stringify({ chrome: false, signedIn: false, message: String(e?.message || e) });
  }
  try {
    const pages = browser.contexts()[0]?.pages() ?? [];
    const gm = pages.find((p) => isGmail(p.url()));
    return JSON.stringify({ chrome: true, open: !!gm, signedIn: !!gm && !isLogin(gm.url()) });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio server (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

const TOOLS = [
  { name: "gmail_status", description: "Check whether Chrome (with the debug port) is reachable and Gmail is signed in.", inputSchema: { type: "object", properties: {} } },
  { name: "gmail_accounts", description: "The Google accounts signed in in the automation Chrome (address, name, Gmail's account number) — read-only. Returns JSON { accounts }.", inputSchema: { type: "object", properties: {} } },
  {
    name: "gmail_mail",
    description: "Read the inbox's mails of the last days from Gmail on the web — read-only: reads the mail list as shown (sender, subject, snippet, time, unread), page by page; opens no mail, marks nothing read. Returns JSON { messages }.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back (default 3, at most 120)." },
        maxPages: { type: "number", description: "At most this many list pages (default 10, at most 30)." },
        account: { type: ["number", "string"], description: "Gmail's account: its number (mail/u/<n>, default 0) or its address." },
        folder: { type: "string", description: "The folder Zeff keeps its mails in (default \"Gmail\")." },
        openIfMissing: { type: "boolean", description: "Open Gmail in the automation Chrome when it isn't (default false)." },
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
  if (method === "initialize") return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "gmail", version: "0.1.0" } });
  if (method === "notifications/initialized") return;
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      if (name === "gmail_status") return ok(id, textResult(await gmailStatus()));
      if (name === "gmail_accounts") return ok(id, textResult(await gmailAccounts()));
      if (name === "gmail_mail") return ok(id, textResult(await withTabLock("Gmail", name, () => gmailMail(args), debug)));
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
