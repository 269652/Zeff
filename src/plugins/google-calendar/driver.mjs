#!/usr/bin/env node
/**
 * gcal-mcp — a stdio MCP server that reads your Google Calendar for Zeff with Playwright,
 * deterministically (no LLM) and read-only. It ATTACHES to the automation Chrome (the account's —
 * GCAL_CDP_ENDPOINT, else ROAR_CDP_ENDPOINT, default http://127.0.0.1:9222), where your Google
 * session signs Calendar in — no password is ever handled here.
 *
 * How it reads: Google Calendar's week view in a fresh tab, week by week — the calendars in its
 * sidebar (name, colour, shown or not) and each appointment's chip, whose screen-reader line says
 * it all ("09:00 bis 17:00, Arbeit, Moritz Roessler, Kein Ort, 5. Oktober 2026") — then the tab is
 * closed. Nothing is opened, moved or answered: no appointment changes.
 *
 * Tools:
 *   gcal_status                     -> is Chrome reachable, is Google signed in
 *   gcal_events {account, weeks, from} -> the calendars and the appointments of those weeks
 */
import { connectToChrome, withTabLock } from "../../../scripts/chrome-cdp.mjs";

const CDP = process.env.GCAL_CDP_ENDPOINT || process.env.ROAR_CDP_ENDPOINT || "http://127.0.0.1:9222";
const log = (...a) => process.stderr.write(`[gcal-mcp] ${a.join(" ")}\n`);
const debug = (...a) => process.env.GCAL_DEBUG && log(...a);

const base = (account = 0) => (/^\d+$/.test(String(account)) ? `https://calendar.google.com/calendar/u/${account}` : `https://calendar.google.com/calendar/u/0`);
const authuser = (account) => (/^\d+$/.test(String(account)) ? "" : `?authuser=${encodeURIComponent(String(account))}`);
const weekUrl = (account, d) => `${base(account)}/r/week/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}${authuser(account)}`;
const isLogin = (u) => /accounts\.google\.com|ServiceLogin|signin/i.test(u);

const MONTHS = {
  januar: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
  january: 1, february: 2, march: 3, may: 5, june: 6, july: 7, october: 10, december: 12,
};
const two = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${two(m)}-${two(d)}`;
/** "5. Oktober 2026" / "October 5, 2026" → "2026-10-05". */
function dateOf(s) {
  let m = /^(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\s+(\d{4})$/.exec(s.trim());
  if (m && MONTHS[m[2].toLowerCase()]) return ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s.trim());
  if (m && MONTHS[m[1].toLowerCase()]) return ymd(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return null;
}
/** "9:00" / "9am" / "21:30" → "09:00". */
function timeOf(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|vorm\.|nachm\.)?$/i.exec(s.trim());
  if (!m) return null;
  let h = +m[1];
  if (/pm|nachm/i.test(m[3] || "") && h < 12) h += 12;
  if (/am|vorm/i.test(m[3] || "") && h === 12) h = 0;
  return `${two(h)}:${m[2] || "00"}`;
}
const nextDay = (day) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
};

/**
 * An appointment from its screen-reader line: when (a time span on a day, all day, or across days),
 * its title, where. Null: a shape not known (counted, not guessed).
 */
export function parseLine(line) {
  const parts = line.split(", ").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const last = dateOf(parts[parts.length - 1]);
  const head = parts[0];
  // Where: "Ort: …" / "Location: …" (Google names it so; "Kein Ort" when there's none).
  const where = parts.find((p) => /^(ort|location):\s/i.test(p))?.replace(/^(ort|location):\s*/i, "") ?? "";
  const place = () => where;
  let m;
  // "09:00 bis 17:00, Titel, …, Ort, 5. Oktober 2026"
  if ((m = /^(.+?)\s+(?:bis|to|–|-)\s+(.+)$/.exec(head)) && timeOf(m[1]) && timeOf(m[2]) && last) {
    const start = `${last}T${timeOf(m[1])}`;
    const endT = timeOf(m[2]);
    const end = endT <= timeOf(m[1]) ? `${nextDay(last)}T${endT}` : `${last}T${endT}`;
    return { start, end, allDay: false, title: parts[1], location: place() };
  }
  // "Ganztägig, Titel, …, 5. Oktober 2026"
  if (/^(ganztägig|all day)$/i.test(head) && last) return { start: last, end: nextDay(last), allDay: true, title: parts[1], location: place() };
  // "5. Oktober 2026 bis 7. Oktober 2026, Titel, …" (all day, several days) — or with times ("… um 22:00 bis … um 02:00")
  if ((m = /^(.+?)\s+(?:bis|to|–)\s+(.+)$/.exec(head))) {
    const at = (s) => {
      const t = /^(.+?)(?:,?\s+(?:um|at)\s+(.+))?$/.exec(s.trim());
      return t ? { day: dateOf(t[1]), time: t[2] ? timeOf(t[2]) : null } : null;
    };
    const a = at(m[1]);
    const b = at(m[2]);
    if (a?.day && b?.day) {
      if (a.time && b.time) return { start: `${a.day}T${a.time}`, end: `${b.day}T${b.time}`, allDay: false, title: parts[1], location: place() };
      return { start: a.day, end: nextDay(b.day), allDay: true, title: parts[1], location: place() };
    }
  }
  return null;
}

/** What one week view shows: its calendars and its appointment chips (id, line, colour). */
function readWeek() {
  // Base64 — Google cuts the calendar's part off mid-way: what decodes, as far as it does.
  const b64 = (s) => {
    let t = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    if (t.length % 4 === 1) t = t.slice(0, -1);
    let raw = "";
    try {
      raw = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
    } catch {
      return "";
    }
    try {
      return decodeURIComponent(escape(raw));
    } catch {
      return raw;
    }
  };
  const calendars = [...document.querySelectorAll('input[type="checkbox"]')]
    .map((c) => {
      const host = c.closest("[data-id]");
      return {
        id: host ? b64(host.getAttribute("data-id")) : "",
        name: c.getAttribute("aria-label") || "",
        color: (getComputedStyle(c.closest("li,div") || c).getPropertyValue("--gm3-checkbox-selected-container-color") || "").trim(),
        shown: c.checked,
      };
    })
    .filter((c) => c.id && c.name);
  const chips = new Map();
  for (const e of document.querySelectorAll('[data-eventid][role="button"]')) {
    const id = e.getAttribute("data-eventid");
    if (!id || chips.has(id) || id === "tasks_rollover_view") continue;
    const line = [...e.querySelectorAll("div")].map((d) => (d.textContent || "").trim()).find((t) => t.includes(", ") && /\d{4}$/.test(t)) || "";
    // The calendar: in the id ("<event> <calendar id>", base64 — the calendar's id may be cut off).
    const decoded = (id.startsWith("appt_") ? b64(id.split("_").pop()) : b64(id).split(" ").slice(1).join(" ")).replace(/[^!-~]+$/g, "").replace(/[^ -~]/g, "");
    chips.set(id, { id, line, calendar: decoded, color: e.style.borderColor || e.style.backgroundColor || "" });
  }
  return { url: location.href, calendars, chips: [...chips.values()] };
}

async function gcalEvents({ account = 0, weeks = 5, from = null, launch = false, timeoutMs = 45000 } = {}) {
  const browser = await connectToChrome(CDP, { launchUrls: launch ? [`${base(account)}/r/week`] : [] });
  const context = browser.contexts()[0];
  if (!context) throw new Error("The automation Chrome has no window open.");
  const page = await context.newPage();
  try {
    // From the Monday of the week before (what just was) — or the day asked for.
    const start = from ? new Date(`${from}T12:00:00`) : new Date();
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (from ? 0 : 7));
    const calendars = new Map();
    const events = new Map();
    let unparsed = 0;
    for (let w = 0; w < Math.max(1, Math.min(12, Number(weeks) || 5)); w++) {
      const d = new Date(start);
      d.setDate(d.getDate() + 7 * w);
      await page.goto(weekUrl(account, d), { waitUntil: "domcontentloaded", timeout: timeoutMs });
      if (isLogin(page.url())) throw new Error("Google Calendar: not signed in — sign in to Google in the automation Chrome.");
      await page.waitForSelector('input[type="checkbox"]', { timeout: timeoutMs }).catch(() => {});
      await page.waitForSelector('[data-eventid][role="button"]', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const r = await page.evaluate(readWeek);
      debug(`week ${d.toDateString()}: ${r.chips.length} chips`);
      for (const c of r.calendars) calendars.set(c.id, c);
      for (const c of r.chips) {
        const p = parseLine(c.line);
        if (!p) {
          if (c.line) unparsed++;
          debug(`unparsed: ${c.line}`);
          continue;
        }
        // Its calendar: by the id (cut off — its last letter may be half a byte, so not trusted), else by the name in its line.
        const all = [...calendars.values()];
        const cut = c.calendar.slice(0, -1);
        const named = c.line.split(", ")[2];
        const cal = all.find((x) => x.id === c.calendar) ?? (cut.length > 3 ? all.find((x) => x.id.startsWith(cut)) : null) ?? all.find((x) => x.name === named) ?? null;
        events.set(c.id, { key: c.id, calendarId: cal?.id ?? c.calendar ?? "", ...p });
      }
    }
    return JSON.stringify({ calendars: [...calendars.values()], events: [...events.values()], unparsed, from: start.toISOString().slice(0, 10) });
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function gcalStatus() {
  let browser;
  try {
    browser = await connectToChrome(CDP, {});
  } catch (e) {
    return JSON.stringify({ chrome: false, signedIn: false, message: String(e?.message || e) });
  }
  try {
    const ctx = browser.contexts()[0];
    if (!ctx) return JSON.stringify({ chrome: true, signedIn: false });
    const r = await ctx.request.get("https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&mo=1&origin=https://calendar.google.com", { timeout: 20000 }).catch(() => null);
    const signedIn = !!r && /@/.test(await r.text().catch(() => ""));
    return JSON.stringify({ chrome: true, signedIn });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio server (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

const TOOLS = [
  { name: "gcal_status", description: "Check whether Chrome (with the debug port) is reachable and Google is signed in.", inputSchema: { type: "object", properties: {} } },
  {
    name: "gcal_events",
    description:
      "Read Google Calendar — read-only: its week view in a fresh tab of the automation Chrome, week by week (from the week before), then the tab is closed. Returns JSON { calendars: [{id, name, color, shown}], events: [{key, calendarId, title, start, end, allDay, location}], unparsed, from } — local times.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: ["number", "string"], description: "Google's account: its number (u/<n>, default 0) or its address." },
        weeks: { type: "number", description: "How many weeks (default 5: the week before, this one, three ahead)." },
        from: { type: "string", description: "Start at the week of this day (YYYY-MM-DD) instead." },
        launch: { type: "boolean", description: "Start the automation Chrome when it isn't running (default false)." },
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
  if (method === "initialize") return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "google-calendar", version: "0.1.0" } });
  if (method === "notifications/initialized") return;
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      if (name === "gcal_status") return ok(id, textResult(await gcalStatus()));
      if (name === "gcal_events") return ok(id, textResult(await withTabLock("Google Calendar", name, () => gcalEvents(args), debug)));
      return ok(id, textResult(`Unknown tool "${name}".`, true));
    } catch (e) {
      log("tool error:", String(e));
      return ok(id, textResult(`Error: ${String(e?.message || e).slice(0, 300)}`, true));
    }
  }
  if (id !== undefined) ok(id, {});
}

if (!process.env.GCAL_NO_SERVER) {
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
