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
 *   roar_export {weekStartIso, rows, managedJobs, dryRun}
 *                                    -> sync the week's entries (add / update / zero out
 *                                       per entry); never submits/approves
 *
 * Start Chrome for it with:  npm run roar:chrome   (then sign in to Roar once)
 */
import { connectToChrome, StuckTabError } from "./chrome-cdp.mjs";

const CDP = process.env.ROAR_CDP_ENDPOINT || "http://127.0.0.1:9222";
const ROAR_URL = "https://roar.marcel.ai/app/timesheet";
const log = (...a) => process.stderr.write(`[roar-mcp] ${a.join(" ")}\n`);

// ---------------------------------------------------------------------------
// Playwright helpers
// ---------------------------------------------------------------------------

async function connect() {
  const browser = await connectToChrome(CDP);
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
/**
 * Parse the "Sep 21 - 27, 2026" (or cross-month "Aug 31 - 06, 2026") header into the
 * Monday ISO date. A cross-year week is labelled with its END year — "Dec 28 - 03, 2027"
 * is really Mon 2026-12-28 — so the displayed year can be one off for the start date.
 * Every Roar week starts on a Monday, so resolve the year to the one near the label
 * where the start (month, day) actually falls on a Monday.
 */
function parseWeekStart(label) {
  const m = /([A-Za-z]{3,})\.?\s+(\d{1,2})\s*[-–—]\s*(?:([A-Za-z]{3,})\.?\s+)?(\d{1,2}),?\s+(\d{4})/.exec(label || "");
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (mon < 0) return null;
  const day = Number(m[2]);
  const yr = Number(m[5]);
  for (const y of [yr, yr - 1, yr + 1]) {
    const d = new Date(y, mon, day);
    if (d.getMonth() === mon && d.getDate() === day && d.getDay() === 1) return isoOf(y, mon, day);
  }
  return isoOf(yr, mon, day); // fall back to the label's year if no Monday matches
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

/** Open "Add job / task", type the job number into the DIALOG's job search, wait for a result. */
async function openJobSearch(frame, jobNumber) {
  await frame.page().keyboard.press("Escape").catch(() => {}); // clear any stray dialog
  await frame.getByRole("button", { name: /Add job \/ task/i }).first().click();
  const dialog = frame.getByRole("dialog");
  const search = dialog.getByPlaceholder(/Search job/i).first();
  await search.waitFor({ state: "visible", timeout: 8000 });
  await search.click();
  await search.pressSequentially(jobNumber, { delay: 60 });
  return dialog;
}

/** Add the job row (search by number, pick the PPM task, add) if it isn't already present. */
async function ensureJobRow(frame, jobNumber) {
  if (await rowGuid(frame, jobNumber)) return;

  const dialog = await openJobSearch(frame, jobNumber);
  const addToTs = dialog.getByRole("button", { name: /Add to timesheet/i }).first();
  await addToTs.waitFor({ state: "visible", timeout: 12000 });
  // Select the PPM task (required) — a "Select task name" placeholder combobox; pick the only/first option.
  const taskInput = dialog.getByPlaceholder(/Select task name/i).first();
  if (await taskInput.isVisible().catch(() => false)) {
    await taskInput.click();
    const option = frame.getByRole("option").first();
    await option.waitFor({ state: "visible", timeout: 6000 });
    await option.click();
    await frame.page().waitForTimeout(300);
  }
  await addToTs.click();
  await frame.page().keyboard.press("Escape").catch(() => {}); // close dialog if it stayed open
  // Confirm the row exists (a day cell for it appears).
  for (let i = 0; i < 20; i++) {
    if (await rowGuid(frame, jobNumber)) return;
    await frame.page().waitForTimeout(400);
  }
  throw new Error("row did not appear after add");
}

/**
 * The row GUID for a job (cell inputs are id `<YYYY-MM-DD>-<guid>`). Find the LEAF
 * element that shows the job number, then walk UP to the nearest ancestor that holds
 * a date-guid cell input, and return that cell's guid.
 *
 * (Matching *any* ancestor whose text contains the number is wrong: the job-group
 * container holds every job number in the group, so the first cell always matched and
 * all rows in a group collapsed onto the group's first row.)
 */
async function rowGuid(frame, jobNumber) {
  return frame.evaluate((num) => {
    const isCell = (el) => el.tagName === "INPUT" && /^\d{4}-\d{2}-\d{2}-/.test(el.id || "");
    const all = document.querySelectorAll("*");
    let leaf = null;
    for (const el of all) {
      if (el.children.length === 0 && (el.textContent || "").trim().includes(num)) { leaf = el; break; }
    }
    if (!leaf) for (const el of all) { if ((el.textContent || "").includes(num) && !el.querySelector("input")) { leaf = el; break; } }
    if (!leaf) return null;
    for (let el = leaf, d = 0; el && d < 15; el = el.parentElement, d++) {
      const inp = [...el.querySelectorAll("input[id]")].find(isCell);
      if (inp) return inp.id.slice(11); // after "YYYY-MM-DD-"
    }
    return null;
  }, jobNumber);
}

/** Grid-cell state for a job×day: whether the day is editable (future days are disabled) and its current value. */
async function cellInfo(frame, guid, iso) {
  return frame.evaluate(
    ({ guid, iso }) => {
      const el = document.getElementById(`${iso}-${guid}`);
      if (!el) return { present: false, disabled: true, value: "" };
      return { present: true, disabled: !!el.disabled, value: el.value || "" };
    },
    { guid, iso },
  );
}

/** The open entry-details panel (a dialog/drawer). */
function entryPanel(frame) {
  return frame.locator('[role="dialog"], .MuiDialog-paper, .MuiDrawer-paper').first();
}

const roundTenth = (h) => Math.ceil(Number(h) * 10 - 1e-9) / 10;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Click an option in the currently-open combobox list by its L-code (e.g. "L04090"). */
async function pickOptionByCode(frame, text) {
  const code = (String(text).match(/[A-Za-z]\d{3,}/) || [String(text)])[0];
  const opt = frame.getByRole("option", { name: new RegExp(reEsc(code), "i") }).first();
  if (await opt.isVisible().catch(() => false)) {
    await opt.click().catch(() => {});
    await frame.page().waitForTimeout(300);
    return true;
  }
  await frame.page().keyboard.press("Escape").catch(() => {});
  return false;
}

/**
 * WorkCode and Billable Indicator are required to Save. Most jobs pre-fill them from
 * your default role, but some (e.g. the Abwesenheit job) start with an EMPTY WorkCode
 * and offer only a short, job-specific list (e.g. Project Manager / ABSENCE / ABSENCE -
 * TIME IN LIEU) that does NOT include your role code — so we must pick from that list.
 * We capture your role code from the first job that has one, and where a field is empty
 * we open its own list and choose: your role code if offered, else a plain "Absence"
 * code, else the only option. Picking the WorkCode usually auto-fills Billable.
 */
async function ensureWorkcodeBillable(frame, ctx, jobWorkcode) {
  const wc = frame.locator("input#workcodeInput").first();
  if (await wc.isVisible().catch(() => false)) {
    const cur = ((await wc.inputValue().catch(() => "")) || "").trim();
    if (cur) {
      if (!ctx.workcode) ctx.workcode = cur;
    } else {
      await wc.click();
      await frame.page().waitForTimeout(500);
      const options = await frame.evaluate(() =>
        [...document.querySelectorAll('[role="option"]')].map((o) => (o.textContent || "").trim()).filter(Boolean),
      );
      const codeOf = (o) => (String(o).match(/[A-Za-z]\d{3,}/) || [])[0];
      const cfg = jobWorkcode ? String(jobWorkcode).trim() : "";
      const cfgCode = cfg ? codeOf(cfg) : null;
      const roleCode = ctx.workcode ? codeOf(ctx.workcode) : null;
      const absence = options.filter((o) => /absence|abwesen|urlaub|leave|vacation|holiday/i.test(o));
      const pick =
        (cfgCode && options.find((o) => codeOf(o) === cfgCode)) || // configured WorkCode by code (e.g. "L04090")
        (cfg && !cfgCode && options.find((o) => o.toLowerCase().includes(cfg.toLowerCase()))) || // configured by keyword
        (roleCode && options.find((o) => o.includes(roleCode))) || // your role, if this job offers it
        absence.find((o) => /[-–]\s*absence\s*$/i.test(o)) || // plain "… - ABSENCE" over qualified variants
        absence[0] ||
        (options.length === 1 ? options[0] : null);
      if (pick) await pickOptionByCode(frame, pick);
      else await frame.page().keyboard.press("Escape").catch(() => {}); // no sensible option -> Save stays disabled (clear error)
    }
  }
  const bi = frame.locator("input#billableIndicatorInput").first();
  if (await bi.isVisible().catch(() => false)) {
    const cur = ((await bi.inputValue().catch(() => "")) || "").trim();
    if (cur) {
      if (!ctx.billable) ctx.billable = cur;
    } else {
      await bi.click();
      await frame.page().waitForTimeout(400);
      const want = ctx.billable || "Covered by fee";
      let opt = frame.getByRole("option", { name: new RegExp(reEsc(want), "i") }).first();
      if (!(await opt.isVisible().catch(() => false))) opt = frame.getByRole("option").first();
      if (await opt.isVisible().catch(() => false)) await opt.click().catch(() => {});
      else await frame.page().keyboard.press("Escape").catch(() => {});
      await frame.page().waitForTimeout(300);
    }
  }
}

/**
 * Add ONE entry to a job×day cell through the entry-details panel: open the cell,
 * click "New entry" when the cell already holds entries (so we ADD rather than edit),
 * fill the duration (rounded up to 0.1) + comment, ensure WorkCode/Billable are set,
 * then Save. `ctx` carries the captured default WorkCode/Billable across entries.
 * Never submits.
 */
async function addOneEntry(frame, guid, iso, entry, isAdditional, ctx, jobWorkcode) {
  const cell = frame.locator(`input[id="${iso}-${guid}"]`).first();
  await cell.scrollIntoViewIfNeeded().catch(() => {});
  await cell.click();
  await frame.page().keyboard.press("Enter");
  await frame.page().waitForTimeout(300);
  // For the 2nd+ entry in a cell, click "New entry" to open a FRESH form (never edit the
  // existing one). For the first entry the add-form is shown directly.
  const newEntry = frame.locator('button, [role="button"], a').filter({ hasText: /^\s*New entry\s*$/i }).first();
  if (isAdditional) {
    await newEntry.waitFor({ state: "visible", timeout: 6000 });
    await newEntry.click();
    await frame.page().waitForTimeout(500);
  } else if (await newEntry.isVisible().catch(() => false)) {
    await newEntry.click().catch(() => {}); // cell unexpectedly already has entries — still add fresh
    await frame.page().waitForTimeout(400);
  }
  const dur = frame.locator("input#durationInput").first();
  await dur.waitFor({ state: "visible", timeout: 6000 });
  await dur.click();
  await dur.fill(String(roundTenth(entry.hours))); // .fill() registers with the panel form (unlike grid cells)
  await frame.page().waitForTimeout(200);
  if (entry.comment) {
    const c = frame.locator("textarea#commentInput").first();
    if (await c.isVisible().catch(() => false)) {
      await c.click().catch(() => {});
      await c.fill(String(entry.comment).slice(0, 125)).catch(() => {});
    }
  }
  await ensureWorkcodeBillable(frame, ctx, jobWorkcode); // some jobs (Abwesenheit) start with an empty WorkCode
  const save = entryPanel(frame).locator('button[type="submit"]').first();
  await save.waitFor({ state: "visible", timeout: 5000 });
  for (let i = 0; i < 15 && !(await save.isEnabled().catch(() => false)); i++) await frame.page().waitForTimeout(200);
  if (!(await save.isEnabled().catch(() => false))) throw new Error(`${iso}: Save stayed disabled (no WorkCode — needs a job with a default WorkCode filled first)`);
  await save.click();
  await frame.page().waitForTimeout(900);
  // Close the panel if it stayed open so the next entry starts from a clean cell.
  if (await entryPanel(frame).isVisible().catch(() => false)) {
    await frame.page().keyboard.press("Escape").catch(() => {});
    await frame.page().waitForTimeout(300);
  }
}

/** Persist the whole draft via the grid "Save" if present AND enabled. Never submits. */
async function saveDraft(frame) {
  const save = frame.getByRole("button", { name: "Save", exact: true }).first();
  if ((await save.isVisible().catch(() => false)) && (await save.isEnabled().catch(() => false))) {
    await save.click({ timeout: 5000 }).catch(() => {});
    await frame.page().waitForTimeout(1500);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Entry-level sync: read a cell's entries, then keep / update / zero / add
// ---------------------------------------------------------------------------

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Tue 22.09." for an ISO date. */
function dayLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WD[new Date(y, m - 1, d).getDay()]} ${iso.slice(8)}.${iso.slice(5, 7)}.`;
}
const normComment = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
const fmtH = (h) => `${Math.round(Number(h) * 100) / 100} h`;

/**
 * Every job row of the visible week: job number -> { guid, cells: { iso: { value, disabled } } }.
 * A row's job number comes from the nearest ancestor naming exactly ONE job (a container
 * naming several is a job group — ambiguous, so that cell is skipped rather than misassigned).
 */
async function readGrid(frame) {
  const rows = await frame.evaluate(() => {
    const res = {};
    for (const el of document.querySelectorAll("input[id]")) {
      if (!/^\d{4}-\d{2}-\d{2}-/.test(el.id)) continue;
      let job = null;
      for (let p = el.parentElement, d = 0; p && d < 12; p = p.parentElement, d++) {
        const found = [...new Set((p.textContent || "").match(/[A-Z]{2}\d{3}-\d{6}-\d{2}/g) || [])];
        if (found.length === 1) { job = found[0]; break; }
        if (found.length > 1) break;
      }
      if (!job) continue;
      const r = (res[job] ||= { guid: el.id.slice(11), cells: {} });
      r.cells[el.id.slice(0, 10)] = { value: Number(el.value) || 0, disabled: !!el.disabled };
    }
    return res;
  });
  return new Map(Object.entries(rows));
}

/** After a (re)load or week change, wait until the week's day cells are rendered (a week may have no rows). */
async function waitForGrid(frame, weekStartIso) {
  for (let i = 0; i < 25; i++) {
    const n = await frame.evaluate((d) => document.querySelectorAll(`input[id^="${d}-"]`).length, weekStartIso).catch(() => 0);
    if (n > 0) {
      await frame.page().waitForTimeout(500); // let the remaining rows' values settle
      return n;
    }
    await frame.page().waitForTimeout(400);
  }
  return 0;
}

/** The entry cards of an open cell panel (several entries); a single entry opens directly as its form. */
function entryCards(frame) {
  return entryPanel(frame).locator('[role="button"]').filter({ hasText: /Duration/ });
}

/** Open a job×day cell's entry panel. */
async function openCell(frame, guid, iso) {
  await frame.page().keyboard.press("Escape").catch(() => {});
  await frame.page().waitForTimeout(250);
  const cell = frame.locator(`input[id="${iso}-${guid}"]`).first();
  await cell.scrollIntoViewIfNeeded().catch(() => {});
  await cell.click();
  await frame.page().keyboard.press("Enter");
  await entryPanel(frame).waitFor({ state: "visible", timeout: 6000 });
  await frame.page().waitForTimeout(500);
}

/** Duration + comment of the entry form currently shown in the panel. */
async function formValues(frame) {
  const p = entryPanel(frame);
  const hours = Number((await p.locator("#durationInput").first().inputValue().catch(() => "")) || 0) || 0;
  const comment = (await p.locator("#commentInput").first().inputValue().catch(() => "")) || "";
  return { hours, comment };
}

/**
 * Visit the open cell's entries (expanding each card into its form) until `visit`
 * returns true — that entry's form then stays open. Zeroed (0 h) entries are skipped.
 */
async function forEachEntry(frame, visit) {
  const cards = entryCards(frame);
  const n = await cards.count();
  if (n === 0) {
    const v = await formValues(frame);
    return v.hours > 0 ? !!(await visit(v)) : false;
  }
  for (let i = 0; i < n; i++) {
    await cards.nth(i).click();
    await frame.page().waitForTimeout(400);
    const v = await formValues(frame);
    if (v.hours > 0 && (await visit(v))) return true;
  }
  return false;
}

/** A cell's entries (hours + comment) and whether its timesheet was already submitted. Read-only. */
async function readCellEntries(frame, guid, iso) {
  await openCell(frame, guid, iso);
  const submitted = /has been submitted/i.test((await entryPanel(frame).textContent().catch(() => "")) || "");
  const entries = [];
  await forEachEntry(frame, (v) => {
    entries.push(v);
    return false;
  });
  await frame.page().keyboard.press("Escape").catch(() => {});
  await frame.page().waitForTimeout(250);
  return { entries, submitted };
}

/**
 * Edit one existing entry — its duration (0 removes it) and/or its comment — and Save.
 * The entry is found by its current comment + hours.
 */
async function editEntry(frame, guid, iso, target, { hours, comment }) {
  await openCell(frame, guid, iso);
  const want = normComment(target.comment);
  const found = await forEachEntry(frame, (v) => normComment(v.comment) === want && Math.abs(v.hours - target.hours) <= 0.05);
  if (!found) {
    await frame.page().keyboard.press("Escape").catch(() => {});
    throw new Error(`entry “${target.comment}” (${fmtH(target.hours)}) not found`);
  }
  const panel = entryPanel(frame);
  if (hours !== undefined) {
    const dur = panel.locator("#durationInput").first();
    await dur.click();
    await dur.fill(String(hours));
  }
  if (comment !== undefined) {
    const c = panel.locator("#commentInput").first();
    await c.click();
    await c.fill(String(comment).slice(0, 125));
  }
  await frame.page().waitForTimeout(250);
  const save = panel.locator('button[type="submit"]').first();
  for (let i = 0; i < 15 && !(await save.isEnabled().catch(() => false)); i++) await frame.page().waitForTimeout(200);
  if (!(await save.isEnabled().catch(() => false))) {
    await frame.page().keyboard.press("Escape").catch(() => {});
    throw new Error(`Save stayed disabled editing “${target.comment}”`);
  }
  await save.click();
  await frame.page().waitForTimeout(1000);
  if (await panel.isVisible().catch(() => false)) {
    await frame.page().keyboard.press("Escape").catch(() => {});
    await frame.page().waitForTimeout(300);
  }
}

const ticketKey = (s) => ((String(s || "").match(/^\s*([A-Z][A-Z0-9]+-\d+)\b/i) || [])[1] || "").toUpperCase() || null;

/**
 * Pair a cell's Roar entries with Zeff's, most specific first: identical (comment + hours)
 * stay; the same comment gets the new duration; the same ticket, then the same duration,
 * then any leftover entry gets the new comment (e.g. a report rule renamed it) and
 * duration. Remaining Roar entries are removed, remaining Zeff entries added. Comments
 * compare trimmed, whitespace-collapsed, case-blind. Edits are { from, hours?, comment? }.
 */
function diffEntries(existing, desired) {
  const sameH = (a, b) => Math.abs(a - b) <= 0.05;
  const ex = existing.map((e) => ({ ...e, key: normComment(e.comment), tk: ticketKey(e.comment), used: false }));
  const want = desired.map((d) => ({ hours: Number(d.hours), comment: d.comment, key: normComment(d.comment), tk: ticketKey(d.comment), done: false }));
  const edits = [];
  const pair = (test) => {
    for (const w of want) {
      if (w.done) continue;
      const e = ex.find((x) => !x.used && test(x, w));
      if (!e) continue;
      e.used = true;
      w.done = true;
      const edit = { from: e };
      if (!sameH(e.hours, w.hours)) edit.hours = w.hours;
      if (e.key !== w.key) edit.comment = w.comment;
      if (edit.hours !== undefined || edit.comment !== undefined) edits.push(edit);
    }
  };
  pair((x, w) => x.key === w.key && sameH(x.hours, w.hours));
  pair((x, w) => x.key === w.key);
  pair((x, w) => !!x.tk && x.tk === w.tk);
  pair((x, w) => sameH(x.hours, w.hours));
  pair(() => true); // reuse any leftover entry rather than zeroing one and adding another
  return { edits, remove: ex.filter((x) => !x.used), add: want.filter((x) => !x.done) };
}

/** "0.3 h “old” → 1 h “new”", naming only what an edit changes. */
function describeEdit({ from, hours, comment }) {
  const to = [hours !== undefined ? fmtH(hours) : "", comment !== undefined ? `“${comment}”` : ""].filter(Boolean).join(" ");
  return `${fmtH(from.hours)} “${from.comment}” → ${to}`;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function roarStatus() {
  let browser;
  try {
    browser = await connect();
  } catch (e) {
    if (e instanceof StuckTabError) return e.message;
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

/**
 * Sync a week of Zeff time into Roar: one Roar entry per rewritten report line and job.
 * For jobs Zeff knows (`managedJobs`) on days tracked in Zeff, every cell's entries are
 * read and synced entry by entry — identical ones stay, changed durations or comments are
 * edited in place, entries Zeff no longer has are set to 0 h and saved (Roar's way to
 * remove one), missing ones are added — so moving a booking to another job, or a report
 * rule renaming it, carries over. Other cells are only filled when empty. dryRun reads
 * everything and lists the changes without saving.
 */
async function roarExport({ weekStartIso, rows, managedJobs = [], dryRun }) {
  if (!weekStartIso || !Array.isArray(rows)) throw new Error("weekStartIso and rows are required.");
  const browser = await connect();
  try {
    const page = await getTimesheetPage(browser);
    await page.waitForTimeout(1000);
    if (isLoginUrl(page.url())) throw new Error("Roar is not signed in. Sign in in the Chrome window and retry.");
    // Reload for a clean slate (no stray open dialogs / leftover filter text).
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    let frame = await getAppFrame(page);
    await navigateToWeek(frame, weekStartIso);
    frame = await getAppFrame(page);

    const managed = new Set(managedJobs);
    const tracked = new Set(rows.flatMap((r) => Object.keys(r.entriesByDay || {})));
    const zeff = new Map(rows.map((r) => [r.jobNumber, r]));
    await waitForGrid(frame, weekStartIso);
    const grid = await readGrid(frame);
    // Every Zeff row, plus managed Roar rows still holding hours on a tracked day (e.g. a booking moved away).
    const jobs = [...zeff.keys()];
    for (const [job, g] of grid) {
      if (!zeff.has(job) && managed.has(job) && Object.entries(g.cells).some(([iso, c]) => c.value > 0 && tracked.has(iso))) jobs.push(job);
    }

    const changes = [];
    const skipped = [];
    const problems = [];
    const count = { added: 0, updated: 0, removed: 0, ok: 0 };
    let touchedSubmitted = false;
    const wcCtx = {}; // captured default WorkCode/Billable, reused where a job (e.g. Abwesenheit) has none
    const mark = dryRun ? "→" : "✓";

    for (const job of jobs) {
      const z = zeff.get(job);
      const name = z?.jobName ? `${job} ${z.jobName}` : job;
      let guid = grid.get(job)?.guid ?? (await rowGuid(frame, job));
      try {
        if (!guid) {
          if (dryRun) {
            const dialog = await openJobSearch(frame, job);
            const found = await dialog.getByRole("button", { name: /Add to timesheet/i }).first()
              .waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
            await frame.page().keyboard.press("Escape").catch(() => {});
            if (!found) { problems.push(`${name}: job not found in Roar`); continue; }
            for (const [iso, items] of Object.entries(z?.entriesByDay || {})) {
              for (const it of items) changes.push(`${mark} ${name} ${dayLabel(iso)}: add ${fmtH(it.hours)} “${it.comment}” (row gets added)`);
            }
            continue;
          }
          await ensureJobRow(frame, job);
          guid = await rowGuid(frame, job);
          if (!guid) { problems.push(`${name}: row not found after adding it`); continue; }
        }
        const roarDays = managed.has(job) ? Object.entries(grid.get(job)?.cells || {}).filter(([iso, c]) => c.value > 0 && tracked.has(iso)).map(([iso]) => iso) : [];
        const days = [...new Set([...Object.keys(z?.entriesByDay || {}), ...roarDays])].sort();

        for (const iso of days) {
          const where = `${name} ${dayLabel(iso)}`;
          try {
            const desired = z?.entriesByDay?.[iso] || [];
            const cell = await cellInfo(frame, guid, iso);
            const cur = Number(cell.value) || 0;
            const want = Math.round(desired.reduce((a, it) => a + Number(it.hours), 0) * 10) / 10;
            const sameTotal = Math.abs(cur - want) <= 0.05;
            const sync = managed.has(job) && tracked.has(iso);
            if (cell.disabled) {
              if (sameTotal) count.ok += 1;
              else skipped.push(`${where}: future/locked day`);
              continue;
            }
            // Synced cells are always read: the total can match while comments changed (a report rule).
            if (!sync && sameTotal) { count.ok += 1; continue; }
            if (!sync && cur > 0) {
              skipped.push(`${where}: Roar has ${fmtH(cur)}, Zeff ${fmtH(want)} — ${managed.size ? "day not tracked in Zeff" : "partial (filtered) export"}, fix in Roar`);
              continue;
            }
            const read = cur > 0 ? await readCellEntries(frame, guid, iso) : { entries: [], submitted: false };
            const plan = diffEntries(read.entries, desired);
            if (!plan.edits.length && !plan.remove.length && !plan.add.length) { count.ok += 1; continue; }
            if (read.submitted) touchedSubmitted = true;

            for (const r of plan.remove) {
              if (!dryRun) await editEntry(frame, guid, iso, r, { hours: 0 });
              changes.push(`${mark} ${where}: remove ${fmtH(r.hours)} “${r.comment}”`);
              count.removed += 1;
            }
            for (const ed of plan.edits) {
              if (!dryRun) await editEntry(frame, guid, iso, ed.from, { hours: ed.hours, comment: ed.comment });
              changes.push(`${mark} ${where}: ${describeEdit(ed)}`);
              count.updated += 1;
            }
            for (const a of plan.add) {
              if (!dryRun) {
                const now = await cellInfo(frame, guid, iso);
                await addOneEntry(frame, guid, iso, a, (Number(now.value) || 0) > 0, wcCtx, z?.workcode);
              }
              changes.push(`${mark} ${where}: add ${fmtH(a.hours)} “${a.comment}”`);
              count.added += 1;
            }
          } catch (e) {
            problems.push(`${where}: ${String(e?.message || e).split("\n")[0].slice(0, 120)}`);
          }
        }
      } catch (e) {
        problems.push(`${name}: ${String(e?.message || e).split("\n")[0].slice(0, 120)}`);
      }
    }

    let saved = false;
    if (!dryRun && changes.length) saved = await saveDraft(frame);
    const n = `${count.added} to add, ${count.updated} to update, ${count.removed} to remove`;
    const head = dryRun
      ? `Dry run — Roar read, nothing saved (${changes.length ? n : "no changes needed"}; ${count.ok} cell${count.ok === 1 ? "" : "s"} already match):`
      : `Roar — ${count.added} added, ${count.updated} updated, ${count.removed} removed${saved ? ", draft saved" : ""}; ${count.ok} cell${count.ok === 1 ? "" : "s"} already matched:`;
    const lines = [...changes, ...skipped.map((s) => `↷ ${s}`), ...problems.map((p) => `✗ ${p}`)];
    const notes = [];
    if (touchedSubmitted) notes.push(dryRun ? "These cells belong to an already submitted timesheet — resubmit in Roar after filling." : "This timesheet was already submitted — review and resubmit it in Roar.");
    else if (!dryRun && changes.length) notes.push("Review and Submit in the Roar window.");
    return [head, ...lines.map((l) => `  ${l}`), ...notes.map((x) => `  ${x}`)].join("\n");
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
    description:
      "Sync a week of Zeff time into the Roar timesheet, one entry per booking (never summed): adds missing entries, updates changed durations and zeroes entries Zeff no longer has (for managedJobs, on days tracked in Zeff). Never submits.",
    inputSchema: {
      type: "object",
      properties: {
        weekStartIso: { type: "string", description: "Monday of the target week, YYYY-MM-DD." },
        rows: {
          type: "array",
          description: "One per job: { jobNumber, jobName, entriesByDay: { 'YYYY-MM-DD': [{ hours, comment }] }, workcode? } — each booking becomes one Roar entry.",
          items: { type: "object" },
        },
        managedJobs: {
          type: "array",
          description: "Job numbers Zeff is the source of truth for; their Roar entries not in Zeff are zeroed. Empty = only add (e.g. a reporter-filtered export).",
          items: { type: "string" },
        },
        dryRun: { type: "boolean", description: "Read Roar and list the changes a fill would make, without saving anything." },
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
