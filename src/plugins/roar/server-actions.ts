"use server";

import { errorMessage } from "@/lib/errors";
import { revalidateAll, str, type ActionState } from "@/app/action-helpers";
import { callRoar } from "@/plugins/roar/call";

/** Roar: its server actions (each answers an ActionState unless it says otherwise). */

/**
 * "Sync with Roar" on the Jobs page: look every job up in Roar's own job search (read-only —
 * nothing is added in Roar) and remember whether Roar has it, with Roar's name for it.
 */
export async function syncRoarJobsAction(): Promise<ActionState> {
  try {
    const { listJobs, recordRoarLookup } = await import("@/lib/jobs");
    const numbers = listJobs({ includeInactive: true }).map((j) => j.number);
    if (numbers.length === 0) return { ok: false, error: "There are no jobs to look up." };
    const raw = await callRoar("roar_jobs", { jobNumbers: numbers });
    let results: { jobNumber: string; found?: boolean; name?: string; client?: string; group?: string; error?: string }[];
    try {
      results = (JSON.parse(raw) as { jobs?: typeof results }).jobs ?? [];
    } catch {
      return { ok: false, error: raw.slice(0, 300) };
    }
    const looked = results.flatMap((r) => (typeof r.found === "boolean" && !r.error ? [{ ...r, found: r.found }] : []));
    recordRoarLookup(looked);
    revalidateAll();
    const found = looked.filter((r) => r.found).length;
    const missing = looked.filter((r) => !r.found).map((r) => r.jobNumber);
    const failed = results.filter((r) => r.error).map((r) => `${r.jobNumber} (${r.error})`);
    const text =
      `${found} of ${numbers.length} jobs are in Roar` +
      (missing.length ? `; not found: ${missing.join(", ")}` : "") +
      (failed.length ? `; couldn't check: ${failed.join(", ")}` : "") +
      ".";
    return failed.length ? { ok: false, error: text } : { ok: true, message: text };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * "Pull Roar" on the weekly table: read the week's Roar entries with their approval status
 * (read-only — Roar's timesheet is only opened at that week) and keep them for the marks.
 */
export async function pullRoarAction(weekKey: string): Promise<ActionState> {
  try {
    const { resolveWeek } = await import("@/lib/week");
    const week = resolveWeek(weekKey);
    if (!week) return { ok: false, error: "Could not read the week." };
    const counts = await pullRoarWeek(week.startIso);
    revalidateAll();
    const n = [...counts.values()].reduce((a, b) => a + b, 0);
    if (n === 0) return { ok: true, message: "Roar has no entries in this week." };
    return { ok: true, message: `Pulled ${n} Roar entries: ${await statusCounts(counts)}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * "Pull Roar" on the monthly calendar: like pullRoarAction for every week of the month that
 * has begun — in one Roar visit (one reload, then week by week).
 */
export async function pullRoarMonthAction(monthKey: string): Promise<ActionState> {
  const { resolveMonth } = await import("@/lib/month");
  const month = resolveMonth(monthKey);
  if (!month) return { ok: false, error: "Could not read the month." };
  return pullRoarWeeks(month.weeks);
}

/** "Pull Roar" on the approvals card: the last full and the current month's weeks, in one Roar visit. */
export async function pullRoarApprovalsAction(): Promise<ActionState> {
  const { lastAndCurrentMonth } = await import("@/lib/month");
  const { last, current } = lastAndCurrentMonth();
  return pullRoarWeeks([...last.weeks, ...current.weeks]);
}

/** Pull the weeks that have begun (once each) in one Roar visit and keep them. */
async function pullRoarWeeks(all: import("@/lib/week").WeekInfo[]): Promise<ActionState> {
  try {
    const { pullRoarWeekStarts } = await import("@/lib/sync/pulls");
    const r = await pullRoarWeekStarts(all.map((w) => w.startIso));
    revalidateAll();
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Read one week's Roar entries (read-only in Roar) and keep them; returns how many there are per status. */
async function pullRoarWeek(weekStartIso: string): Promise<Map<string, number>> {
  const raw = await callRoar("roar_pull", { weekStartIso });
  let entries: import("@/lib/roar-status").RoarPulledEntry[];
  try {
    entries = (JSON.parse(raw) as { entries?: typeof entries }).entries ?? [];
  } catch {
    throw new Error(raw.slice(0, 300));
  }
  const { keepRoarPull } = await import("@/lib/sync/pulls");
  return keepRoarPull(weekStartIso, entries);
}

/** "6 approved, 4 submitted" in a fixed order. */
async function statusCounts(counts: Map<string, number>): Promise<string> {
  return (await import("@/lib/sync/pulls")).statusCounts(counts);
}

export async function roarStatusAction(): Promise<ActionState> {
  try {
    return { ok: true, message: await callRoar("roar_status", {}) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function exportToRoarAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { resolveWeek } = await import("@/lib/week");
  const week = resolveWeek(str(fd, "week"));
  if (!week) return { ok: false, error: "Could not read the week." };
  const dryRun = fd.get("dryRun") === "on";
  const { getRoarExportPlan, toRoarPayload } = await import("@/lib/roar");
  const { getReportSettings, getRoarWorkcodes } = await import("@/lib/report");
  const { listJobs } = await import("@/lib/jobs");
  const by = str(fd, "by");
  const plan = getRoarExportPlan(week, { reportedBy: by });
  if (plan.rows.length === 0) return { ok: false, error: "Nothing booked in this week to export." };
  // Attach any per-job WorkCode overrides (e.g. Abwesenheit → ABSENCE).
  const workcodes = getRoarWorkcodes(getReportSettings());
  const payload = toRoarPayload(plan);
  payload.rows = payload.rows.map((r) => ({ ...r, workcode: workcodes[r.jobNumber] || undefined }));
  // Zeff is the source of truth for its own jobs, so Roar entries it no longer has get
  // zeroed — but never on a reporter-filtered (partial) export, which may only add.
  payload.managedJobs = by ? [] : listJobs({ includeInactive: true }).map((j) => j.number);
  try {
    const msg = await callRoar("roar_export", { ...payload, dryRun });
    return { ok: true, message: msg };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function saveRoarWorkcodesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings, parseRoarWorkcodes } = await import("@/lib/report");
  try {
    const map = parseRoarWorkcodes(str(fd, "roarWorkcodes") ?? null);
    updateReportSettings({ roarWorkcodes: map });
    revalidateAll();
    const n = Object.keys(map).length;
    return { ok: true, message: `Saved ${n} WorkCode override${n === 1 ? "" : "s"}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
