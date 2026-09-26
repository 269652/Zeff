"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteConnection } from "@/lib/calendar/microsoft";
import {
  applyTypeRulesToEntries,
  createEntry,
  deleteEntry,
  getJobNumberForTicket,
  reapplyMeetingJobRules,
  requireEntry,
  updateEntry,
} from "@/lib/entries";
import { errorMessage } from "@/lib/errors";
import { formatHours } from "@/lib/format";
import { createJob, deleteJob, updateJob } from "@/lib/jobs";
import type { EntryType } from "@/db/schema";

export type ActionState = { ok: boolean; error?: string; message?: string } | null;

function tagsFrom(fd: FormData): string[] {
  return fd.getAll("tags").map((v) => String(v).trim()).filter(Boolean);
}

function entryTypeFrom(fd: FormData): EntryType | undefined {
  const t = str(fd, "type");
  return t === "ticket" || t === "meeting" || t === "other" || t === "absence" || t === "internal" ? t : undefined;
}

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function num(fd: FormData, key: string): number | undefined {
  const s = str(fd, key);
  if (s === undefined) return undefined;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function int(fd: FormData, key: string): number | undefined {
  const n = num(fd, key);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

/** Everything reads from the same SQLite file, so refresh every route after a write. */
function revalidateAll() {
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Time entries
// ---------------------------------------------------------------------------

export async function createEntryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const hours = num(fd, "hours");
    if (hours === undefined) return { ok: false, error: "Hours is required (e.g. 1.5)." };
    const ticket = str(fd, "ticket");
    // Reuse the job a ticket was last booked on when none was chosen.
    const jobNumber = (str(fd, "jobNumber") ?? "") || (ticket ? getJobNumberForTicket(ticket) ?? "" : "");
    const entry = createEntry(
      {
        jobNumber,
        date: str(fd, "date") ?? "",
        hours,
        description: str(fd, "description") ?? "",
        ticket,
        type: entryTypeFrom(fd),
        tags: tagsFrom(fd),
        reportedBy: str(fd, "reportedBy"),
      },
      "web",
    );
    revalidateAll();
    return {
      ok: true,
      message: `Booked ${formatHours(entry.hours)}h on ${entry.job.number} for ${entry.date}.`,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateEntryAction(
  id: number,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  let date: string;
  try {
    const hours = num(fd, "hours");
    if (hours === undefined) return { ok: false, error: "Hours is required (e.g. 1.5)." };
    const entry = updateEntry(id, {
      jobNumber: str(fd, "jobNumber"),
      date: str(fd, "date"),
      hours,
      description: str(fd, "description"),
      ticket: str(fd, "ticket") ?? null,
      type: entryTypeFrom(fd),
      tags: tagsFrom(fd),
      reportedBy: str(fd, "reportedBy"),
    });
    date = entry.date;
    revalidateAll();
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  redirect(`/?week=${date}`);
}

/** Inline edit from the entries table: change just the hours of one entry. */
export async function updateEntryHoursAction(id: number, hours: number): Promise<ActionState> {
  try {
    if (!Number.isFinite(hours)) return { ok: false, error: "Enter hours as a number, e.g. 1.5." };
    const entry = updateEntry(id, { hours });
    revalidateAll();
    return { ok: true, message: `${formatHours(entry.hours)} h` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteEntryAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  let redirectTo: string | undefined;
  try {
    const entry = deleteEntry(id);
    redirectTo = str(fd, "redirectTo")?.replace("{date}", entry.date);
    revalidateAll();
  } catch (err) {
    console.error("deleteEntryAction", err);
    return;
  }
  if (redirectTo) redirect(redirectTo);
}

/** Duplicate an entry onto another day (same job, hours, description, ticket, type, tags). */
export async function copyEntryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = int(fd, "id");
  const date = str(fd, "date")?.trim();
  if (id === undefined) return { ok: false, error: "Missing entry to copy." };
  if (!date) return { ok: false, error: "Pick a day to copy to." };
  try {
    const src = requireEntry(id);
    createEntry(
      {
        jobNumber: src.job.number,
        date,
        hours: src.hours,
        description: src.description,
        ticket: src.ticket ?? undefined,
        type: src.type,
        reportedBy: src.reportedBy,
        tags: src.tags.map((t) => t.name),
      },
      "web",
    );
    revalidateAll();
    return { ok: true, message: `Copied ${formatHours(src.hours)} h to ${date}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function createJobAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const job = createJob({
      number: str(fd, "number") ?? "",
      name: str(fd, "name") ?? "",
      customer: str(fd, "customer"),
      description: str(fd, "description"),
    });
    revalidateAll();
    return { ok: true, message: `Created job ${job.number} — ${job.name}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateJobAction(
  id: number,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const job = updateJob(id, {
      number: str(fd, "number") ?? "",
      name: str(fd, "name") ?? "",
      customer: str(fd, "customer") ?? "",
      description: str(fd, "description") ?? "",
      active: fd.get("active") === "on",
    });
    revalidateAll();
    return { ok: true, message: `Saved job ${job.number}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function toggleJobActiveAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  try {
    updateJob(id, { active: fd.get("active") === "true" });
    revalidateAll();
  } catch (err) {
    console.error("toggleJobActiveAction", err);
  }
}

export async function deleteJobAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = int(fd, "id");
  if (id === undefined) return { ok: false, error: "Missing job id." };
  try {
    deleteJob(id);
    revalidateAll();
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  redirect("/jobs");
}

// ---------------------------------------------------------------------------
// Calendar import
// ---------------------------------------------------------------------------

export type ImportResult = { imported: number; skipped: number; errors: string[] };

/**
 * Books the ticked meetings of the import preview as time entries. Rows are
 * posted as indexed fields (include-0, externalId-0, date-0, …).
 */
export async function importMeetingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const count = int(fd, "rowCount") ?? 0;
  const week = str(fd, "week") ?? "";
  const reportedBy = str(fd, "reportedBy");
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  for (let i = 0; i < count; i++) {
    if (fd.get(`include-${i}`) !== "on") continue;
    const externalId = str(fd, `externalId-${i}`);
    const hours = num(fd, `hours-${i}`);
    if (!externalId || hours === undefined) {
      result.errors.push(`Row ${i + 1}: missing id or hours.`);
      continue;
    }
    try {
      createEntry(
        {
          jobNumber: str(fd, `job-${i}`) ?? "",
          date: str(fd, `date-${i}`) ?? "",
          hours,
          description: str(fd, `description-${i}`) ?? "",
          ticket: str(fd, `ticket-${i}`),
          reportedBy,
        },
        "calendar",
        { externalId },
      );
      result.imported++;
    } catch (err) {
      const msg = errorMessage(err);
      if (/UNIQUE constraint failed: time_entries\.external_id/.test(msg)) {
        result.skipped++;
      } else {
        result.errors.push(`${str(fd, `date-${i}`)} "${str(fd, `description-${i}`) ?? ""}": ${msg}`);
      }
    }
  }

  revalidateAll();
  if (result.errors.length > 0) {
    return {
      ok: false,
      error:
        `${result.imported} imported, ${result.skipped} skipped, ${result.errors.length} failed:\n` +
        result.errors.join("\n"),
    };
  }
  const params = new URLSearchParams({ imported: String(result.imported) });
  if (week) params.set("week", week);
  if (result.skipped) params.set("skipped", String(result.skipped));
  redirect(`/?${params}`);
}

export async function disconnectCalendarAction(): Promise<void> {
  deleteConnection();
  revalidateAll();
  redirect("/import");
}

// ---------------------------------------------------------------------------
// Calendar connection: device-code sign-in (no app registration needed)
// ---------------------------------------------------------------------------

const DEVICE_COOKIE = "zeff_devicecode";

export type DeviceCodeInfo = {
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresAt: number;
};

export type StartDeviceCodeResult =
  | { ok: true; info: DeviceCodeInfo }
  | { ok: false; error: string };

/** Begin device-code sign-in: returns the code the user types in the browser. */
export async function startDeviceCodeAction(): Promise<StartDeviceCodeResult> {
  try {
    const { getMicrosoftConfig } = await import("@/lib/calendar/config");
    const { startDeviceCode } = await import("@/lib/calendar/microsoft");
    const start = await startDeviceCode(getMicrosoftConfig());
    const expiresAt = Date.now() + start.expiresIn * 1000;
    const store = await cookies();
    store.set(DEVICE_COOKIE, JSON.stringify({ deviceCode: start.deviceCode, expiresAt }), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: start.expiresIn,
    });
    return {
      ok: true,
      info: {
        userCode: start.userCode,
        verificationUri: start.verificationUri,
        interval: start.interval,
        expiresAt,
      },
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export type PollDeviceCodeResult = { status: "pending" | "done" | "expired" | "error"; message?: string };

/** Poll once for the tokens; the client calls this on the interval Microsoft returned. */
export async function pollDeviceCodeAction(): Promise<PollDeviceCodeResult> {
  const store = await cookies();
  const raw = store.get(DEVICE_COOKIE)?.value;
  if (!raw) return { status: "error", message: "No sign-in in progress — start again." };

  let parsed: { deviceCode?: string; expiresAt?: number };
  try {
    parsed = JSON.parse(raw);
  } catch {
    store.delete(DEVICE_COOKIE);
    return { status: "error", message: "Sign-in state was invalid — start again." };
  }
  if (!parsed.deviceCode || !parsed.expiresAt || Date.now() > parsed.expiresAt) {
    store.delete(DEVICE_COOKIE);
    return { status: "expired" };
  }

  try {
    const { getMicrosoftConfig } = await import("@/lib/calendar/config");
    const { pollDeviceToken, saveConnection, decodeIdToken } = await import("@/lib/calendar/microsoft");
    const result = await pollDeviceToken(getMicrosoftConfig(), parsed.deviceCode);
    if (result.status === "done") {
      saveConnection(result.tokens, decodeIdToken(result.tokens.id_token));
      store.delete(DEVICE_COOKIE);
      revalidateAll();
      return { status: "done" };
    }
    if (result.status === "error") {
      store.delete(DEVICE_COOKIE);
      return { status: "error", message: result.message };
    }
    return { status: "pending" };
  } catch (err) {
    return { status: "error", message: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Calendar inbox (bookmarklet bridge): paste fallback + clear
// ---------------------------------------------------------------------------

export async function pasteEventsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const raw = str(fd, "json");
  if (!raw) return { ok: false, error: "Paste the JSON the bookmarklet produced." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That is not valid JSON." };
  }
  const events = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { events?: unknown }).events)
      ? (parsed as { events: unknown[] }).events
      : Array.isArray((parsed as { value?: unknown }).value)
        ? (parsed as { value: unknown[] }).value
        : null;
  if (!events) return { ok: false, error: "Expected { events: [...] } or an array of events." };

  const { mergeIntoInbox } = await import("@/lib/calendar/inbox");
  const { accepted, total } = mergeIntoInbox(events);
  revalidateAll();
  return { ok: true, message: `Loaded ${accepted} meetings (${total} in the inbox).` };
}

export async function clearInboxAction(): Promise<void> {
  const { clearInbox } = await import("@/lib/calendar/inbox");
  clearInbox();
  revalidateAll();
  redirect("/import");
}

// ---------------------------------------------------------------------------
// Working hours & absences
// ---------------------------------------------------------------------------

export async function saveScheduleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateWorkSchedule, WEEKDAY_KEYS } = await import("@/lib/schedule");
  try {
    const hours = Object.fromEntries(
      WEEKDAY_KEYS.map((k) => [k, num(fd, k) ?? 0]),
    ) as Record<(typeof WEEKDAY_KEYS)[number], number>;
    updateWorkSchedule(hours);
    revalidateAll();
    return { ok: true, message: "Working hours saved." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function createAbsenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { createAbsence } = await import("@/lib/schedule");
  try {
    const start = str(fd, "startDate") ?? "";
    const end = str(fd, "endDate") || start;
    const type = (str(fd, "type") ?? "vacation") as "vacation" | "sick" | "holiday" | "other";
    const hours = num(fd, "hours");
    const a = createAbsence({ startDate: start, endDate: end, type, hours: hours ?? null, note: str(fd, "note") ?? null });
    revalidateAll();
    return { ok: true, message: `Added ${type} ${a.startDate}${a.endDate !== a.startDate ? `–${a.endDate}` : ""}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteAbsenceAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  const { deleteAbsence } = await import("@/lib/schedule");
  try {
    deleteAbsence(id);
    revalidateAll();
  } catch (err) {
    console.error("deleteAbsenceAction", err);
  }
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function createTagAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { createTag } = await import("@/lib/tags");
  try {
    const tag = createTag(str(fd, "name") ?? "", str(fd, "color"));
    revalidateAll();
    return { ok: true, message: `Added tag #${tag.name}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function renameTagAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = int(fd, "id");
  if (id === undefined) return { ok: false, error: "Missing tag id." };
  const { renameTag } = await import("@/lib/tags");
  try {
    const tag = renameTag(id, str(fd, "name") ?? "", str(fd, "color") ?? null);
    revalidateAll();
    return { ok: true, message: `Saved #${tag.name}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteTagAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  const { deleteTag } = await import("@/lib/tags");
  try {
    deleteTag(id);
    revalidateAll();
  } catch (err) {
    console.error("deleteTagAction", err);
  }
}

// ---------------------------------------------------------------------------
// Report settings
// ---------------------------------------------------------------------------

export async function saveReportSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings } = await import("@/lib/report");
  const { parseRules } = await import("@/lib/report-shared");
  try {
    const rules = parseRules(str(fd, "rules") ?? null);
    updateReportSettings({ rules });
    revalidateAll();
    return { ok: true, message: "Report rules saved." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function saveMeetingJobRulesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings, parseMeetingJobRules } = await import("@/lib/report");
  const { listJobs } = await import("@/lib/jobs");
  try {
    const rules = parseMeetingJobRules(str(fd, "meetingJobRules") ?? null);
    const defaultJob = str(fd, "meetingDefaultJob") ?? null;
    if (defaultJob && !listJobs({ includeInactive: true }).some((j) => j.number === defaultJob)) {
      return { ok: false, error: `Unknown job ${defaultJob}.` };
    }
    updateReportSettings({ meetingJobRules: rules, meetingDefaultJob: defaultJob });
    // "Save & reapply" (apply=1): also re-book already imported meetings that match a rule.
    const moves = fd.get("apply") === "1" ? reapplyMeetingJobRules(rules) : null;
    revalidateAll();
    const saved = `Saved ${rules.length} meeting rule${rules.length === 1 ? "" : "s"}`;
    if (moves === null) return { ok: true, message: `${saved}.` };
    const shown = moves
      .slice(0, 5)
      .map((m) => `${m.date.slice(8)}.${m.date.slice(5, 7)}. “${m.description}” → ${m.to}`)
      .join("; ");
    return {
      ok: true,
      message:
        `${saved}; moved ${moves.length} imported meeting${moves.length === 1 ? "" : "s"}` +
        (moves.length ? `: ${shown}${moves.length > 5 ? "; …" : ""}.` : "."),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Exclude / Include toggle on the import page: excluding adds the meeting's title as an
 * exclude rule (unless one already matches it); including removes every rule matching it.
 * Returns the resulting rules so the page can re-check its other meetings.
 */
export async function setMeetingExcludedAction(
  title: string,
  exclude: boolean,
): Promise<{ ok: boolean; error?: string; rules?: string[] }> {
  const { getMeetingExcludeRules, getReportSettings, updateReportSettings } = await import("@/lib/report");
  const { isExcludedMeeting } = await import("@/lib/calendar/meetings");
  const t = (title ?? "").trim();
  if (!t) return { ok: false, error: "The meeting has no title." };
  try {
    const rules = getMeetingExcludeRules(getReportSettings());
    const next = exclude
      ? isExcludedMeeting(t, rules) ? rules : [...rules, t]
      : rules.filter((r) => !isExcludedMeeting(t, [r]));
    updateReportSettings({ meetingExcludeRules: next });
    revalidateAll();
    return { ok: true, rules: next };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Save the entry type rules; the "Save & apply" button (apply=1) also re-types existing entries. */
export async function saveTypeRulesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings } = await import("@/lib/report");
  const { parseTypeRules } = await import("@/lib/type-rules-shared");
  const { listJobs } = await import("@/lib/jobs");
  try {
    const rules = parseTypeRules(str(fd, "typeRules") ?? null);
    const known = new Set(listJobs({ includeInactive: true }).map((j) => j.number));
    const unknown = rules.find((r) => r.jobNumber && !known.has(r.jobNumber));
    if (unknown) return { ok: false, error: `Unknown job ${unknown.jobNumber}.` };
    updateReportSettings({ typeRules: rules });
    const applied = fd.get("apply") === "1" ? applyTypeRulesToEntries() : null;
    revalidateAll();
    const saved = `Saved ${rules.length} type rule${rules.length === 1 ? "" : "s"}`;
    return {
      ok: true,
      message: applied === null ? `${saved}.` : `${saved}; re-typed ${applied} existing entr${applied === 1 ? "y" : "ies"}.`,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function saveMeetingExcludeRulesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { parseMeetingExcludeRules, updateReportSettings } = await import("@/lib/report");
  try {
    const rules = parseMeetingExcludeRules(str(fd, "meetingExcludeRules") ?? null);
    updateReportSettings({ meetingExcludeRules: rules });
    revalidateAll();
    return { ok: true, message: `Saved ${rules.length} exclude rule${rules.length === 1 ? "" : "s"}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

export async function syncJiraAction(): Promise<ActionState> {
  const { syncFromJira } = await import("@/lib/jira/sync");
  try {
    const r = await syncFromJira();
    revalidateAll();
    return {
      ok: true,
      message: `Synced ${r.total} tickets — ${r.mine} yours, ${Math.max(0, r.total - r.mine)} teammates' on your boards (${r.inserted} new, ${r.updated} updated${r.deactivated ? `, ${r.deactivated} dropped` : ""})${r.titlesAdded ? `; +${r.titlesAdded} titles` : ""}.`,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function importJiraAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const raw = str(fd, "json");
  if (!raw) return { ok: false, error: "Paste the Jira issues JSON." };
  const { importPastedTickets } = await import("@/lib/jira/sync");
  try {
    const r = importPastedTickets(raw);
    revalidateAll();
    return { ok: true, message: `Imported ${r.total} tickets (${r.inserted} new, ${r.updated} updated).` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function setTicketJobAction(fd: FormData): Promise<void> {
  const key = str(fd, "key");
  if (!key) return;
  const { setTicketJob } = await import("@/lib/jira/store");
  try {
    setTicketJob(key, str(fd, "jobNumber") ?? null);
    revalidateAll();
  } catch (err) {
    console.error("setTicketJobAction", err);
  }
}

export async function clearJiraAction(): Promise<void> {
  const { clearJiraTickets } = await import("@/lib/jira/store");
  clearJiraTickets();
  revalidateAll();
  redirect("/jira");
}

export async function syncBoardsAction(): Promise<ActionState> {
  const { syncBoardsFromJira } = await import("@/lib/jira/boards");
  try {
    const r = await syncBoardsFromJira();
    revalidateAll();
    return {
      ok: true,
      message: `Synced ${r.enabledBoards} enabled of ${r.boards} boards (${r.projects} projects); matched ${r.mappedTickets} tickets.`,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function setBoardJobAction(fd: FormData): Promise<void> {
  const boardId = Number(str(fd, "boardId"));
  if (!Number.isFinite(boardId)) return;
  const { setBoardJob } = await import("@/lib/jira/store");
  try {
    setBoardJob(boardId, str(fd, "jobNumber") ?? null);
    revalidateAll();
  } catch (err) {
    console.error("setBoardJobAction", err);
  }
}

export async function setBoardEnabledAction(fd: FormData): Promise<void> {
  const boardId = Number(str(fd, "boardId"));
  if (!Number.isFinite(boardId)) return;
  const { setBoardEnabled } = await import("@/lib/jira/store");
  try {
    setBoardEnabled(boardId, fd.get("enabled") === "on");
    revalidateAll();
  } catch (err) {
    console.error("setBoardEnabledAction", err);
  }
}

// ---------------------------------------------------------------------------
// Chrono export (Playwright MCP, no LLM — attaches to your debug Chrome)
// ---------------------------------------------------------------------------

async function callChrono(tool: "chrono_status" | "chrono_export", args: Record<string, unknown>): Promise<string> {
  const path = await import("node:path");
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  const script = path.join(process.cwd(), "scripts", "chrono-mcp.mjs");
  const out = await runStdioSession(
    { command: process.execPath, args: [script], env: {}, label: "Chrono export" },
    async (call) => resultToPayload(await call(tool, args)),
    180000,
  );
  return typeof out === "string" ? out : JSON.stringify(out);
}

export async function chronoStatusAction(): Promise<ActionState> {
  try {
    return { ok: true, message: await callChrono("chrono_status", {}) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function exportToChronoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { resolveWeek } = await import("@/lib/week");
  const week = resolveWeek(str(fd, "week"));
  if (!week) return { ok: false, error: "Could not read the week." };
  const dryRun = fd.get("dryRun") === "on";
  const { getChronoExportPlan, toChronoPayload } = await import("@/lib/chrono");
  const { getReportSettings, getChronoWorkcodes } = await import("@/lib/report");
  const { listJobs } = await import("@/lib/jobs");
  const by = str(fd, "by");
  const plan = getChronoExportPlan(week, { reportedBy: by });
  if (plan.rows.length === 0) return { ok: false, error: "Nothing booked in this week to export." };
  // Attach any per-job WorkCode overrides (e.g. Abwesenheit → ABSENCE).
  const workcodes = getChronoWorkcodes(getReportSettings());
  const payload = toChronoPayload(plan);
  payload.rows = payload.rows.map((r) => ({ ...r, workcode: workcodes[r.jobNumber] || undefined }));
  // Zeff is the source of truth for its own jobs, so Chrono entries it no longer has get
  // zeroed — but never on a reporter-filtered (partial) export, which may only add.
  payload.managedJobs = by ? [] : listJobs({ includeInactive: true }).map((j) => j.number);
  try {
    const msg = await callChrono("chrono_export", { ...payload, dryRun });
    return { ok: true, message: msg };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function saveChronoWorkcodesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings, parseChronoWorkcodes } = await import("@/lib/report");
  try {
    const map = parseChronoWorkcodes(str(fd, "chronoWorkcodes") ?? null);
    updateReportSettings({ chronoWorkcodes: map });
    revalidateAll();
    const n = Object.keys(map).length;
    return { ok: true, message: `Saved ${n} WorkCode override${n === 1 ? "" : "s"}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Punch (attendance) export — Playwright MCP over the same debug Chrome
// ---------------------------------------------------------------------------

async function callPunch(tool: "punch_status" | "punch_export", args: Record<string, unknown>): Promise<string> {
  const path = await import("node:path");
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  const script = path.join(process.cwd(), "scripts", "punch-mcp.mjs");
  const out = await runStdioSession(
    { command: process.execPath, args: [script], env: {}, label: "Punch export" },
    async (call) => resultToPayload(await call(tool, args)),
    240000,
  );
  return typeof out === "string" ? out : JSON.stringify(out);
}

export async function punchStatusAction(): Promise<ActionState> {
  try {
    return { ok: true, message: await callPunch("punch_status", {}) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function savePunchConfigAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings } = await import("@/lib/report");
  try {
    const startTime = (str(fd, "startTime") ?? "").trim();
    updateReportSettings({
      punchConfig: {
        startTime: /^\d{1,2}:\d{2}$/.test(startTime) ? startTime : "08:00",
        workdayHours: num(fd, "workdayHours") ?? 8,
        breakMinutes: num(fd, "breakMinutes") ?? 30,
        absenceJobNumber: (str(fd, "absenceJobNumber") ?? "").trim(),
        absenceType: (str(fd, "absenceType") ?? "").trim() || "Urlaub",
      },
    });
    revalidateAll();
    return { ok: true, message: "Punch work day saved." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function exportToPunchAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { resolveWeek } = await import("@/lib/week");
  const week = resolveWeek(str(fd, "week"));
  if (!week) return { ok: false, error: "Could not read the week." };
  const dryRun = fd.get("dryRun") === "on";
  const fillGaps = fd.get("fillGaps") === "on";
  const { getPunchExportPlan, toPunchPayload } = await import("@/lib/punch");
  const { getReportSettings, getPunchConfig } = await import("@/lib/report");
  const plan = getPunchExportPlan(week, getPunchConfig(getReportSettings()), { reportedBy: str(fd, "by"), fillGaps });
  if (plan.days.length === 0) return { ok: false, error: "Nothing to record (no bookings; turn on gap-fill for default days)." };
  try {
    const msg = await callPunch("punch_export", { ...toPunchPayload(plan), dryRun });
    return { ok: true, message: msg };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
