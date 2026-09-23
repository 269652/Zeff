#!/usr/bin/env node
/**
 * roar-mcp — a stdio MCP server that transfers a week of Zeff time into the Roar
 * timesheet (https://roar.marcel.ai/app/timesheet) with Playwright, deterministically
 * (no LLM). It ATTACHES to your already-signed-in Chrome over the DevTools port
 * (default http://127.0.0.1:9222, override with ROAR_CDP_ENDPOINT), so the corporate
 * Microsoft SSO session is reused — no password is ever handled here.
 *
 * Tools:
 *   roar_status                      -> is Chrome reachable, is Roar open & logged in
 *   roar_export {weekStartIso, rows, dryRun}
 *                                    -> fill the week's job×day hours; leaves the final
 *                                       save to you (never submits/approves)
 *
 * Start Chrome for it with:  npm run roar:chrome   (then sign in to Roar once)
 */
import { chromium } from "playwright-core";

const CDP = process.env.ROAR_CDP_ENDPOINT || "http://127.0.0.1:9222";
const ROAR_URL = "https://roar.marcel.ai/app/timesheet";
const log = (...a) => process.stderr.write(`[roar-mcp] ${a.join(" ")}\n`);

// ---------------------------------------------------------------------------
// Playwright helpers
// ---------------------------------------------------------------------------

async function connect() {
  const browser = await chromium.connectOverCDP(CDP, { timeout: 8000 });
  return browser;
}

/** Find the Roar timesheet page among open tabs, or open one. */
async function getTimesheetPage(browser) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  let page = pages.find((p) => p.url().includes("roar.marcel.ai"));
  if (!page) {
    const ctx = browser.contexts()[0] || (await browser.newContext());
    page = await ctx.newPage();
  }
  if (!page.url().includes("/app/timesheet")) {
    await page.goto(ROAR_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  return page;
}

function isLoginUrl(u) {
  return /login\.microsoftonline\.com|\/login/i.test(u);
}

/** The same-origin iframe that hosts the timesheet app. */
async function getAppFrame(page) {
  // Wait for the iframe to attach and load the app.
  await page.waitForTimeout(500);
  for (let i = 0; i < 20; i++) {
    const frames = page.frames();
    const f = frames.find((fr) => fr !== page.mainFrame() && fr.url().includes("roar.marcel.ai"));
    if (f) {
      // ensure the grid shell is present
      const ok = await f.getByText(/Add job \/ task|New week|Timesheet/i).first().isVisible().catch(() => false);
      if (ok) return f;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Could not find the Roar timesheet app frame (is the page loaded and logged in?).");
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function isoOf(y, mon, d) {
  return `${y}-${String(mon + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** Parse the "Sep 21 - 27, 2026" (or cross-month) header into the Monday ISO date. */
function parseWeekStart(label) {
  const m = /([A-Za-z]{3,})\.?\s+(\d{1,2})\s*[-–—]\s*(?:([A-Za-z]{3,})\.?\s+)?(\d{1,2}),?\s+(\d{4})/.exec(label || "");
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (mon < 0) return null;
  return isoOf(Number(m[5]), mon, Number(m[2]));
}

async function readWeekLabel(frame) {
  // The week range sits between the Previous/Next week buttons; grab the element with a year + dash.
  const loc = frame.getByText(/[A-Za-z]{3,}\.?\s+\d{1,2}\s*[-–—].*\d{4}/).first();
  return (await loc.textContent().catch(() => ""))?.trim() || "";
}

async function navigateToWeek(frame, targetMondayIso) {
  for (let i = 0; i < 60; i++) {
    const label = await readWeekLabel(frame);
    const cur = parseWeekStart(label);
    if (cur === targetMondayIso) return;
    if (!cur) throw new Error(`Could not read the Roar week (label="${label}").`);
    const dir = new Date(targetMondayIso) > new Date(cur) ? "Next week" : "Previous week";
    await frame.getByRole("button", { name: new RegExp(dir, "i") }).first().click();
    await frame.getByText(/Loading|Saving/i).first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
    await frame.page().waitForTimeout(400);
  }
  throw new Error(`Could not reach the week of ${targetMondayIso} in Roar.`);
}

/** Add the job row (search by job number, pick the PPM task, add) if it isn't already present. */
async function ensureJobRow(frame, jobNumber) {
  const existing = frame.getByText(jobNumber, { exact: false }).first();
  if (await existing.isVisible().catch(() => false)) return true;

  await frame.getByRole("button", { name: /Add job \/ task/i }).first().click();
  const search = frame.locator("#search, input[placeholder*='Search job']").first();
  await search.waitFor({ state: "visible", timeout: 8000 });
  await search.fill(jobNumber);
  // Result card for this job number.
  const card = frame.locator("*", { hasText: jobNumber }).filter({ has: frame.getByText(/Add to timesheet/i) }).first();
  await card.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  // Select the PPM task (open the select, choose the only/first option).
  const taskSelect = frame.getByText(/Select task name/i).first();
  if (await taskSelect.isVisible().catch(() => false)) {
    await taskSelect.click();
    const option = frame.getByRole("option").first();
    await option.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    await option.click().catch(() => {});
  }
  await frame.getByRole("button", { name: /Add to timesheet/i }).first().click();
  // Close the dialog if still open.
  await frame.getByRole("button", { name: /^Close$|✕/ }).first().click({ timeout: 1500 }).catch(() => {});
  await frame.page().keyboard.press("Escape").catch(() => {});
  await frame.getByText(jobNumber, { exact: false }).first().waitFor({ state: "visible", timeout: 8000 });
  return true;
}

/** Set a single day's hours for a job row. Cell inputs have id `<YYYY-MM-DD>-<rowGuid>`. */
async function setDayHours(frame, jobNumber, iso, hours) {
  // Find the row that contains the job number, then the day cell by id prefix.
  const row = frame.locator("*", { hasText: jobNumber }).locator(`xpath=ancestor-or-self::*[.//input[starts-with(@id,'${iso}-')]][1]`).first();
  let input = row.locator(`input[id^='${iso}-']`).first();
  if (!(await input.count())) {
    // Fallback: match by aria-label containing the ISO's weekday date is brittle; try any cell with the id prefix near the job text.
    input = frame.locator(`input[id^='${iso}-']`).first();
  }
  await input.waitFor({ state: "visible", timeout: 5000 });
  await input.click();
  await input.fill(String(hours));
  await input.press("Enter").catch(() => {});
  await input.blur().catch(() => {});
  await frame.page().waitForTimeout(250);
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function roarStatus() {
  let browser;
  try {
    browser = await connect();
  } catch (e) {
    return `Cannot reach Chrome on ${CDP}. Start it with "npm run roar:chrome" and sign in to Roar. (${String(e).slice(0, 120)})`;
  }
  try {
    const page = await getTimesheetPage(browser);
    await page.waitForTimeout(1500);
    if (isLoginUrl(page.url())) return "Chrome is reachable but Roar is NOT signed in — complete the Microsoft login in that Chrome window, then retry.";
    await getAppFrame(page);
    const label = await readWeekLabel(await getAppFrame(page)).catch(() => "");
    return `Connected. Roar timesheet open and signed in${label ? ` (showing ${label})` : ""}.`;
  } catch (e) {
    return `Connected to Chrome, but the Roar timesheet isn't ready: ${String(e).slice(0, 160)}`;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function roarExport({ weekStartIso, rows, dryRun }) {
  if (!weekStartIso || !Array.isArray(rows)) throw new Error("weekStartIso and rows are required.");
  const browser = await connect();
  try {
    const page = await getTimesheetPage(browser);
    await page.waitForTimeout(1000);
    if (isLoginUrl(page.url())) throw new Error("Roar is not signed in. Sign in in the Chrome window and retry.");
    let frame = await getAppFrame(page);
    await navigateToWeek(frame, weekStartIso);
    frame = await getAppFrame(page);

    const done = [];
    const failed = [];
    for (const r of rows) {
      try {
        if (dryRun) {
          // Verify the job resolves in Roar's search without adding it.
          await frame.getByRole("button", { name: /Add job \/ task/i }).first().click();
          const search = frame.locator("#search, input[placeholder*='Search job']").first();
          await search.waitFor({ state: "visible", timeout: 8000 });
          await search.fill(r.jobNumber);
          const found = await frame.getByText(r.jobNumber, { exact: false }).first().isVisible({ timeout: 6000 }).catch(() => false);
          await frame.page().keyboard.press("Escape").catch(() => {});
          (found ? done : failed).push(`${r.jobNumber}${found ? "" : " (not found in Roar)"}`);
          continue;
        }
        await ensureJobRow(frame, r.jobNumber);
        const entries = Object.entries(r.hoursByDay || {}).filter(([, h]) => Number(h) > 0);
        for (const [iso, h] of entries) await setDayHours(frame, r.jobNumber, iso, h);
        done.push(`${r.jobNumber}: ${entries.map(([d, h]) => `${d.slice(5)}=${h}`).join(", ")}`);
      } catch (e) {
        failed.push(`${r.jobNumber} (${String(e).slice(0, 80)})`);
      }
    }
    const head = dryRun ? "Dry run — jobs checked in Roar" : "Filled Roar (review and save in the Roar window)";
    return `${head}:\n  OK: ${done.join(" | ") || "none"}${failed.length ? `\n  PROBLEM: ${failed.join(" | ")}` : ""}`;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio server (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "roar_status",
    description: "Check whether Chrome (with the debug port) is reachable and the Roar timesheet is signed in.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "roar_export",
    description: "Transfer a week of Zeff time into the Roar timesheet. Fills job×day hours; never submits (you review & save).",
    inputSchema: {
      type: "object",
      properties: {
        weekStartIso: { type: "string", description: "Monday of the target week, YYYY-MM-DD." },
        rows: {
          type: "array",
          description: "One per job: { jobNumber, jobName, hoursByDay: { 'YYYY-MM-DD': hours } }.",
          items: { type: "object" },
        },
        dryRun: { type: "boolean", description: "Only verify each job resolves in Roar; do not add rows or hours." },
      },
      required: ["weekStartIso", "rows"],
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
    return ok(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "roar", version: "0.1.0" },
    });
  }
  if (method === "notifications/initialized") return; // notification, no reply
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      if (name === "roar_status") return ok(id, textResult(await roarStatus()));
      if (name === "roar_export") return ok(id, textResult(await roarExport(args)));
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
