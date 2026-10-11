#!/usr/bin/env node
/**
 * timo-mcp — a stdio MCP server that records a week of Zeff working time into TimO®
 * (https://ac.timo24.de) with Playwright, deterministically (no LLM). It ATTACHES to
 * your already-signed-in Chrome over the DevTools port (default http://127.0.0.1:9222),
 * the same one used for Roar, so the corporate session is reused.
 *
 * Tools:
 *   timo_status                    -> is Chrome reachable, is TimO open & signed in
 *   timo_days {isoDays}            -> what TimO has on those days (attendance rows, absences) — read-only
 *   timo_export {days, dryRun}     -> working days become Kommt/Geht bookings (plus Pause Start/Pause Ende
 *                                     around each break) via "Anwesenheit erfassen"; absence days go through
 *                                     "Abwesenheit eintragen" (Urlaub = a leave request)
 *
 * TimO is an ExtJS 7 app with an icon-only toolbar (a button's label is its tooltip), so
 * buttons are located through Ext.ComponentQuery and form fields are set through the ExtJS
 * field API instead of typing (an Escape typed into a date field closes the whole dialog).
 * Re-running syncs: days TimO already has with the same times are skipped, ones with other times
 * are replaced (deleted like TimO's overview delete does, then booked again) — except days with
 * clock-ins from a terminal or the TimO app, which are never touched.
 * dryRun opens and fills each form, validates it and closes it without saving.
 */
import { connectToChrome, ChromeConnectError } from "../../../scripts/chrome-cdp.mjs";

const CDP = process.env.ROAR_CDP_ENDPOINT || "http://127.0.0.1:9222";
const TIMO_URL = "https://ac.timo24.de/timo/index.jsp";
const log = (...a) => process.stderr.write(`[timo-mcp] ${a.join(" ")}\n`);

async function connect() {
  return connectToChrome(CDP, { launchUrls: [TIMO_URL] });
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
/** "Mo 21.09." from an ISO date. */
function dayLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(y, m - 1, d).getDay()]} ${iso.slice(8)}.${iso.slice(5, 7)}.`;
}
/** "8:00" -> "08:00". */
function hhmm(t) {
  const [h = "0", m = "00"] = String(t || "").split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}
/** Decimal hours -> "HH:MM". */
function hoursHHMM(h) {
  const mins = Math.round((Number(h) || 0) * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}
const pause = (frame, ms) => frame.page().waitForTimeout(ms);
const oneLine = (s, n = 160) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

// ---------------------------------------------------------------------------
// ExtJS plumbing
// ---------------------------------------------------------------------------

/** In-page helpers on the TimO frame (window.__zeffTimo): the top-most dialog and the form inside it. */
function installHelpers(frame) {
  return frame.evaluate(() => {
    const E = window.Ext;
    if (!E || !E.ComponentQuery) return false;
    const vis = (c) => { try { return c.isVisible() && !c.isXType("toast"); } catch { return false; } };
    const z = (w) => { try { return parseInt(w.el.getStyle("z-index"), 10) || 0; } catch { return 0; } };
    const zt = {
      topWin: () => E.ComponentQuery.query("window").filter(vis).sort((a, b) => z(a) - z(b)).pop() || null,
      title: (w) => (w ? String(w.title || (w.getTitle && w.getTitle()) || "") : ""),
      /** The form panel in the top dialog that owns `method` (AttendanceEdit.saveData / AbsencePlanningNew.saveForm). */
      form: (method) => { const w = zt.topWin(); return w ? [w, ...w.query("*")].find((c) => typeof c[method] === "function" && c.getForm) || null : null; },
      text: (w) => { try { return String(w.el.dom.innerText || "").replace(/\s+/g, " ").trim(); } catch { return ""; } },
      busy: () => { try { const A = E.Ajax; return A.requests ? Object.keys(A.requests).length > 0 : !!A.isLoading(); } catch { return false; } },
    };
    window.__zeffTimo = zt;
    return true;
  }).catch(() => false);
}

/** Wait until TimO has no Ajax request in flight (quiet for 300 ms), at most `ms`. */
async function waitIdle(frame, ms = 4000) {
  const t0 = Date.now();
  let quietSince = 0;
  while (Date.now() - t0 < ms) {
    const busy = await frame.evaluate(() => (window.__zeffTimo ? window.__zeffTimo.busy() : false)).catch(() => false);
    if (busy) quietSince = 0;
    else if (!quietSince) quietSince = Date.now();
    else if (Date.now() - quietSince >= 300) return true;
    await pause(frame, 100);
  }
  return false;
}

async function waitDialog(frame, titleRe, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const title = await frame.evaluate(() => { const zt = window.__zeffTimo; return zt ? zt.title(zt.topWin()) : ""; }).catch(() => "");
    if (titleRe.test(title || "")) return true;
    await pause(frame, 150);
  }
  return false;
}

/** Close every open TimO dialog, top-most first — never saves. Returns the texts of message boxes closed. */
async function closeDialogs(frame) {
  const seen = [];
  for (let i = 0; i < 8; i++) {
    const r = await frame.evaluate(() => {
      const zt = window.__zeffTimo;
      const w = zt && zt.topWin();
      if (!w) return null;
      const txt = w.isXType("messagebox") ? zt.text(w) : "";
      w.close();
      return { txt };
    }).catch(() => null);
    if (!r) break;
    if (r.txt) seen.push(oneLine(r.txt, 120));
    await pause(frame, 250);
  }
  return seen;
}

/**
 * DOM id of a visible, enabled ExtJS button — by itemId, or by label (its text, else its tooltip:
 * TimO's toolbar is icon-only) — inside the top dialog, or in the main view (never inside a dialog).
 */
function buttonId(frame, { itemId, label, inDialog }) {
  return frame.evaluate(({ itemId, label, inDialog }) => {
    const E = window.Ext;
    let pool;
    if (inDialog) { const w = window.__zeffTimo && window.__zeffTimo.topWin(); pool = w ? w.query("button") : []; }
    else pool = E.ComponentQuery.query("button").filter((b) => !b.up("window"));
    const lbl = (b) => String((b.getText && b.getText()) || b.text || b.tooltip || "").trim();
    const b = pool.find((x) => { try { return x.isVisible(true) && !x.isDisabled() && (itemId ? x.itemId === itemId : lbl(x) === label); } catch { return false; } });
    return b && b.el ? b.el.dom.id : null;
  }, { itemId: itemId || null, label: label || null, inDialog: !!inDialog }).catch(() => null);
}

/** Click an ExtJS button like a user would; falls back to firing its handler if the element can't be clicked. */
async function clickButton(frame, spec) {
  const id = await buttonId(frame, spec);
  if (!id) return false;
  try {
    await frame.locator(`[id="${id}"]`).click({ timeout: 4000 });
    return true;
  } catch {
    return frame.evaluate((cid) => {
      const b = window.Ext.getCmp(cid);
      if (!b) return false;
      if (typeof b.fireHandler === "function") b.fireHandler();
      else if (typeof b.handler === "function") b.handler.call(b.scope || b, b);
      else return false;
      return true;
    }, id).catch(() => false);
  }
}

/** Run `trigger` (the save click) and wait for TimO's answer on `urlPart` (a PUT/POST). */
async function saveAndWait(frame, urlPart, trigger) {
  const respP = frame.page()
    .waitForResponse((r) => r.url().includes(urlPart) && r.request().method() !== "GET", { timeout: 20000 })
    .catch(() => null);
  if (!(await trigger())) return { ok: false, error: "save button not found" };
  const resp = await respP;
  if (!resp) {
    const msgs = await closeDialogs(frame);
    return { ok: false, error: `TimO sent no save request${msgs.length ? ` — ${msgs.join(" / ")}` : " (form rejected?)"}` };
  }
  return { ok: resp.status() < 400, status: resp.status(), body: oneLine(await resp.text().catch(() => ""), 300) };
}

// ---------------------------------------------------------------------------
// What TimO already has (read-only)
// ---------------------------------------------------------------------------

/**
 * Per ISO day: attendance spans ("08:49–17:30") and absence names ("Krank", "Urlaub") already
 * in TimO, plus the attendance day rows ({itemId, typ, start, end, net, canDelete}) for syncing.
 */
async function readExisting(frame, isoDays) {
  const months = [...new Set(isoDays.map((d) => d.slice(0, 7)))].map((m) => `${m}-15`);
  const years = [...new Set(isoDays.map((d) => Number(d.slice(0, 4))))];
  return frame.evaluate(async ({ months, years }) => {
    const E = window.Ext;
    const uid = (window.user && window.user.id) || (E.ComponentQuery.query("wtAttendanceOverview")[0] || {}).userId;
    if (!uid) return null;
    const get = (url, params) => new Promise((ok) => E.Ajax.request({ url, method: "GET", params, success: (x) => ok(x.responseText), failure: () => ok(null) }));
    const iso = (t) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    const out = {};
    const add = (day, kind, v) => { const e = (out[day] ||= { work: [], absence: [], rows: [] }); if (!e[kind].includes(v)) e[kind].push(v); };
    for (const date of months) {
      // The attendance overview in month mode (viewMode 2): one row per booking pair / absence day.
      let j = null;
      try { j = JSON.parse(await get("services/rest/wtoverview/griddataattendance", { userId: uid, date, central: false, viewMode: 2 })); } catch { return null; }
      for (const r of (j && j.data) || []) {
        const m = String(r["1"] || "").match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (!m) continue;
        const day = `${m[3]}-${m[2]}-${m[1]}`;
        if (r.entryTyp === 5) {
          // One row per day: first Kommt (29), last Geht (30), net hours (14); itemId is what TimO's delete takes.
          add(day, "work", `${r["29"] || "?"}–${r["30"] || "…"}`);
          out[day].rows.push({ itemId: r.itemId, typ: r.entryTyp, start: String(r["29"] || ""), end: String(r["30"] || ""), net: String(r["14"] || ""), canDelete: !!r.canDelete });
        }
        else if (r.entryTyp === 1) add(day, "absence", (String(r["28"] || "").match(/alt="([^"]+)"/) || [])[1] || "Abwesenheit");
      }
    }
    for (const year of years) {
      // Calendar absences (incl. leave requests) for the year.
      let ev = null;
      try { ev = JSON.parse(await get("services/rest/wtoverview/getukaevents", { userId: uid, year })); } catch { return null; }
      for (const e of ev || []) {
        if (!e || !e.startDate) continue;
        const s = new Date(e.startDate);
        const end = new Date(e.endDate || e.startDate);
        for (let t = new Date(s.getFullYear(), s.getMonth(), s.getDate()); t <= end; t.setDate(t.getDate() + 1)) add(iso(t), "absence", String(e.name || "Abwesenheit"));
      }
    }
    return out;
  }, { months, years }).catch(() => null);
}

// ---------------------------------------------------------------------------
// Working time: "Anwesenheit erfassen" (date + time + Kommt/Geht)
// ---------------------------------------------------------------------------

async function openAttendance(frame) {
  await closeDialogs(frame);
  if (!(await clickButton(frame, { label: "Anwesenheit erfassen" }))) return "the “Anwesenheit erfassen” button isn't visible — open TimO's Zeitbuchung view";
  if (!(await waitDialog(frame, /Anwesenheit erfassen/))) return "the Anwesenheit dialog did not open";
  await waitIdle(frame);
  return null;
}

/** Fill the open attendance form via the ExtJS field API and confirm the values stuck (TimO resets fields asynchronously). */
async function fillAttendance(frame, iso, time, art) {
  const [y, m, d] = iso.split("-").map(Number);
  // The booking types load on their own after the dialog opens (or only on the combo's first expand) — wait for them.
  for (let t0 = Date.now(); Date.now() - t0 < 10000; await pause(frame, 250)) {
    const n = await frame.evaluate(() => {
      const fp = window.__zeffTimo.form("saveData");
      const st = fp && fp.getForm().findField("art")?.getStore();
      if (!st) return -1;
      if (!st.getCount() && !(st.isLoading && st.isLoading()) && st.getProxy && st.getProxy().type !== "memory") st.load();
      return st.getCount();
    }).catch(() => -1);
    if (n > 0) break;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const set = await frame.evaluate(({ y, m, d, time, art }) => {
      const fp = window.__zeffTimo.form("saveData");
      if (!fp) return { err: "attendance form not found" };
      const F = (n) => fp.getForm().findField(n);
      const a = F("art");
      // TimO's booking types (getAttendanceTypes): Kommt, Geht, Pause Start, Pause Ende.
      const want = { "Pause Start": /^pause\s*(start|anfang|beginn)$/i, "Pause Ende": /^pause\s*ende$/i }[art] || new RegExp(`^${art}$`, "i");
      const idx = a.getStore().findBy((r) => want.test(String(r.get(a.displayField)).trim()));
      if (idx < 0) return { err: `TimO offers no booking type “${art}”` };
      const rec = a.getStore().getAt(idx);
      F("date").setValue(new Date(y, m - 1, d));
      F("time").setValue(time);
      a.setValue(rec.get(a.valueField));
      return { label: String(rec.get(a.displayField)).trim() };
    }, { y, m, d, time, art }).catch((e) => ({ err: oneLine(e, 120) }));
    if (set.err) return set.err;
    await waitIdle(frame, 3000);
    await pause(frame, 200);
    const v = await frame.evaluate(() => {
      const fp = window.__zeffTimo.form("saveData");
      if (!fp) return null;
      const F = (n) => fp.getForm().findField(n);
      return { date: F("date").getRawValue(), time: F("time").getRawValue(), art: F("art").getRawValue(), valid: fp.getForm().isValid() };
    }).catch(() => null);
    if (v && v.date === deDate(iso) && v.time === time && v.art.trim() === set.label) return v.valid ? null : "TimO rejects the booking form";
  }
  return "the booking form did not keep the values";
}

/**
 * A work day's bookings in order: Kommt at the start, Pause Start/Pause Ende around each
 * break, Geht at the end. TimO counts real pause bookings toward its automatic break — a
 * Geht/Kommt gap it doesn't, and deducts its Autopause on top.
 */
function workBookings(d) {
  const seq = [[hhmm(d.start), "Kommt"]];
  for (const b of d.breaks || []) seq.push([hhmm(b.start), "Pause Start"], [hhmm(b.end), "Pause Ende"]);
  seq.push([hhmm(d.end), "Geht"]);
  return seq;
}

/** "08:00–14:00 (06:00)" for TimO's day rows. */
const describeRows = (rows) => rows.map((r) => `${r.start}–${r.end} (${r.net})`).join(", ");

/** Whether TimO's day already matches the plan: one row with the same first Kommt, last Geht and net hours. */
function sameDay(rows, d) {
  return rows.length === 1 && rows[0].start === hhmm(d.start) && rows[0].end === hhmm(d.end) && rows[0].net === hoursHHMM(d.hours);
}

/** "terminal" / "mobile app" when a day's booking was stamped there (real clock-ins are never replaced). */
async function stampedBy(frame, rows) {
  for (const r of rows) {
    const b = await frame.evaluate((id) => new Promise((ok) => window.Ext.Ajax.request({
      url: "services/rest/wtoverview/getattendancetime", method: "GET", params: { id },
      success: (x) => { try { ok(JSON.parse(x.responseText)); } catch { ok(null); } }, failure: () => ok(null),
    })), r.itemId).catch(() => null);
    if (b && b.terminal) return "terminal";
    if (b && b.mobile) return "mobile app";
  }
  return null;
}

/**
 * Remove a day's attendance the way TimO's overview does (its delete button: deleteentry with
 * the day row's itemId), re-reading after each delete until the day is empty.
 */
async function deleteDayAttendance(frame, iso) {
  for (let i = 0; i < 8; i++) {
    const ex = await readExisting(frame, [iso]);
    if (!ex) return "couldn't read TimO";
    const row = ex[iso]?.rows?.[0];
    if (!row) return null;
    const err = await frame.evaluate(({ id, typ }) => new Promise((ok) => {
      const T = window.Timo && window.Timo.lib && window.Timo.lib.ExtAjax;
      (T || window.Ext.Ajax).request({
        url: "services/rest/wtoverview/deleteentry", method: "DELETE", params: { id, typ },
        success: () => ok(null),
        failure: (e) => ok(typeof e === "string" ? e : `HTTP ${(e && e.status) || "?"}`),
      });
    }), { id: row.itemId, typ: row.typ }).catch((e) => oneLine(e, 120));
    if (err) return oneLine(err, 160);
    await waitIdle(frame, 3000);
  }
  return "TimO still lists bookings on that day";
}

/**
 * Bring a day TimO already has in line with Zeff: delete its attendance and book it again.
 * Days TimO won't let you delete, or with terminal/app clock-ins, are left alone.
 */
async function replaceWorkDay(frame, d, rows, dryRun) {
  const was = describeRows(rows);
  if (rows.some((r) => !r.canDelete)) return { ok: false, text: `TimO has ${was} and won't let it be deleted — change that day in TimO` };
  const stamped = await stampedBy(frame, rows);
  if (stamped) return { ok: false, text: `TimO has ${was} clocked in by ${stamped} — not replaced` };
  if (dryRun) {
    const check = await checkWorkDay(frame, d);
    return check.ok ? { ok: true, text: `would replace ${was} → ${check.text}` } : check;
  }
  const delErr = await deleteDayAttendance(frame, d.iso);
  if (delErr) return { ok: false, text: `couldn't remove ${was}: ${delErr}` };
  const booked = await bookWorkDay(frame, d);
  return booked.ok ? { ok: true, text: `replaced ${was} → ${booked.text}` } : { ok: false, text: `removed ${was}, but ${booked.text}` };
}

async function checkWorkDay(frame, d) {
  const openErr = await openAttendance(frame);
  if (openErr) return { ok: false, text: openErr };
  const seq = workBookings(d);
  let err = null;
  for (const [time, art] of seq) {
    err = await fillAttendance(frame, d.iso, time, art);
    if (err) break;
  }
  await closeDialogs(frame);
  return err ? { ok: false, text: err } : { ok: true, text: `${seq.map(([t, a]) => `${t} ${a}`).join(" / ")} — form OK` };
}

async function bookWorkDay(frame, d) {
  const saved = [];
  const notes = [];
  const done = () => (saved.length ? `${saved.join(" + ")} saved, ` : "");
  for (const [time, art] of workBookings(d)) {
    const openErr = await openAttendance(frame);
    if (openErr) return { ok: false, text: `${done()}${art} failed: ${openErr}` };
    const fillErr = await fillAttendance(frame, d.iso, time, art);
    if (fillErr) { await closeDialogs(frame); return { ok: false, text: `${done()}${art} failed: ${fillErr}` }; }
    const res = await saveAndWait(frame, "/wtoverview/saveattendancetime", () => clickButton(frame, { itemId: "btnSave", inDialog: true }));
    await waitIdle(frame, 3000);
    await closeDialogs(frame);
    if (!res.ok) return { ok: false, text: `${done()}${art} ${time} NOT saved: ${res.error || `HTTP ${res.status} ${res.body}`}` };
    saved.push(`${time} ${art}`);
    if (res.body) notes.push(res.body);
  }
  return { ok: true, text: `${saved.join(" / ")} saved${notes.length ? ` (TimO: ${notes.join(" / ")})` : ""}` };
}

// ---------------------------------------------------------------------------
// Absences: "Abwesenheit eintragen" (type + from/to + full day)
// ---------------------------------------------------------------------------

async function openAbsence(frame) {
  await closeDialogs(frame);
  if (!(await clickButton(frame, { itemId: "btnNewApplication" }))) return "the “Abwesenheit eintragen” button isn't visible — open TimO's Zeitbuchung view";
  if (!(await waitDialog(frame, /Abwesenheit/))) return "the absence dialog did not open";
  await waitIdle(frame);
  return null;
}

/**
 * Fill the open absence form (type, single day, whole or half day) and read back what TimO made of it.
 * Day-based types such as Urlaub only offer "Halber Tag"; hour-based ones (Krank) get "Ganzer Tag" or hours.
 */
async function fillAbsence(frame, iso, type, hours, halfDay) {
  const [y, m, d] = iso.split("-").map(Number);
  for (let attempt = 0; attempt < 3; attempt++) {
    const err = await frame.evaluate(({ y, m, d, type, hours, halfDay }) => {
      const fp = window.__zeffTimo.form("saveForm");
      if (!fp) return "absence form not found";
      const F = (n) => fp.getForm().findField(n);
      const a = F("art");
      const rec = a.getStore().findRecord(a.displayField, type, 0, false, false, true);
      if (!rec) return `TimO offers no absence type “${type}”`;
      a.setValue(rec.get(a.valueField)); // TimO's change listener re-evaluates the form (approval, half day, …)
      const day = new Date(y, m - 1, d);
      F("from").setValue(day);
      F("to").setValue(day);
      const half = F("half_day");
      if (halfDay) {
        if (!half || !half.isVisible() || half.isDisabled()) return `TimO offers no half day for “${type}”`;
        half.setValue(true);
      } else {
        if (half && !half.isDisabled()) half.setValue(false);
        const full = F("full_day");
        if (full && full.isVisible() && !full.isDisabled()) full.setValue(true);
      }
      const h = F("hours"); // only if TimO still asks for hours
      if (h && h.isVisible() && !h.isDisabled() && !h.readOnly && !h.getValue()) h.setValue(hours);
      return null;
    }, { y, m, d, type, hours, halfDay: !!halfDay }).catch((e) => oneLine(e, 120));
    if (err) return { error: err };
    await waitIdle(frame, 3000);
    await pause(frame, 200);
    const v = await frame.evaluate(() => {
      const fp = window.__zeffTimo.form("saveForm");
      if (!fp) return null;
      const form = fp.getForm();
      const F = (n) => form.findField(n);
      const invalid = form.getFields().items
        .filter((f) => !f.isDisabled() && !f.isValid())
        .map((f) => String(f.fieldLabel || f.boxLabel || f.name || "?").replace(/[:*]/g, "").trim() + (f.isVisible() ? "" : " (hidden)"));
      let past = false;
      try { past = !!fp.isPastVacationApplication(form.getFieldValues()); } catch {}
      const btn = fp.down("#btnSave");
      return {
        art: F("art").getRawValue(), from: F("from").getRawValue(), to: F("to").getRawValue(),
        halfDay: F("half_day") ? !!F("half_day").getValue() : false,
        hours: F("hours") && F("hours").isVisible() ? F("hours").getRawValue() : "",
        valid: form.isValid(), invalid, past, approval: !!fp.isApplication, saveLabel: btn ? btn.getText() : "",
      };
    }).catch(() => null);
    if (v && v.art === type && v.from === deDate(iso) && v.to === deDate(iso) && v.halfDay === !!halfDay) {
      return v.valid ? { v } : { error: `TimO rejects the absence form (${v.invalid.join(", ") || "invalid"})` };
    }
  }
  return { error: "the absence form did not keep the values" };
}

function absenceSummary(type, v) {
  const span = v.halfDay ? "half day" : v.hours ? `${v.hours} h` : "full day";
  return `${type}, ${span}${v.approval ? " (leave request → approval)" : ""}`;
}

async function checkAbsence(frame, d) {
  const type = d.absenceType || "Urlaub";
  const openErr = await openAbsence(frame);
  if (openErr) return { ok: false, text: openErr };
  const f = await fillAbsence(frame, d.iso, type, hoursHHMM(d.hours || 8), d.halfDay);
  await closeDialogs(frame);
  if (f.error) return { ok: false, text: f.error };
  return { ok: true, text: `${absenceSummary(type, f.v)} — form OK${f.v.past ? "; TimO will ask to confirm a past date (accepted on fill)" : ""}` };
}

async function bookAbsence(frame, d) {
  const type = d.absenceType || "Urlaub";
  const openErr = await openAbsence(frame);
  if (openErr) return { ok: false, text: openErr };
  const f = await fillAbsence(frame, d.iso, type, hoursHHMM(d.hours || 8), d.halfDay);
  if (f.error) { await closeDialogs(frame); return { ok: false, text: f.error }; }
  const res = await saveAndWait(frame, "/wtoverview/saveapplication", () =>
    f.v.past
      ? // A past vacation date makes TimO ask "really request it?"; saveForm(true) is exactly its "Ja" path.
        frame.evaluate(() => { const fp = window.__zeffTimo.form("saveForm"); if (!fp) return false; fp.saveForm(true); return true; }).catch(() => false)
      : clickButton(frame, { itemId: "btnSave", inDialog: true }),
  );
  await waitIdle(frame, 3000);
  await closeDialogs(frame);
  if (!res.ok) return { ok: false, text: `${type} NOT saved: ${res.error || `HTTP ${res.status} ${res.body}`}` };
  // A non-empty answer means TimO found working time on that day and wants a second confirmation — not given.
  if (res.body) return { ok: false, text: `${type} NOT saved — TimO reports working time on that day (${oneLine(res.body, 100)})` };
  return { ok: true, text: `${absenceSummary(type, f.v)} saved${f.v.past ? " (past date confirmed)" : ""}` };
}

// ---------------------------------------------------------------------------

/**
 * Wait (up to `ms`) for TimO's ExtJS app to be up — a freshly started Chrome is still
 * booting it — and to show either your session or its sign-in form ("Anmelden"; TimO's
 * session doesn't survive a Chrome restart). frame is null when it never loads.
 */
async function waitForApp(page, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (isLoginUrl(page.url())) return { frame: null, signedIn: false };
    const frame = mainFrame(page);
    if (await installHelpers(frame)) {
      const state = await frame.evaluate(() => {
        try {
          if (window.user && window.user.id) return "in";
          const loginForm = window.Ext.ComponentQuery.query("button").some((b) => {
            try { return b.isVisible(true) && /^(Anmelden|Login|Sign in)$/i.test(String((b.getText && b.getText()) || b.text || "").trim()); } catch { return false; }
          });
          return loginForm ? "out" : "loading";
        } catch { return "loading"; }
      }).catch(() => "loading");
      if (state !== "loading") return { frame, signedIn: state === "in" };
    }
    await page.waitForTimeout(500);
  }
  return { frame: null, signedIn: false };
}

/** Switch TimO to its Zeitbuchung view (the toolbar the export uses) when it opened elsewhere. */
async function ensureZeitbuchung(frame) {
  if (await buttonId(frame, { label: "Anwesenheit erfassen" })) return true;
  if (!(await clickButton(frame, { label: "Zeitbuchung" }))) return false;
  for (let i = 0; i < 20; i++) {
    await pause(frame, 500);
    if (await buttonId(frame, { label: "Anwesenheit erfassen" })) return true;
  }
  return false;
}

const SIGN_IN_TIMO = "TimO shows its sign-in form — sign in in the Chrome window Zeff opened (ac.timo24.de), then retry.";

async function timoStatus() {
  let browser;
  try { browser = await connect(); }
  catch (e) {
    if (e instanceof ChromeConnectError) return e.message;
    return `Cannot reach Chrome on ${CDP}. Zeff starts it from Menu → Sign-ins (checkout: npm run roar:chrome); open TimO in that window. (${String(e).slice(0, 120)})`;
  }
  try {
    const page = await getTimoPage(browser);
    const { frame: f, signedIn } = await waitForApp(page);
    if (!f) return isLoginUrl(page.url()) ? SIGN_IN_TIMO : "Chrome is reachable, but the TimO app isn't loaded in that tab — open ac.timo24.de and retry.";
    if (!signedIn) return SIGN_IN_TIMO;
    const ready = await ensureZeitbuchung(f);
    return `Connected. TimO open and signed in.${ready ? "" : " Open the Zeitbuchung view (top menu) before exporting — its toolbar isn't visible."}`;
  } catch (e) {
    return `Connected to Chrome, but TimO isn't ready: ${String(e).slice(0, 160)}`;
  } finally { await browser.close().catch(() => {}); }
}

async function timoExport({ days, dryRun }) {
  if (!Array.isArray(days)) throw new Error("days[] is required.");
  const browser = await connect();
  try {
    const page = await getTimoPage(browser);
    const { frame, signedIn } = await waitForApp(page);
    if (!frame) throw new Error(isLoginUrl(page.url()) ? SIGN_IN_TIMO : "The TimO app isn't loaded in that tab — open ac.timo24.de and retry.");
    if (!signedIn) throw new Error(SIGN_IN_TIMO);
    await closeDialogs(frame); // clear any dialog left open (by a prior run or by hand)
    await ensureZeitbuchung(frame); // a fresh session opens elsewhere; the days report it if this failed

    const existing = await readExisting(frame, days.map((d) => d.iso));
    if (!existing && !dryRun) throw new Error("Could not read your existing TimO bookings, so duplicates can't be ruled out — nothing was written. Reload TimO and retry.");

    const lines = [];
    const count = { ok: 0, skip: 0, fail: 0 };
    for (const d of days) {
      const kind = d.kind === "absence" ? "absence" : "work";
      const ex = (existing && existing[d.iso]) || { work: [], absence: [], rows: [] };
      let r;
      if (kind === "absence" && ex.absence.length) r = { skip: `already ${ex.absence.join(", ")} in TimO` };
      else if (kind === "absence" && ex.work.length) r = { ok: false, text: `TimO has working time ${ex.work.join(", ")} that day — absence not entered` };
      else if (kind === "work" && ex.work.length && sameDay(ex.rows, d)) r = { skip: `already in TimO (${describeRows(ex.rows)})` };
      else if (kind === "work" && !ex.work.length && ex.absence.length && !d.withAbsence) r = { skip: `${ex.absence.join(", ")} in TimO — no working time added` };
      else {
        try {
          await installHelpers(frame);
          if (kind === "absence") r = dryRun ? await checkAbsence(frame, d) : await bookAbsence(frame, d);
          else if (ex.work.length) r = await replaceWorkDay(frame, d, ex.rows, dryRun); // differs from Zeff: sync it
          else r = dryRun ? await checkWorkDay(frame, d) : await bookWorkDay(frame, d);
        } catch (e) {
          await closeDialogs(frame).catch(() => {});
          r = { ok: false, text: oneLine(String(e?.message || e).split("\n")[0], 140) };
        }
      }
      const tag = dayLabel(d.iso);
      if (r.skip) { count.skip++; lines.push(`  ↷ ${tag}  skipped — ${r.skip}`); }
      else if (r.ok) { count.ok++; lines.push(`  ✓ ${tag}  ${r.text}`); }
      else { count.fail++; lines.push(`  ✗ ${tag}  ${r.text}`); }
    }
    const head = dryRun
      ? `Dry run — each form filled and checked in TimO, nothing saved (${count.ok} ready, ${count.skip} skipped, ${count.fail} problem${count.fail === 1 ? "" : "s"}):`
      : `TimO — ${count.ok} saved, ${count.skip} skipped, ${count.fail} problem${count.fail === 1 ? "" : "s"}:`;
    const note = existing ? "" : "\n  (couldn't read existing TimO bookings — duplicate check unavailable)";
    return `${head}\n${lines.join("\n")}${note}`;
  } finally { await browser.close().catch(() => {}); }
}

/**
 * What TimO has on the given days — read-only, nothing is changed: per ISO day its attendance
 * rows (first Kommt, last Geht, net "HH:MM") and absences. Returns JSON
 * { days: { [iso]: { work: [{ start, end, net }], absence: [names] } } }.
 */
async function timoDays({ isoDays }) {
  const list = [...new Set((Array.isArray(isoDays) ? isoDays : []).map(String))].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!list.length) throw new Error("isoDays (YYYY-MM-DD) is required.");
  const browser = await connect();
  try {
    const page = await getTimoPage(browser);
    const { frame, signedIn } = await waitForApp(page);
    if (!frame) throw new Error(isLoginUrl(page.url()) ? SIGN_IN_TIMO : "The TimO app isn't loaded in that tab — open ac.timo24.de and retry.");
    if (!signedIn) throw new Error(SIGN_IN_TIMO);
    let existing = await readExisting(frame, list);
    if (!existing) {
      await ensureZeitbuchung(frame); // your user id comes from its overview when TimO opened elsewhere
      existing = await readExisting(frame, list);
    }
    if (!existing) throw new Error("Could not read your TimO bookings — reload TimO and retry.");
    const days = {};
    for (const iso of list) {
      const ex = existing[iso] || { rows: [], absence: [] };
      days[iso] = { work: ex.rows.map((r) => ({ start: r.start, end: r.end, net: r.net })), absence: ex.absence };
    }
    return JSON.stringify({ days });
  } finally { await browser.close().catch(() => {}); }
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio server (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

const TOOLS = [
  { name: "timo_status", description: "Check whether Chrome is reachable and TimO is signed in.", inputSchema: { type: "object", properties: {} } },
  {
    name: "timo_days",
    description:
      "Read what TimO has on the given days — read-only, nothing is changed. Returns JSON { days: { [iso]: { work: [{ start, end, net }], absence: [names] } } } (work: TimO's attendance rows with first Kommt, last Geht and net hours).",
    inputSchema: {
      type: "object",
      properties: { isoDays: { type: "array", items: { type: "string" }, description: "Days as YYYY-MM-DD." } },
      required: ["isoDays"],
    },
  },
  {
    name: "timo_export",
    description:
      "Record days in TimO: working days as Kommt/Geht bookings (Pause Start/Pause Ende around each break), absence days via the absence form (Urlaub = leave request). Days TimO already has with the same times are skipped; ones with other times are replaced (deleted and booked again), except terminal/app clock-ins.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "array",
          description: "In order (a half day off before that day's work): { iso, kind: 'work'|'absence', start, end, breaks: [{start, end}], hours, absenceType, halfDay, withAbsence }.",
          items: { type: "object" },
        },
        dryRun: { type: "boolean", description: "Fill and validate each TimO form, then close it without saving." },
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
  if (method === "initialize") return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "timo", version: "0.2.0" } });
  if (method === "notifications/initialized") return;
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      if (name === "timo_status") return ok(id, textResult(await timoStatus()));
      if (name === "timo_days") return ok(id, textResult(await timoDays(args)));
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
