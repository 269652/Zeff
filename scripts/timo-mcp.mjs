#!/usr/bin/env node
/**
 * timo-mcp — a stdio MCP server that records a week of Zeff working time into TimO®
 * (https://ac.timo24.de) with Playwright, deterministically (no LLM). It ATTACHES to
 * your already-signed-in Chrome over the DevTools port (default http://127.0.0.1:9222),
 * the same one used for Roar, so the corporate session is reused.
 *
 * Tools:
 *   timo_status                    -> is Chrome reachable, is TimO open & signed in
 *   timo_export {days, dryRun}     -> for each day, open its calendar dialog and enter
 *                                     Kommen/Gehen (start/end); never finalizes/submits
 *
 * FIRST PASS: TimO is a complex ExtJS app; the day dialog also handles absences. This
 * fills the working-time span (hours_from/hours_to). Dry-run first to verify it reaches
 * each day before writing.
 */
import { chromium } from "playwright-core";

const CDP = process.env.ROAR_CDP_ENDPOINT || "http://127.0.0.1:9222";
const TIMO_URL = "https://ac.timo24.de/timo/index.jsp";
const log = (...a) => process.stderr.write(`[timo-mcp] ${a.join(" ")}\n`);

async function connect() {
  return chromium.connectOverCDP(CDP, { timeout: 8000 });
}

/** The TimO tab (its main frame is index.jsp). */
async function getTimoPage(browser) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  let page = pages.find((p) => p.url().includes("timo24.de"));
  if (!page) {
    const ctx = browser.contexts()[0] || (await browser.newContext());
    page = await ctx.newPage();
    await page.goto(TIMO_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  return page;
}
function mainFrame(page) {
  return page.frames().find((f) => f.url().includes("index.jsp")) || page.mainFrame();
}
function isLoginUrl(u) {
  return /login|signin|anmeld/i.test(u) && !/index\.jsp/i.test(u);
}

/** DD.MM.YYYY from an ISO date. */
function deDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Open the booking dialog for a given ISO date by clicking its calendar cell, then
 * confirming the dialog's "from" date matches. Returns the frame that holds the dialog.
 */
async function openDay(frame, iso) {
  const day = String(Number(iso.slice(8, 10)));
  const target = deDate(iso);
  // Click each calendar cell whose exact text is the day number until the dialog shows the date.
  const cells = frame.locator("td, a, div, span").filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) });
  const n = await cells.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 12); i++) {
    await cells.nth(i).click().catch(() => {});
    await frame.page().waitForTimeout(700);
    const from = await frame.locator('input[name="from"]').first().inputValue().catch(() => "");
    if (from === target) return true;
    // close a wrong dialog and try the next candidate
    await frame.getByText(/^Abbrechen$/i).first().click().catch(() => {});
    await frame.page().waitForTimeout(300);
  }
  return false;
}

async function readDialog(frame) {
  return frame.evaluate(() => {
    const g = (name) => { const el = document.querySelector(`input[name="${name}"],textarea[name="${name}"]`); return el ? el.value : null; };
    return { from: g("from"), to: g("to"), art: g("art"), hours_from: g("hours_from"), hours_to: g("hours_to") };
  });
}

async function fillWorkTime(frame, start, end) {
  const from = frame.locator('input[name="hours_from"]').first();
  const to = frame.locator('input[name="hours_to"]').first();
  if (await from.isVisible().catch(() => false)) { await from.click(); await from.fill(""); await from.pressSequentially(start, { delay: 40 }); }
  if (await to.isVisible().catch(() => false)) { await to.click(); await to.fill(""); await to.pressSequentially(end, { delay: 40 }); }
  await frame.page().waitForTimeout(300);
}

/** Set the ExtJS `art` (absence type) combo by typing + picking the exact option. */
async function setArt(frame, art) {
  const el = frame.locator('input[name="art"]').first();
  if (!(await el.isVisible().catch(() => false))) return false;
  await el.click();
  await el.press("Control+a").catch(() => {});
  await el.pressSequentially(String(art), { delay: 40 });
  await frame.page().waitForTimeout(500);
  const opt = frame.locator('.x-boundlist-item, [role="option"], li').filter({ hasText: new RegExp(`^\\s*${art}\\s*$`, "i") }).first();
  if (await opt.isVisible().catch(() => false)) { await opt.click().catch(() => {}); await frame.page().waitForTimeout(300); return true; }
  await frame.page().keyboard.press("Escape").catch(() => {});
  return false;
}
async function ensureFullDay(frame) {
  const cb = frame.locator('input[name="full_day"]').first();
  if ((await cb.isVisible().catch(() => false)) && !(await cb.isChecked().catch(() => false))) {
    await cb.click({ force: true }).catch(() => {});
    await frame.page().waitForTimeout(200);
  }
}
/** Fill the absence form: set art (e.g. Urlaub) + full day; from/to already default to the clicked date. */
async function fillAbsence(frame, absenceType) {
  await setArt(frame, absenceType || "Urlaub");
  await ensureFullDay(frame);
  await frame.page().waitForTimeout(200);
}

async function saveDialog(frame) {
  const save = frame.getByText(/^Speichern$/i).first();
  if (await save.isVisible().catch(() => false)) { await save.click().catch(() => {}); await frame.page().waitForTimeout(1200); return true; }
  return false;
}
async function cancelDialog(frame) {
  await frame.getByText(/^Abbrechen$/i).first().click().catch(() => {});
  await frame.page().waitForTimeout(300);
}

// ---------------------------------------------------------------------------

async function timoStatus() {
  let browser;
  try { browser = await connect(); }
  catch (e) { return `Cannot reach Chrome on ${CDP}. Start it with "npm run roar:chrome" and open TimO in that window. (${String(e).slice(0, 120)})`; }
  try {
    const page = await getTimoPage(browser);
    await page.waitForTimeout(1200);
    if (isLoginUrl(page.url())) return "Chrome is reachable but TimO is NOT signed in — sign in at ac.timo24.de in that Chrome window, then retry.";
    const f = mainFrame(page);
    const who = await f.getByText(/Roessler|Anwesenheitsverwaltung|TimO/i).first().textContent().catch(() => "");
    return `Connected. TimO open and signed in${who ? ` (${who.trim().slice(0, 40)})` : ""}.`;
  } catch (e) {
    return `Connected to Chrome, but TimO isn't ready: ${String(e).slice(0, 160)}`;
  } finally { await browser.close().catch(() => {}); }
}

async function timoExport({ days, dryRun }) {
  if (!Array.isArray(days)) throw new Error("days[] is required.");
  const browser = await connect();
  try {
    const page = await getTimoPage(browser);
    await page.waitForTimeout(1000);
    if (isLoginUrl(page.url())) throw new Error("TimO is not signed in. Sign in in the Chrome window and retry.");
    const frame = mainFrame(page);
    const done = [];
    const failed = [];
    for (const d of days) {
      const kind = d.kind || "work";
      try {
        const opened = await openDay(frame, d.iso);
        if (!opened) { failed.push(`${d.iso.slice(5)} (day dialog not found)`); continue; }

        if (kind === "absence") {
          // The day-click dialog IS "Abwesenheit eintragen" — set the type + full day.
          if (dryRun) { const info = await readDialog(frame); await cancelDialog(frame); done.push(`${d.iso.slice(5)} → absence:${d.absenceType || "Urlaub"} (art=${info.art ?? "?"})`); continue; }
          await fillAbsence(frame, d.absenceType);
          const saved = await saveDialog(frame);
          if (!saved) { await cancelDialog(frame); failed.push(`${d.iso.slice(5)} (Speichern not found)`); continue; }
          done.push(`${d.iso.slice(5)} absence:${d.absenceType || "Urlaub"}`);
          continue;
        }

        // Work day: clicking a day only opens the ABSENCE form (Kommen/Gehen fields are hidden).
        // Never save it (that would create a wrong absence). Only fill if a working dialog is shown.
        const canWork = await frame.locator('input[name="hours_from"]').first().isVisible().catch(() => false);
        if (!canWork) {
          await cancelDialog(frame);
          failed.push(`${d.iso.slice(5)} work (TimO records working time separately — not on this dialog)`);
          continue;
        }
        if (dryRun) { await cancelDialog(frame); done.push(`${d.iso.slice(5)} → ${d.start}-${d.end}`); continue; }
        await fillWorkTime(frame, d.start, d.end);
        const saved = await saveDialog(frame);
        if (!saved) { await cancelDialog(frame); failed.push(`${d.iso.slice(5)} (Speichern not found)`); continue; }
        done.push(`${d.iso.slice(5)} ${d.start}-${d.end}`);
      } catch (e) {
        await cancelDialog(frame).catch(() => {});
        failed.push(`${d.iso.slice(5)} (${String(e).slice(0, 60)})`);
      }
    }
    const head = dryRun ? "Dry run — days reachable in TimO" : "Recorded time in TimO (review & submit in TimO)";
    return `${head}:\n  OK: ${done.join(" | ") || "none"}${failed.length ? `\n  PROBLEM: ${failed.join(" | ")}` : ""}`;
  } finally { await browser.close().catch(() => {}); }
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio server (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

const TOOLS = [
  { name: "timo_status", description: "Check whether Chrome is reachable and TimO is signed in.", inputSchema: { type: "object", properties: {} } },
  {
    name: "timo_export",
    description: "Record a week of working time into TimO. Enters Kommen/Gehen per day; never submits.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "array", description: "One per day: { iso, start, end, hours, source }.", items: { type: "object" } },
        dryRun: { type: "boolean", description: "Only verify each day's dialog is reachable; do not write." },
      },
      required: ["days"],
    },
  },
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function ok(id, result) { send({ jsonrpc: "2.0", id, result }); }
function textResult(text, isError = false) { return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) }; }

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "timo", version: "0.1.0" } });
  if (method === "notifications/initialized") return;
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      if (name === "timo_status") return ok(id, textResult(await timoStatus()));
      if (name === "timo_export") return ok(id, textResult(await timoExport(args)));
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
    try { msg = JSON.parse(line); } catch { continue; }
    Promise.resolve(handle(msg)).catch((e) => log("handler error:", String(e)));
  }
});
process.stdin.on("end", () => process.exit(0));
log(`ready (CDP ${CDP})`);
