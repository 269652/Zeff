#!/usr/bin/env node
/**
 * outlook-mcp — a stdio MCP server that reads your Outlook calendar for Zeff with Playwright,
 * deterministically (no LLM) and read-only. It ATTACHES to the automation Chrome (the one
 * Roar/TimO use; default http://127.0.0.1:9222, override with OUTLOOK_CDP_ENDPOINT), where
 * your Microsoft session signs Outlook on the web in — no password is ever handled here.
 *
 * Tools:
 *   outlook_status                   -> is Chrome reachable, is Outlook's calendar signed in
 *   outlook_events {weekStartIsos}   -> each week's events, read from Outlook's week view
 *   outlook_mail {days}              -> the inbox's mails of the last days, read from the mail
 *                                       list (sender, subject, preview, time, unread) in a mail
 *                                       tab of its own — no mail is opened (none marked read)
 *                                       (its own previous/next week buttons); changes nothing
 *   outlook_attachments {ref}        -> one mail's attachments (name, size), the mail opened by its id in a
 *                                       tab of its own (see the Attachments section: may mark an unread one read)
 *   outlook_download {ref, ids, dir} -> those attachments saved into dir
 *
 * Events come out Graph-shaped by the same extractor as the bookmarklet
 * (src/lib/calendar/owa-extractor.mjs), so already-booked meetings match up.
 */
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { OWA_EXTRACTOR } from "../../lib/calendar/owa-extractor.mjs";
import { mimeOfName } from "../../lib/mail/mime.mjs";
import { connectToChrome, ChromeConnectError, withTabLock } from "../../../scripts/chrome-cdp.mjs";

const CDP = process.env.OUTLOOK_CDP_ENDPOINT || process.env.ROAR_CDP_ENDPOINT || "http://127.0.0.1:9222";
const OUTLOOK_URL = "https://outlook.office.com/calendar/view/week";
const log = (...a) => process.stderr.write(`[outlook-mcp] ${a.join(" ")}\n`);
/** Step-by-step logging when OUTLOOK_DEBUG is set. */
const debug = (...a) => process.env.OUTLOOK_DEBUG && log(...a);

const PREV_WEEK = /vorherigen woche|previous week/i;
const NEXT_WEEK = /nächsten woche|next week/i;

const isLoginUrl = (u) => /login\.microsoftonline\.com|login\.live\.com|login\.windows\.net/i.test(u);
const isOutlookCalendar = (u) => /^https:\/\/outlook\.(office\.com|office365\.com|cloud\.microsoft)\/calendar/i.test(u);

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
function addDaysIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return isoOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

const MONTHS = {
  januar: 1, january: 1, jan: 1, februar: 2, february: 2, feb: 2, "märz": 3, maerz: 3, march: 3, mar: 3,
  april: 4, apr: 4, mai: 5, may: 5, juni: 6, june: 6, jun: 6, juli: 7, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, oktober: 10, october: 10, okt: 10, oct: 10, november: 11, nov: 11,
  dezember: 12, december: 12, dez: 12, dec: 12,
};
const monthOf = (s) => (s ? MONTHS[s.toLowerCase().replace(/\.$/, "")] : undefined);

/**
 * The first day of a week range as Outlook writes it: "21–27 September, 2026",
 * "28 September – 04 Oktober, 2026" (day first), or "September 21–27, 2026" / "September 28 –
 * October 4, 2026". A range across New Year carries the end's year ("28 Dezember – 03 Januar,
 * 2027"), so a start month after the end month belongs to the year before.
 */
function rangeStart(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  let m = /(\d{1,2})\.?\s*([A-Za-zÄÖÜäöü]+\.?)?\s*[–-]\s*(\d{1,2})\.?\s*([A-Za-zÄÖÜäöü]+\.?),?\s*(\d{4})/.exec(t);
  if (m && monthOf(m[4])) {
    const end = monthOf(m[4]);
    const start = monthOf(m[2]) ?? end;
    return isoOf(start > end ? Number(m[5]) - 1 : Number(m[5]), start, Number(m[1]));
  }
  m = /([A-Za-z]+\.?)\s+(\d{1,2})\s*[–-]\s*(?:([A-Za-z]+\.?)\s+)?(\d{1,2}),?\s*(\d{4})/.exec(t);
  if (m && monthOf(m[1])) {
    const start = monthOf(m[1]);
    const end = monthOf(m[3]) ?? start;
    return isoOf(start > end ? Number(m[5]) - 1 : Number(m[5]), start, Number(m[2]));
  }
  return null;
}

// ---------------------------------------------------------------------------
// The Outlook tab
// ---------------------------------------------------------------------------

/** The week navigation buttons' labels: "Zur vorherigen Woche wechseln: 21–27 September, 2026". */
async function weekButtonLabels(page) {
  return page
    .evaluate(() => {
      const labels = [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || "");
      return {
        prev: labels.find((l) => /vorherigen woche|previous week/i.test(l)) || null,
        next: labels.find((l) => /nächsten woche|next week/i.test(l)) || null,
      };
    })
    .catch(() => ({ prev: null, next: null }));
}

/** The Monday of the week Outlook shows: the previous week's start + 7 days (or the next week's − 7). */
async function shownWeek(page) {
  const { prev, next } = await weekButtonLabels(page);
  const p = prev && rangeStart(prev.split(":").slice(1).join(":"));
  if (p) return addDaysIso(p, 7);
  const n = next && rangeStart(next.split(":").slice(1).join(":"));
  return n ? addDaysIso(n, -7) : null;
}

async function clickButton(page, re) {
  const handle = await page.evaluateHandle(
    (src) => [...document.querySelectorAll("button")].find((b) => new RegExp(src, "i").test(b.getAttribute("aria-label") || "")) || null,
    re.source,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`Outlook's “${re.source}” button wasn't found.`);
  await el.click();
}

/** Find the Outlook calendar tab, or open one, in week view; fail clearly when not signed in. */
async function getCalendarPage(browser) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  let page = pages.find((p) => isOutlookCalendar(p.url()));
  if (!page) page = await (browser.contexts()[0] || (await browser.newContext())).newPage();
  if (!/\/calendar\/view\/week/i.test(page.url())) {
    await page.goto(OUTLOOK_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  }
  for (let i = 0; i < 80; i++) {
    if (isLoginUrl(page.url())) {
      throw new Error("Outlook isn't signed in — sign in to Outlook in the automation Chrome window, then sync again.");
    }
    if (await shownWeek(page)) return page;
    await page.waitForTimeout(500);
  }
  throw new Error("Outlook's calendar week view didn't load — open it in the automation Chrome window and try again.");
}

/** Page with Outlook's own previous/next week buttons until it shows the week of `target`. */
async function goToWeek(page, target) {
  for (let i = 0; i < 120; i++) {
    const cur = await shownWeek(page);
    debug(`showing ${cur}, want ${target}`);
    if (!cur) throw new Error("Couldn't read which week Outlook shows.");
    if (cur === target) return;
    await clickButton(page, target < cur ? PREV_WEEK : NEXT_WEEK);
    for (let k = 0; k < 40 && (await shownWeek(page)) === cur; k++) await page.waitForTimeout(250);
  }
  throw new Error(`Couldn't reach the week of ${target} in Outlook.`);
}

/**
 * Wait until the shown week's grid has rendered: its labels (time slots and events) name a
 * day of the week and don't change for three polls. Gives up after 15 s and reads anyway.
 */
async function settle(page, weekStartIso) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStartIso, i));
  const t0 = Date.now();
  let last = null;
  let stable = 0;
  while (Date.now() - t0 < 15000) {
    const s = await page
      .evaluate(() => {
        const M = { Januar: 1, Februar: 2, "März": 3, April: 4, Mai: 5, Juni: 6, Juli: 7, August: 8, September: 9, Oktober: 10, November: 11, Dezember: 12 };
        const labels = [...document.querySelectorAll("[aria-label]")]
          .map((e) => e.getAttribute("aria-label") || "")
          .filter((l) => l.length < 400 && /\d{1,2}:\d{2}\s*(?:bis|to)|ganztä|all day/i.test(l));
        const dates = new Set();
        for (const l of labels) {
          for (const m of l.matchAll(/(\d{1,2})\.\s*(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*(\d{4})/g)) {
            dates.add(`${m[3]}-${String(M[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}`);
          }
        }
        return { sig: labels.join("|"), dates: [...dates] };
      })
      .catch(() => null);
    if (s && s.dates.some((d) => days.includes(d))) {
      stable = s.sig === last ? stable + 1 : 0;
      last = s.sig;
      if (stable >= 2) {
        debug(`week of ${weekStartIso} settled after ${Date.now() - t0} ms`);
        return true;
      }
    }
    await page.waitForTimeout(400);
  }
  log(`week of ${weekStartIso} didn't settle in 15 s — reading it anyway`);
  return false;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

async function connect() {
  return connectToChrome(CDP, { launchUrls: [OUTLOOK_URL] });
}

async function outlookStatus() {
  let browser;
  try {
    browser = await connect();
  } catch (e) {
    if (e instanceof ChromeConnectError) return e.message;
    return `Cannot reach Chrome on ${CDP}. Zeff starts it from Menu → Sign-ins (checkout: npm run roar:chrome); sign in to Outlook. (${String(e).slice(0, 120)})`;
  }
  try {
    const page = await getCalendarPage(browser);
    return `Connected. Outlook's calendar is open and signed in (showing the week of ${await shownWeek(page)}).`;
  } catch (e) {
    return String(e?.message || e);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Each week's events (read-only): open the calendar's week view, go to the earliest week,
 * then step forward week by week, reading each once it has rendered. Returns JSON
 * { weeks: [{ weekStartIso, events }] }, events Graph-shaped (see owa-extractor.mjs).
 */
async function outlookEvents({ weekStartIsos }) {
  const targets = [...new Set(Array.isArray(weekStartIsos) ? weekStartIsos.map(String) : [])].sort();
  if (!targets.length || targets.some((w) => !/^\d{4}-\d{2}-\d{2}$/.test(w))) {
    throw new Error("weekStartIsos (Mondays as YYYY-MM-DD) is required.");
  }
  const browser = await connect();
  try {
    const page = await getCalendarPage(browser);
    const weeks = [];
    for (const week of targets) {
      await goToWeek(page, week);
      await settle(page, week);
      const days = Array.from({ length: 7 }, (_, i) => addDaysIso(week, i));
      const events = await page.evaluate(`(function(){${OWA_EXTRACTOR}; return events;})()`);
      weeks.push({ weekStartIso: week, events: events.filter((e) => days.includes(String(e?.start?.dateTime || "").slice(0, 10))) });
      debug(`week of ${week}: ${weeks.at(-1).events.length} events`);
    }
    // Leave the calendar on today's week, as you'd expect to find it.
    await clickButton(page, /^zu .heute|^go to today|^today/i).catch(() => {});
    return JSON.stringify({ weeks });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Mail (read-only: the inbox's list as it's shown — nothing opened, nothing marked read)
// ---------------------------------------------------------------------------

const MAIL_URL = "https://outlook.office.com/mail/inbox";
const isOutlookMail = (u) => /^https:\/\/outlook\.(office\.com|office365\.com|cloud\.microsoft)\/mail/i.test(u);

/** The mail tab (its own, beside the calendar's), opened when asked and there is none; a sign-in page stops it. */
async function mailPage(browser, { openIfMissing }) {
  const context = browser.contexts()[0];
  if (!context) throw new ChromeConnectError("The automation Chrome has no window open.");
  let page = context.pages().find((p) => isOutlookMail(p.url())) ?? context.pages().find((p) => isLoginUrl(p.url()) && /outlook/i.test(p.url()));
  if (!page) {
    if (!openIfMissing) throw new Error(`Outlook's mail isn't open in the automation Chrome — open ${MAIL_URL} there (or press Sync on Zeff's Messages page).`);
    page = await context.newPage();
    await page.goto(MAIL_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => debug(`opening mail: ${e}`));
  }
  for (let i = 0; i < 40; i++) {
    if (isLoginUrl(page.url())) throw new Error("Outlook shows its sign-in page — sign in in the automation Chrome, then sync again.");
    if (await page.locator('[role="option"][data-convid]').count()) return page;
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error("Outlook's mail list didn't show (still loading, or an empty inbox?).");
}

/** When a row's time column says it came: "14:39" (today), "Mo. 14:39" / "Gestern" (this week), "05.10.2026", "10/5/2026". */
function receivedAt(text, now = new Date()) {
  const t = String(text || "").trim();
  let m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2]).toISOString();
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/.exec(t);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
    return new Date(y, +m[2] - 1, +m[1], 12, 0).toISOString();
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
  if (m) return new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2], 12, 0).toISOString();
  const days = { so: 0, sun: 0, mo: 1, mon: 1, di: 2, tue: 2, mi: 3, wed: 3, do: 4, thu: 4, fr: 5, fri: 5, sa: 6, sat: 6 };
  m = /^(gestern|yesterday|[a-z]{2,3})\.?,?\s*(?:(\d{1,2}):(\d{2}))?/i.exec(t);
  if (m) {
    const word = m[1].toLowerCase();
    const back = /gestern|yesterday/.test(word) ? 1 : word in days ? (now.getDay() - days[word] + 7) % 7 || 7 : null;
    if (back !== null) return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, m[2] ? +m[2] : 12, m[3] ? +m[3] : 0).toISOString();
  }
  return null;
}

/** Runs IN the mail tab: the rows the list has rendered, as they read. */
function readRows() {
  return [...document.querySelectorAll('[role="option"][data-convid]')].map((r) => {
    // Its text lines, without the icon glyph line: sender, subject, preview (one or more lines), time.
    const lines = (r.innerText || "")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => /[\p{L}\p{N}]/u.test(s));
    const email = [...r.querySelectorAll("[title]")].map((e) => e.getAttribute("title")).find((t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t || "")) || null;
    return {
      convId: r.getAttribute("data-convid"),
      // The row's own id: one per message (a conversation's mails share data-convid).
      rowId: r.getAttribute("id") || null,
      from: lines[0] || "",
      fromEmail: email,
      subject: lines[1] || "",
      preview: lines.slice(2, -1).join(" ").slice(0, 1000),
      timeText: lines[lines.length - 1] || "",
      unread: /^(Ungelesen|Unread)\b/i.test(r.getAttribute("aria-label") || ""),
      // The paperclip: a glyph (U+E1BB) of Fluent's icon font that only rows with attachments carry.
      attach: [...r.querySelectorAll("i")].some((e) => (e.textContent || "").includes(String.fromCodePoint(0xe1bb))),
    };
  });
}

/**
 * The inbox's mails of the last `days` (read-only): the list read as shown, scrolled further till
 * it's older than that (at most ~300 rows), then back to the top. Returns JSON { messages }.
 */
/** The inbox, however Outlook names it. */
const INBOX = /^(posteingang|inbox)$/i;

/**
 * Open a folder of the mail tab by its name, as the folder list shows it ("Posteingang",
 * "Notifications") — a click on it in the list (that marks nothing read). True once its mails show.
 */
async function openFolder(page, name) {
  const want = String(name).trim().toLowerCase();
  const found = await page.evaluate((w) => {
    const items = [...document.querySelectorAll('[role="treeitem"]')];
    const label = (t) => (t.getAttribute("title") || t.getAttribute("aria-label") || t.innerText || "").split("\n")[0].trim();
    // "Notifications - 3.510 Elemente (474 ungelesen)": the name before its counts.
    const nameOf = (t) => label(t).replace(/\s+-\s+[\d.,]+\s+(Elemente?|items?).*$/i, "").trim().toLowerCase();
    const inbox = /^(posteingang|inbox)$/;
    const hit = items.find((t) => nameOf(t) === w || (inbox.test(w) && inbox.test(nameOf(t))));
    if (!hit) return false;
    hit.scrollIntoView({ block: "center" });
    (hit.querySelector('[role="button"], button, span') || hit).click();
    return true;
  }, want);
  if (!found) return false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await page.locator('[role="option"][data-convid]').count()) return true;
  }
  return true; // an empty folder
}

/**
 * Scroll the mail list by `dy` pixels with the mouse wheel over it — Outlook's list scrolls
 * virtually (its container's scrollTop stays 0 and ignores scripted scrolling), and renders only
 * the rows in view.
 */
async function wheelList(page, dy) {
  // The middle of the list's visible area (its scrolling container) — not a row: the first rendered
  // row can lie outside the view, and a wheel there misses the list.
  const at = await page.evaluate(() => {
    const row = document.querySelector('[role="option"][data-convid]');
    let el = row && row.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    const r = (el || row)?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 200) } : null;
  });
  if (!at) return;
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, dy);
}

/** Back to the list's top (the newest): wheel steps up till its first row stays the same (a huge single step is ignored). */
async function listToTop(page) {
  const firstRow = () => page.evaluate(() => document.querySelector('[role="option"][data-convid]')?.getAttribute("id") ?? "");
  let before = null;
  let same = 0;
  for (let i = 0; i < 80; i++) {
    await wheelList(page, -3000).catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    const now = await firstRow();
    // At the top once it stays the same a few times over (the list renders a moment late).
    same = now === before ? same + 1 : 0;
    if (same >= 3) break;
    before = now;
  }
}

/** One folder's mails since `since`: the list read as shown, scrolled further till it's older than that (at most ~1000 rows). */
async function readFolder(page, since, folder) {
  // From the top (the newest), wherever the list was left.
  await listToTop(page);
  await new Promise((r) => setTimeout(r, 600));
  const seen = new Map();
  let still = 0;
  for (let i = 0; i < 600 && seen.size < 1000; i++) {
    const before = seen.size;
    const rows = await page.evaluate(readRows);
    // Each message once — by its row (not its conversation: a ticket's notifications share one).
    for (const r of rows) {
      const id = r.rowId || `${r.convId}|${r.timeText}|${r.subject}|${r.preview.slice(0, 80)}`;
      if (r.convId && !seen.has(id)) seen.set(id, { ...r, folder, receivedAt: receivedAt(r.timeText) });
    }
    // Far enough: the list's bottom row (it's newest first) is older than asked — not just any row
    // (a pinned one at the top can be old).
    const bottom = [...rows].reverse().map((r) => receivedAt(r.timeText)).find(Boolean);
    if (bottom && Date.parse(bottom) < since) break;
    still = seen.size === before ? still + 1 : 0;
    if (still >= 4) break; // the end of the list
    // Less than what's in view (~11 rows), so no row is skipped.
    await wheelList(page, 280);
    await new Promise((r) => setTimeout(r, 450));
  }
  await listToTop(page);
  return [...seen.values()].filter((r) => !r.receivedAt || Date.parse(r.receivedAt) >= since);
}

/**
 * The mails of the last `days` in these folders (read-only; default: the inbox) — each folder
 * opened in the mail tab's folder list, its list read as shown; then back to the inbox. Returns
 * JSON { messages, missing } (missing: folders the list doesn't have).
 */
async function outlookMail({ days = 3, folders, openIfMissing = false, launch = openIfMissing } = {}) {
  const since = Date.now() - Math.min(120, Math.max(1, Number(days) || 3)) * 864e5;
  const names = (Array.isArray(folders) && folders.length ? folders : ["Posteingang"]).map((f) => String(f).trim()).filter(Boolean);
  const browser = await connectToChrome(CDP, { launchUrls: launch ? [MAIL_URL] : [] });
  try {
    const page = await mailPage(browser, { openIfMissing: !!openIfMissing });
    const watch = watchItems(page);
    const messages = [];
    const missing = [];
    for (const name of names) {
      if (!(await openFolder(page, name))) {
        missing.push(name);
        continue;
      }
      const got = await readFolder(page, since, INBOX.test(name) ? "Posteingang" : name);
      debug(`${name}: ${got.length} mails`);
      // The list's first page was fetched before we listened: one reload gives those their message ids.
      if (got.some((r) => r.attach && !itemOf(watch.items, r))) {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => debug(`reload: ${e}`));
        for (let i = 0; i < 20 && got.some((r) => r.attach && !itemOf(watch.items, r)); i++) await new Promise((r) => setTimeout(r, 500));
      }
      messages.push(...got.map(({ attach, ...r }) => ({ ...r, hasAttachments: attach || !!itemOf(watch.items, r), ...(itemOf(watch.items, r) ? { attachRef: itemOf(watch.items, r) } : {}) })));
    }
    watch.stop();
    // Leave it on the inbox, as you'd expect to find it.
    await openFolder(page, "Posteingang").catch(() => {});
    return JSON.stringify({ messages, missing });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Attachments. Verified live (on read mails): the list marks a mail with attachments by a paperclip
// glyph in its row (U+E1BB of Fluent's icon font) and Outlook's own FindItem answers say
// HasAttachments with the item's id; a mail opened by its id (/mail/deeplink/read/<id>) lists its
// attachments as cards (role=listbox "Dateianlagen"), each with a "more actions" menu whose
// "Herunterladen" fires a browser download. UNVERIFIED: whether opening an UNREAD mail marks it
// read there (Zeff skips unread mails unless told otherwise) and the "mark as unread" restore.
// ---------------------------------------------------------------------------

const fileSafe = (name) => (String(name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 120) || "file");

/** "91 KB", "1,2 MB", "3.5 MB", "512 Bytes" → bytes (0: unknown). */
function sizeBytes(text) {
  const m = /([\d.,]+)\s*(bytes?|b|kb|mb|gb)\b/i.exec(String(text || ""));
  if (!m) return 0;
  const n = Number(m[1].replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  const unit = m[2].toLowerCase();
  return Math.round(n * (unit.startsWith("g") ? 1024 ** 3 : unit.startsWith("m") ? 1024 ** 2 : unit.startsWith("k") ? 1024 : 1));
}

/**
 * Listens to the list's own answers (FindItem) on a mail tab: the items they carry by id —
 * with HasAttachments and the conversation — so a row can be given its message's id.
 */
function watchItems(page) {
  const items = new Map();
  const on = async (r) => {
    try {
      if (!/action=FindItem/.test(r.request().url())) return;
      const j = JSON.parse(await r.text());
      for (const m of j?.Body?.ResponseMessages?.Items ?? []) for (const it of m?.RootFolder?.Items ?? []) if (it?.ItemId?.Id) items.set(it.ItemId.Id, it);
    } catch {
      // not a JSON answer: nothing to learn from it
    }
  };
  page.on("response", on);
  return { items, stop: () => page.off("response", on) };
}

/** A row's message with attachments among the items seen: the one with its subject, else the newest. */
function itemOf(items, row) {
  const mine = [...items.values()].filter((i) => i.ConversationId?.Id === row.convId && i.HasAttachments);
  const same = mine.filter((i) => String(i.Subject || "").trim() === String(row.subject).trim());
  const pick = (same.length ? same : mine).sort((a, b) => String(b.DateTimeReceived).localeCompare(String(a.DateTimeReceived)))[0];
  return pick?.ItemId?.Id;
}

const ATTACHMENTS_LIST = /anlage|attachment/i;

/** Runs IN a message tab: its attachment cards (name, size) as listed. */
function readCards(re) {
  const box = [...document.querySelectorAll('[role="listbox"]')].find((e) => new RegExp(re, "i").test(e.getAttribute("aria-label") || ""));
  if (!box) return null;
  return [...box.querySelectorAll('[role="option"]')].map((o) => {
    const lines = (o.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
    return { name: lines[0] || "", sizeText: lines.find((l, i) => i > 0 && /\d\s*(bytes?|kb|mb|gb)\b/i.test(l)) || "" };
  });
}

/** A mail opened by its id in a tab of its own: that tab and the attachment cards it lists. The caller closes the tab. */
async function openMessage(browser, itemId) {
  if (!itemId) throw new Error("No message id for this mail (the list didn't give one).");
  const context = browser.contexts()[0];
  if (!context) throw new ChromeConnectError("The automation Chrome has no window open.");
  const origin = new URL(context.pages().find((p) => isOutlookMail(p.url()))?.url() ?? "https://outlook.office.com/mail/").origin;
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/mail/deeplink/read/${encodeURIComponent(itemId)}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => debug(`opening a message: ${e}`));
    let cards = null;
    let stable = 0;
    let last = "";
    for (let i = 0; i < 50; i++) {
      if (isLoginUrl(page.url())) throw new Error("Outlook shows its sign-in page — sign in in the automation Chrome, then try again.");
      cards = await page.evaluate(readCards, ATTACHMENTS_LIST.source).catch(() => null);
      if (cards?.length) {
        // The cards are there; wait until their list stops changing.
        const sig = JSON.stringify(cards);
        stable = sig === last ? stable + 1 : 0;
        last = sig;
        if (stable >= 2) break;
      }
      await page.waitForTimeout(500);
    }
    return { page, cards: (cards ?? []).map((c, i) => ({ id: String(i + 1), name: c.name, size: sizeBytes(c.sizeText) })) };
  } catch (e) {
    await page.close().catch(() => {});
    throw e;
  }
}

/** Marks the opened mail unread again (the toolbar's or its "more" menu's entry). True when an entry was clicked. UNVERIFIED. */
async function markUnreadAgain(page) {
  const re = /als ungelesen markieren|mark as unread/i;
  try {
    const direct = page.getByRole("button", { name: re }).or(page.getByRole("menuitem", { name: re })).first();
    if (await direct.isVisible().catch(() => false)) {
      await direct.click({ timeout: 5000 });
      return true;
    }
    // In the toolbar's overflow menu ("Weitere Aktionen"), not a card's.
    const more = page.locator('button[aria-label="Weitere Aktionen"], button[aria-label="More actions"]').first();
    await more.click({ timeout: 5000 });
    await page.getByRole("menuitem", { name: re }).first().click({ timeout: 5000 });
    return true;
  } catch (e) {
    debug(`mark unread again: ${e?.message ?? e}`);
    return false;
  }
}

/**
 * One mail's attachments (read-only): the mail opened by its id in a tab of its own — which may mark
 * an UNREAD mail read there; with `restoreUnread` and `wasUnread` it is marked unread again afterwards
 * (a write, only then). Returns JSON { opened, wasUnread, restoredUnread, attachments }.
 */
async function outlookAttachments({ ref = "", wasUnread = false, restoreUnread = false } = {}) {
  const browser = await connectToChrome(CDP, {});
  try {
    const { page, cards } = await openMessage(browser, ref);
    try {
      const restored = wasUnread && restoreUnread ? await markUnreadAgain(page) : false;
      return JSON.stringify({ opened: true, wasUnread: !!wasUnread, restoredUnread: restored, attachments: cards.map((c) => ({ ...c, mime: mimeOfName(c.name), inline: false })) });
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

/** The chosen attachments of one mail saved into `dir` (each card's "more actions" → download). Returns JSON { opened, files, skipped, restoredUnread }. */
async function outlookDownload({ ref = "", ids = [], dir = "", maxBytes = 0, wasUnread = false, restoreUnread = false } = {}) {
  if (!dir) throw new Error("dir is required.");
  const browser = await connectToChrome(CDP, {});
  try {
    const { page, cards } = await openMessage(browser, ref);
    try {
      mkdirSync(dir, { recursive: true });
      const want = new Set((Array.isArray(ids) ? ids : []).map(String));
      const files = [];
      const skipped = [];
      for (const c of cards) {
        if (want.size && !want.has(c.id)) continue;
        if (maxBytes > 0 && c.size > maxBytes) {
          skipped.push({ id: c.id, why: "too large" });
          continue;
        }
        const card = page.locator('[role="listbox"]').filter({ has: page.locator('[role="option"]') }).locator('[role="option"]').nth(Number(c.id) - 1);
        try {
          await card.hover({ timeout: 5000 });
          await card.getByRole("button", { name: /weitere aktionen|more actions/i }).click({ timeout: 8000 });
          const waiting = page.waitForEvent("download", { timeout: 60000 });
          await page.getByRole("menuitem", { name: /herunterladen|download/i }).first().click({ timeout: 8000 });
          const dl = await waiting;
          const failure = await dl.failure();
          if (failure) throw new Error(failure);
          const name = dl.suggestedFilename() || c.name;
          const p = path.join(dir, `${c.id}-${fileSafe(name)}`);
          await dl.saveAs(p);
          files.push({ id: c.id, name, mime: mimeOfName(name), size: statSync(p).size, path: p });
        } catch (e) {
          skipped.push({ id: c.id, why: String(e?.message ?? e).slice(0, 120) });
          await page.keyboard.press("Escape").catch(() => {});
        }
      }
      const restored = wasUnread && restoreUnread ? await markUnreadAgain(page) : false;
      return JSON.stringify({ opened: true, wasUnread: !!wasUnread, restoredUnread: restored, files, skipped });
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio server (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "outlook_status",
    description: "Check whether Chrome (with the debug port) is reachable and Outlook's calendar is signed in.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "outlook_events",
    description:
      "Read the calendar events of the given weeks from Outlook on the web — read-only: pages through the week view, changes nothing. Returns JSON { weeks: [{ weekStartIso, events }] }.",
    inputSchema: {
      type: "object",
      properties: {
        weekStartIsos: { type: "array", items: { type: "string" }, description: "Mondays of the weeks, YYYY-MM-DD." },
      },
      required: ["weekStartIsos"],
    },
  },
  {
    name: "outlook_mail",
    description:
      "Read the inbox's mails of the last days from Outlook on the web — read-only: reads the mail list as shown (sender, subject, preview, time, unread) in a mail tab of its own; opens no mail, marks nothing read. Returns JSON { messages }.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back (default 3, at most 120)." },
        folders: { type: "array", items: { type: "string" }, description: 'Folders by name as Outlook\'s folder list shows them (default ["Posteingang"]; "Inbox" works too).' },
        openIfMissing: { type: "boolean", description: "Open Outlook's mail in the automation Chrome when it isn't (default false)." },
        launch: { type: "boolean", description: "Start the automation Chrome when it isn't running (default: as openIfMissing)." },
      },
    },
  },
  {
    name: "outlook_attachments",
    description:
      "The attachments of one Outlook mail (name, size, type): the mail is opened by its id in a tab of its own — that may mark an unread mail read; with wasUnread+restoreUnread it is marked unread again afterwards. Returns JSON { opened, wasUnread, restoredUnread, attachments }.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "The message id (attachRef of outlook_mail)." },
        wasUnread: { type: "boolean" },
        restoreUnread: { type: "boolean", description: "Mark it unread again when wasUnread." },
      },
      required: ["ref"],
    },
  },
  {
    name: "outlook_download",
    description: "Save attachments of one Outlook mail into a folder (each card's download). Returns JSON { opened, files: [{ id, name, mime, size, path }], skipped, restoredUnread }.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "The message id (attachRef of outlook_mail)." },
        ids: { type: "array", items: { type: "string" }, description: "Which attachments (ids of outlook_attachments); none: all." },
        dir: { type: "string", description: "The folder to save into (made if missing)." },
        maxBytes: { type: "number", description: "Skip files larger than this." },
        wasUnread: { type: "boolean" },
        restoreUnread: { type: "boolean" },
      },
      required: ["ref", "dir"],
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
    return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "outlook", version: "0.1.0" } });
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      if (name === "outlook_status") return ok(id, textResult(await outlookStatus()));
      if (name === "outlook_events") return ok(id, textResult(await withTabLock("Outlook", name, () => outlookEvents(args), debug)));
      if (name === "outlook_mail") return ok(id, textResult(await withTabLock("Outlook Mail", name, () => outlookMail(args), debug)));
      if (name === "outlook_attachments") return ok(id, textResult(await withTabLock("Outlook Mail", name, () => outlookAttachments(args), debug)));
      if (name === "outlook_download") return ok(id, textResult(await withTabLock("Outlook Mail", name, () => outlookDownload(args), debug)));
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
