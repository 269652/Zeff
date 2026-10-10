"use server";

import { automationEnv, driverPath } from "@/plugins/drivers";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { deleteConnection } from "@/lib/calendar/microsoft";
import {
  applyReportRuleTagsToEntries,
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
import { setPauses } from "@/lib/pauses";
import { setDefaultTags } from "@/lib/default-tags";
import { createJob, deleteJob, updateJob } from "@/lib/jobs";
import { createProject, deleteProject, updateProject } from "@/lib/projects";
import { parseBookOn } from "@/lib/projects-shared";
import { ENTRY_CONTEXT_PREFIX } from "@/lib/contexts-shared";
import type { EntryType } from "@/db/schema";

export type ActionState = { ok: boolean; error?: string; message?: string } | null;

function tagsFrom(fd: FormData, key = "tags"): string[] {
  return fd.getAll(key).map((v) => String(v).trim()).filter(Boolean);
}

/** The picked entry type (a configured type key, checked when the entry is saved). */
function entryTypeFrom(fd: FormData): EntryType | undefined {
  return str(fd, "type");
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
    const bookOn = parseBookOn(str(fd, "bookOn") ?? str(fd, "jobNumber"));
    // Reuse the job a ticket was last booked on when none was chosen.
    const ticketJob = !bookOn && ticket ? getJobNumberForTicket(ticket) : undefined;
    const target = bookOn ?? (ticketJob ? { jobNumber: ticketJob } : undefined);
    if (!target) return { ok: false, error: "Pick a job or a project to book on." };
    // "+ Add context": checked before booking, so a bad link or ticket doesn't leave the entry half-saved.
    const context = entryContextOf(fd);
    const contexts = context ? await import("@/lib/contexts") : null;
    if (context && contexts) {
      try {
        contexts.validateContextInput(context.input, { hasFiles: context.files.length + context.pasted.length > 0 });
      } catch (err) {
        return { ok: false, error: `Context: ${errorMessage(err)}` };
      }
    }
    const entry = createEntry(
      {
        ...target,
        date: str(fd, "date") ?? "",
        hours,
        description: str(fd, "description") ?? "",
        ticket,
        type: entryTypeFrom(fd),
        tags: tagsFrom(fd),
        reportedBy: str(fd, "reportedBy"),
      },
      "web",
      { defaultTags: false }, // the form pre-fills the defaults (and lets you remove them)
    );
    if (context && contexts) {
      try {
        await contexts.createContext(context.input, context.files, entry.id, context.pasted);
      } catch (err) {
        deleteEntry(entry.id); // both or neither — the form keeps everything to try again
        throw err;
      }
    }
    revalidateAll();
    const withContext = context ? " — with its context" : "";
    return {
      ok: true,
      message: entry.project
        ? `Booked ${formatHours(entry.hours)}h on ${entry.project.title} (${entry.job.name}) for ${entry.date}${withContext}.`
        : `Booked ${formatHours(entry.hours)}h on ${entry.job.number} for ${entry.date}${withContext}.`,
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
    const bookOn = parseBookOn(str(fd, "bookOn") ?? str(fd, "jobNumber"));
    const entry = updateEntry(id, {
      ...(bookOn && ("projectId" in bookOn ? bookOn : { jobNumber: bookOn.jobNumber, projectId: null })),
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

/** Default tags of a ticket (Jira tab): added to every entry booked on it. */
export async function setTicketTagsAction(ticket: string, tags: string[]): Promise<ActionState> {
  try {
    if (!ticket.trim()) return { ok: false, error: "Missing ticket." };
    const saved = setDefaultTags({ ticket }, tags);
    revalidateAll();
    return { ok: true, message: saved.length ? saved.map((t) => `#${t}`).join(" ") : "No default tags." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Set the break(s) of one or more days from the weekly table's Pause row ("12:00-12:30", "12 30m"; empty removes). */
export async function setPausesAction(dates: string[], text: string, defaultStart?: string): Promise<ActionState> {
  try {
    const saved = setPauses(dates, text, defaultStart);
    revalidateAll();
    const days = dates.length === 1 ? "" : ` on ${dates.length} days`;
    const what = saved.none ? "Marked as no break" : saved.pauses.length ? "Saved the break" : "Removed the break";
    return { ok: true, message: `${what}${days}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
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
        ...(src.projectId ? { projectId: src.projectId } : { jobNumber: src.job.number }),
        date,
        hours: src.hours,
        description: src.description,
        ticket: src.ticket ?? undefined,
        type: src.type,
        reportedBy: src.reportedBy,
        tags: src.tags.map((t) => t.name),
      },
      "web",
      { defaultTags: false }, // a copy keeps the original's tags
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
    setDefaultTags({ job: job.id }, tagsFrom(fd, "defaultTags"));
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
    setDefaultTags({ job: job.id }, tagsFrom(fd, "defaultTags"));
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
// Projects
// ---------------------------------------------------------------------------

function projectFields(fd: FormData) {
  return {
    title: str(fd, "title") ?? "",
    description: str(fd, "description") ?? "",
    customer: str(fd, "customer") ?? "",
    jobNumber: str(fd, "jobNumber") ?? "",
    startDate: str(fd, "startDate") ?? "",
    endDate: str(fd, "endDate") ?? "",
  };
}

export async function createProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const project = createProject(projectFields(fd));
    setDefaultTags({ project: project.id }, tagsFrom(fd, "defaultTags"));
    revalidateAll();
    return {
      ok: true,
      message: `Created project ${project.title}${project.job ? ` on ${project.job.number}` : " (no job yet)"}.`,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateProjectAction(
  id: number,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const { project, moved } = updateProject(id, { ...projectFields(fd), active: fd.get("active") === "on" });
    setDefaultTags({ project: project.id }, tagsFrom(fd, "defaultTags"));
    revalidateAll();
    const where = project.job ? `${project.job.number} — ${project.job.name}` : "No job yet";
    return {
      ok: true,
      message:
        `Saved project ${project.title}.` +
        (moved ? ` Moved ${moved} ${moved === 1 ? "entry" : "entries"} to ${where}.` : ""),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Book one entry per working day of a date range on a project (e.g. a 3-day training). */
export async function bookProjectDaysAction(
  projectId: number,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const { bookProjectDays } = await import("@/lib/project-days");
    const { booked, skipped } = bookProjectDays({
      projectId,
      from: str(fd, "from") ?? "",
      to: str(fd, "to") ?? "",
      hours: num(fd, "hours"),
      fillUp: fd.get("fillUp") === "on",
      description: str(fd, "description") ?? "",
      type: entryTypeFrom(fd),
    });
    revalidateAll();
    const total = booked.reduce((a, b) => a + b.hours, 0);
    const skippedText = skipped.length
      ? ` Skipped ${skipped.map((s) => `${s.date} (${s.reason})`).join(", ")}.`
      : "";
    if (booked.length === 0) return { ok: false, error: `Nothing to book.${skippedText}` };
    return {
      ok: true,
      message: `Booked ${formatHours(total)} h on ${booked.length} ${booked.length === 1 ? "day" : "days"}.${skippedText}`,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function toggleProjectActiveAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  try {
    updateProject(id, { active: fd.get("active") === "true" });
    revalidateAll();
  } catch (err) {
    console.error("toggleProjectActiveAction", err);
  }
}

export async function deleteProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = int(fd, "id");
  if (id === undefined) return { ok: false, error: "Missing project id." };
  try {
    deleteProject(id);
    revalidateAll();
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  redirect("/projects");
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
  // The Calendar tab stays on its week; the import page goes on to the weekly report.
  redirect(`${fd.get("returnTo") === "calendar" ? "/calendar" : "/"}?${params}`);
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

/** The default break on workdays (shown as a shadow in the Pause row) and whether Punch records it. */
export async function saveDefaultPausesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateDefaultPauses } = await import("@/lib/schedule");
  try {
    const s = updateDefaultPauses(str(fd, "defaultPauses") ?? "", fd.get("punchDefaultPauses") === "on");
    revalidateAll();
    return { ok: true, message: s.defaultPauses ? `Default break saved: ${s.defaultPauses}.` : "Default break removed." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Schedule → Flex time: the Gleitzeit job (none = off) and the comment its bookings get. */
export async function saveFlexTimeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const jobNumber = str(fd, "flexJobNumber") ?? null;
    const { getJobByNumber } = await import("@/lib/jobs");
    const job = jobNumber ? getJobByNumber(jobNumber) : undefined;
    if (jobNumber && !job) return { ok: false, error: `There's no job ${jobNumber}.` };
    const { getFlexTime, updateFlexTime } = await import("@/lib/schedule");
    const flex = getFlexTime(updateFlexTime({ jobNumber: job?.number ?? null, comment: str(fd, "flexComment") ?? "" }));
    revalidateAll();
    return { ok: true, message: job ? `Flex time goes to ${job.number} as “${flex.comment}”.` : "Flex time is off." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * The weekly table's flex-time row: book the days' missing hours on the Gleitzeit job with its
 * comment. The gaps are worked out from what's booked now, not taken from the page.
 */
export async function bookFlexTimeAction(dates: string[]): Promise<ActionState> {
  try {
    const { bookFlexTime } = await import("@/lib/flex-time");
    const r = bookFlexTime(Array.isArray(dates) ? dates.map(String) : []);
    if (!r.booked.length) {
      const why = r.skipped.map((s) => `${s.label} ${s.reason}`).join(", ");
      return { ok: false, error: `Nothing to book${why ? ` — ${why}` : ""}.` };
    }
    revalidateAll();
    const hours = r.booked.reduce((a, b) => a + b.hours, 0);
    return {
      ok: true,
      message: `Booked ${formatHours(hours)} h “${r.comment}” on ${r.jobNumber}: ${r.booked.map((b) => `${b.label} ${formatHours(b.hours)} h`).join(", ")}.`,
    };
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

// ---------------------------------------------------------------------------
// Entry types (Tags page)
// ---------------------------------------------------------------------------

export async function createEntryTypeAction(label: string, color: string): Promise<ActionState> {
  try {
    const { createEntryType } = await import("@/lib/entry-types");
    const t = createEntryType({ label, color });
    revalidateAll();
    return { ok: true, message: `Added type ${t.label}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Save renamed / recolored types. */
export async function saveEntryTypesAction(updates: { key: string; label: string; color: string }[]): Promise<ActionState> {
  try {
    const { updateEntryTypes } = await import("@/lib/entry-types");
    const n = updateEntryTypes(updates);
    revalidateAll();
    return { ok: true, message: `Saved ${n} ${n === 1 ? "type" : "types"}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteEntryTypeAction(key: string): Promise<ActionState> {
  try {
    const { deleteEntryType } = await import("@/lib/entry-types");
    deleteEntryType(key);
    revalidateAll();
    return { ok: true, message: "Type deleted." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

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

/** Save the report rules; "Save & tag existing entries" (apply=1) also gives older entries their rule's tags. */
export async function saveReportSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings } = await import("@/lib/report");
  const { parseRules } = await import("@/lib/report-shared");
  try {
    const rules = parseRules(str(fd, "rules") ?? null);
    updateReportSettings({ rules });
    const tagged = fd.get("apply") === "1" ? applyReportRuleTagsToEntries() : null;
    revalidateAll();
    return {
      ok: true,
      message: tagged === null ? "Report rules saved." : `Report rules saved; tagged ${tagged} existing entr${tagged === 1 ? "y" : "ies"}.`,
    };
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

async function callChrono(tool: "chrono_status" | "chrono_export" | "chrono_jobs" | "chrono_pull", args: Record<string, unknown>): Promise<string> {
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  const script = driverPath("chrono");
  return watchSignIn("chrono", async () => {
    const out = await runStdioSession(
      { command: process.execPath, args: [script], env: automationEnv(), label: tool === "chrono_jobs" ? "Chrono job sync" : tool === "chrono_pull" ? "Chrono pull" : "Chrono export" },
      async (call) => resultToPayload(await call(tool, args)),
      tool === "chrono_export" ? 600000 : 180000, // a full week's export can take minutes
    );
    return typeof out === "string" ? out : JSON.stringify(out);
  });
}

/** A service's sign-in shown in the automation Chrome (its tab at the front, else a new one) — you sign in there yourself. */
export async function openServiceLoginAction(service: string): Promise<ActionState> {
  try {
    const { openServiceLogin, SERVICE_LABELS } = await import("@/lib/attention");
    if (!(service in SERVICE_LABELS)) return { ok: false, error: "Unbekannter Dienst." };
    const r = await openServiceLogin(service as keyof typeof SERVICE_LABELS);
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The menu's "Anpassen": an application's place (header, menu, hidden) — or another entry hidden or shown. */
export async function saveMenuAction(change: { href: string; place?: string; hidden?: boolean }): Promise<ActionState> {
  try {
    const href = String(change?.href ?? "");
    if (!href.startsWith("/")) return { ok: false, error: "Kein Menüeintrag." };
    const { getMenuPrefs, setMenuPrefs } = await import("@/plugins/tabs");
    const cur = getMenuPrefs();
    if (change.place === "header" || change.place === "menu" || change.place === "hidden") setMenuPrefs({ place: { ...cur.place, [href]: change.place } });
    else if (typeof change.hidden === "boolean") setMenuPrefs({ hidden: change.hidden ? [...new Set([...cur.hidden, href])] : cur.hidden.filter((h) => h !== href) });
    revalidatePath("/", "layout");
    return { ok: true, message: "Gespeichert." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A header tab's dropdown (its plugin's entries — Kanban: the boards), loaded when it opens. */
export async function tabMenuAction(tab: string): Promise<import("@/plugins/tab-menus-shared").TabMenuItem[]> {
  try {
    return await (await import("@/plugins/tab-menus")).tabMenu(String(tab));
  } catch {
    return [];
  }
}

/** Gmail's settings, "Konto hinzufügen": Google's add-account sign-in in the automation Chrome — you sign in there yourself. */
export async function openGmailAddAccountAction(): Promise<ActionState> {
  try {
    const { openInAutomationChrome } = await import("@/lib/attention");
    const r = await openInAutomationChrome("https://accounts.google.com/AddSession?continue=https%3A%2F%2Fmail.google.com%2Fmail%2F&service=mail", "Googles Anmeldung");
    return r.ok ? { ok: true, message: "Googles Anmeldung ist im Automations-Chrome vorne — melde dich dort mit dem weiteren Konto an, dann hier „Neu laden“." } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Gmail's settings: the accounts its sync reads (address or Gmail's account number, and a name). */
export async function saveGmailAccountsAction(list: { account: string; label: string }[]): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("gmail")) return { ok: false, error: "Gmail ist nicht installiert." };
    const accounts = (Array.isArray(list) ? list : [])
      .map((a) => ({ account: String(a?.account ?? "").trim().toLowerCase(), label: String(a?.label ?? "").trim().slice(0, 40) }))
      .filter((a) => a.account);
    const bad = accounts.find((a) => !/^\d{1,2}$/.test(a.account) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.account));
    if (bad) return { ok: false, error: `„${bad.account}“: eine Adresse (name@gmail.com) oder Gmails Kontonummer (0, 1 …).` };
    if (new Set(accounts.map((a) => a.account)).size !== accounts.length) return { ok: false, error: "Ein Konto doppelt." };
    const { setGmailAccounts } = await import("@/plugins/gmail/accounts");
    setGmailAccounts(accounts.slice(0, 10));
    revalidateAll();
    return { ok: true, message: accounts.length ? `${accounts.length} Konto${accounts.length > 1 ? "en" : ""} — der nächste Sync liest sie.` : "Kein Konto — Gmail wird nicht gelesen." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The setup's end (or skipped): done — on to the sign-ins (Logins page). */
export async function finishSetupAction(): Promise<void> {
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ setupDoneAt: new Date().toISOString() });
  redirect("/logins?setup=1");
}

/** The setup skipped: done, home. */
export async function skipSetupAction(): Promise<void> {
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ setupDoneAt: new Date().toISOString() });
  redirect("/");
}

/** The Logins page: ask a service's driver whether it's signed in (read-only — nothing opened, Chrome not started). */
export async function checkLoginAction(service: string): Promise<ActionState> {
  try {
    const { SERVICE_LABELS } = await import("@/lib/attention");
    if (!(service in SERVICE_LABELS)) return { ok: false, error: "Unbekannter Dienst." };
    const { checkLogin } = await import("@/lib/logins");
    const r = await checkLogin(service as keyof typeof SERVICE_LABELS);
    revalidatePath("/logins");
    return r.state === "ok" ? { ok: true, message: r.detail } : { ok: false, error: r.detail };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The Logins page's "Alle prüfen": each checkable service in turn (they share one Chrome). */
export async function checkAllLoginsAction(): Promise<ActionState> {
  try {
    const { checkLogin, listLogins } = await import("@/lib/logins");
    const { logins } = await listLogins();
    let ok = 0;
    const todo = logins.filter((l) => l.checkable);
    for (const l of todo) if ((await checkLogin(l.service)).state === "ok") ok++;
    revalidatePath("/logins");
    return { ok: true, message: `${ok} von ${todo.length} angemeldet.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Signed in: try the service again (its sync, or its status) — the request goes once it works. */
export async function retryServiceAction(service: string): Promise<ActionState> {
  try {
    if (service === "teams") return await syncTeamsAction();
    if (service === "outlook" || service === "gmail") return await syncMailAction();
    if (service === "whatsapp") return await syncWhatsappAction();
    if (service === "keep") return await syncKeepAction();
    if (service === "gitlab") return await syncGitlabAction();
    if (service === "jira") {
      const { syncFromJira } = await import("@/lib/jira/sync");
      await syncFromJira();
      revalidateAll();
      return { ok: true, message: "Jira geht wieder." };
    }
    if (service === "chrono" || service === "punch") {
      const msg = service === "chrono" ? await callChrono("chrono_status", {}) : await callPunch("punch_status", {});
      revalidateAll();
      return /not signed in/i.test(msg) ? { ok: false, error: msg } : { ok: true, message: msg };
    }
    return { ok: false, error: "Unbekannter Dienst." };
  } catch (err) {
    revalidateAll();
    return { ok: false, error: errorMessage(err) };
  }
}

/** A request put off: gone till the service asks again. */
export async function dismissAttentionAction(key: string): Promise<ActionState> {
  const { clearAttention } = await import("@/lib/attention");
  clearAttention(String(key));
  revalidateAll();
  return { ok: true };
}

/**
 * A call to a service in the automation Chrome, watched for "sign in first": then you're asked
 * (a request on every page, a notification) — Zeff never signs in itself; once it works again,
 * the request goes.
 */
async function watchSignIn(service: "chrono" | "punch", fn: () => Promise<string>): Promise<string> {
  const { clearAttention, needsSignIn, raiseLogin } = await import("@/lib/attention");
  try {
    const out = await fn();
    if (/not signed in/i.test(out)) raiseLogin(service, out);
    else clearAttention(`login:${service}`);
    return out;
  } catch (e) {
    const message = errorMessage(e);
    if (needsSignIn(message)) raiseLogin(service, message);
    throw e;
  }
}

/**
 * "Sync with Chrono" on the Jobs page: look every job up in Chrono's own job search (read-only —
 * nothing is added in Chrono) and remember whether Chrono has it, with Chrono's name for it.
 */
export async function syncChronoJobsAction(): Promise<ActionState> {
  try {
    const { listJobs, recordChronoLookup } = await import("@/lib/jobs");
    const numbers = listJobs({ includeInactive: true }).map((j) => j.number);
    if (numbers.length === 0) return { ok: false, error: "There are no jobs to look up." };
    const raw = await callChrono("chrono_jobs", { jobNumbers: numbers });
    let results: { jobNumber: string; found?: boolean; name?: string; client?: string; group?: string; error?: string }[];
    try {
      results = (JSON.parse(raw) as { jobs?: typeof results }).jobs ?? [];
    } catch {
      return { ok: false, error: raw.slice(0, 300) };
    }
    const looked = results.flatMap((r) => (typeof r.found === "boolean" && !r.error ? [{ ...r, found: r.found }] : []));
    recordChronoLookup(looked);
    revalidateAll();
    const found = looked.filter((r) => r.found).length;
    const missing = looked.filter((r) => !r.found).map((r) => r.jobNumber);
    const failed = results.filter((r) => r.error).map((r) => `${r.jobNumber} (${r.error})`);
    const text =
      `${found} of ${numbers.length} jobs are in Chrono` +
      (missing.length ? `; not found: ${missing.join(", ")}` : "") +
      (failed.length ? `; couldn't check: ${failed.join(", ")}` : "") +
      ".";
    return failed.length ? { ok: false, error: text } : { ok: true, message: text };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * "Pull Chrono" on the weekly table: read the week's Chrono entries with their approval status
 * (read-only — Chrono's timesheet is only opened at that week) and keep them for the marks.
 */
export async function pullChronoAction(weekKey: string): Promise<ActionState> {
  try {
    const { resolveWeek } = await import("@/lib/week");
    const week = resolveWeek(weekKey);
    if (!week) return { ok: false, error: "Could not read the week." };
    const counts = await pullChronoWeek(week.startIso);
    revalidateAll();
    const n = [...counts.values()].reduce((a, b) => a + b, 0);
    if (n === 0) return { ok: true, message: "Chrono has no entries in this week." };
    return { ok: true, message: `Pulled ${n} Chrono entries: ${await statusCounts(counts)}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * "Pull Chrono" on the monthly calendar: like pullChronoAction for every week of the month that
 * has begun — in one Chrono visit (one reload, then week by week).
 */
export async function pullChronoMonthAction(monthKey: string): Promise<ActionState> {
  const { resolveMonth } = await import("@/lib/month");
  const month = resolveMonth(monthKey);
  if (!month) return { ok: false, error: "Could not read the month." };
  return pullChronoWeeks(month.weeks);
}

/** "Pull Chrono" on the approvals card: the last full and the current month's weeks, in one Chrono visit. */
export async function pullChronoApprovalsAction(): Promise<ActionState> {
  const { lastAndCurrentMonth } = await import("@/lib/month");
  const { last, current } = lastAndCurrentMonth();
  return pullChronoWeeks([...last.weeks, ...current.weeks]);
}

/** Pull the weeks that have begun (once each) in one Chrono visit and keep them. */
async function pullChronoWeeks(all: import("@/lib/week").WeekInfo[]): Promise<ActionState> {
  try {
    const { pullChronoWeekStarts } = await import("@/lib/sync/pulls");
    const r = await pullChronoWeekStarts(all.map((w) => w.startIso));
    revalidateAll();
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Read one week's Chrono entries (read-only in Chrono) and keep them; returns how many there are per status. */
async function pullChronoWeek(weekStartIso: string): Promise<Map<string, number>> {
  const raw = await callChrono("chrono_pull", { weekStartIso });
  let entries: import("@/lib/chrono-status").ChronoPulledEntry[];
  try {
    entries = (JSON.parse(raw) as { entries?: typeof entries }).entries ?? [];
  } catch {
    throw new Error(raw.slice(0, 300));
  }
  const { keepChronoPull } = await import("@/lib/sync/pulls");
  return keepChronoPull(weekStartIso, entries);
}

/** "6 approved, 4 submitted" in a fixed order. */
async function statusCounts(counts: Map<string, number>): Promise<string> {
  return (await import("@/lib/sync/pulls")).statusCounts(counts);
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
// Outlook calendar sync — Playwright MCP over the same debug Chrome (read-only)
// ---------------------------------------------------------------------------

/**
 * "Sync" on the Calendar tab: read the calendar from Outlook in the automation Chrome
 * (read-only) — every week from the start of last month to the end of next week, plus the
 * week shown — into the meeting inbox, each week replacing what was there.
 */
export async function syncOutlookAction(weekKey: string): Promise<ActionState> {
  try {
    const { currentWeek, resolveWeek } = await import("@/lib/week");
    const { outlookWeeks, syncOutlookWeekStarts } = await import("@/lib/sync/pulls");
    const r = await syncOutlookWeekStarts(await outlookWeeks((resolveWeek(weekKey) ?? currentWeek()).startIso));
    revalidateAll();
    return { ok: true, message: `Synced ${r.weeks} week${r.weeks === 1 ? "" : "s"} from Outlook — ${r.events} events.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Punch (attendance) export — Playwright MCP over the same debug Chrome
// ---------------------------------------------------------------------------

async function callPunch(tool: "punch_status" | "punch_days" | "punch_export", args: Record<string, unknown>): Promise<string> {
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  const script = driverPath("punch");
  return watchSignIn("punch", async () => {
    const out = await runStdioSession(
      { command: process.execPath, args: [script], env: automationEnv(), label: tool === "punch_days" ? "Punch pull" : "Punch export" },
      async (call) => resultToPayload(await call(tool, args)),
      240000,
    );
    return typeof out === "string" ? out : JSON.stringify(out);
  });
}

/** Read what Punch has on these days (read-only) and keep it for the weekly Punch marks. */
async function pullPunchDays(isoDays: string[]): Promise<void> {
  const { pullPunchIsoDays } = await import("@/lib/sync/pulls");
  await pullPunchIsoDays(isoDays);
}

/**
 * "Pull Punch" on the weekly table: read what Punch has on the week's days — read-only, nothing
 * changes in Punch — for the Booked row's marks (blue ✓ where Punch has Zeff's hours).
 */
export async function pullPunchAction(weekKey: string): Promise<ActionState> {
  try {
    const { isoDate, resolveWeek } = await import("@/lib/week");
    const week = resolveWeek(weekKey);
    if (!week) return { ok: false, error: "Could not read the week." };
    await pullPunchDays(week.days.map(isoDate));
    revalidateAll();
    const { punchDayStates } = await import("@/lib/punch-status");
    const { states } = punchDayStates(week);
    const synced = states.filter((s) => s?.state === "synced").length;
    const differs = states.filter((s) => s?.state === "differs").length;
    if (!synced && !differs) return { ok: true, message: "Punch has nothing in this week yet." };
    return { ok: true, message: `Punch: ${synced} day${synced === 1 ? "" : "s"} as in Zeff${differs ? `, ${differs} different` : ""}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
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
    if (!dryRun) {
      // What Punch has now, for the weekly Punch marks (read-only; the export's own result stands either way).
      const { isoDate } = await import("@/lib/week");
      await pullPunchDays(week.days.map(isoDate)).catch(() => {});
      revalidateAll();
    }
    return { ok: true, message: msg };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Context (colleagues' messages, Teams messages, Jira comments behind entries)
// ---------------------------------------------------------------------------

/**
 * A context form's fields: kind, headline, author, date, ticket, message and its links
 * (link-url-i / link-label-i) — each name with `p` in front (the entry form's "Add context").
 */
function contextInputOf(fd: FormData, p = ""): import("@/lib/contexts-shared").ContextInput {
  const links = Array.from({ length: int(fd, `${p}linkCount`) ?? 0 }, (_, i) => ({
    url: str(fd, `${p}link-url-${i}`) ?? "",
    label: str(fd, `${p}link-label-${i}`) ?? null,
  }));
  const body = fd.get(`${p}body`);
  return {
    kind: (str(fd, `${p}kind`) ?? "note") as import("@/lib/contexts-shared").ContextKind,
    title: str(fd, `${p}title`) ?? null,
    author: str(fd, `${p}author`) ?? null,
    body: typeof body === "string" ? body : "",
    links,
    date: str(fd, `${p}date`) ?? null,
    ticket: str(fd, `${p}ticket`) ?? null,
  };
}

/** The files a context form uploads (the browser posts an empty one when none was picked). */
function contextFilesOf(fd: FormData, p = ""): File[] {
  return fd.getAll(`${p}files`).filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
}

/** Pictures pasted into the message: each with the token its ![image](paste:token) reference uses. */
function contextPastedOf(fd: FormData, p = ""): { token: string; file: File }[] {
  return Array.from({ length: int(fd, `${p}pastedCount`) ?? 0 }, (_, i) => ({ token: str(fd, `${p}pasted-token-${i}`) ?? "", file: fd.get(`${p}pasted-file-${i}`) }))
    .filter((x): x is { token: string; file: File } => !!x.token && typeof x.file === "object" && x.file !== null && "arrayBuffer" in x.file);
}

/** The entry form's "+ Add context" (ctx- fields), when something was written there — else null. */
function entryContextOf(fd: FormData) {
  if (!fd.has(`${ENTRY_CONTEXT_PREFIX}linkCount`)) return null;
  const input = contextInputOf(fd, ENTRY_CONTEXT_PREFIX);
  const files = contextFilesOf(fd, ENTRY_CONTEXT_PREFIX);
  const pasted = contextPastedOf(fd, ENTRY_CONTEXT_PREFIX);
  const written = input.body.trim() || input.title || input.links.some((l) => l.url.trim()) || files.length || pasted.length;
  return written ? { input, files, pasted } : null;
}

/**
 * Pictures pasted as links (a GitLab or Jira screenshot): download them, to keep with the item
 * as its own files — straight from the web, or through the automation Chrome for sites you're
 * signed in to there. Read-only.
 */
export async function fetchImagesAction(urls: string[]): Promise<import("@/lib/contexts-shared").FetchedImage[]> {
  if (!Array.isArray(urls)) return [];
  const { fetchRemoteImages } = await import("@/lib/remote-images");
  return fetchRemoteImages(urls.map(String));
}

// ---------------------------------------------------------------------------
// Teams (mentions and 1:1 messages, read from Teams in the automation Chrome)
// ---------------------------------------------------------------------------

/** "Sync now" on the Teams page: read Teams' own cache in the automation Chrome (read-only; opens Teams there if needed). */
export async function syncTeamsAction(): Promise<ActionState> {
  const { syncTeams } = await import("@/lib/teams/sync");
  const r = await syncTeams();
  revalidateAll();
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

/** Mails matching words (sender, subject, text) — for the source picker; a few, newest first. */
export async function searchMailsAction(q: string): Promise<import("@/lib/mail/shared").MailView[]> {
  const text = String(q ?? "").trim();
  if (text.length < 2) return [];
  const { listMails } = await import("@/lib/mail/store");
  return listMails({ q: text, limit: 6 });
}

/** "Sync now" on the Nachrichten page: read the inbox's latest mails in the automation Chrome (read-only: none opened; opens Outlook's mail there if needed). */
export async function syncMailAction(): Promise<ActionState> {
  const { syncMail } = await import("@/lib/mail/sync");
  const r = await syncMail();
  revalidateAll();
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

/** Which Outlook folders the mail sync reads, by name as Outlook lists them ("Posteingang, Notifications"). */
export async function saveMailFoldersAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const text = String(fd.get("folders") ?? "");
  const folders = [...new Set(text.split(",").map((f) => f.trim()).filter(Boolean))].slice(0, 12);
  if (!folders.length) return { ok: false, error: "Mindestens ein Ordner (z. B. Posteingang)." };
  const { updateMailSettings } = await import("@/lib/mail/store");
  updateMailSettings({ folders });
  revalidateAll();
  return { ok: true, message: `Liest: ${folders.join(", ")}.` };
}

/** "WhatsApp syncen" on the Nachrichten page: the chats' latest messages from WhatsApp Web's chat list (no chat opened) — through the Sync menu's step, so it records how it went. */
export async function syncWhatsappAction(): Promise<ActionState> {
  if (!(await import("@/plugins/state")).isInstalled("whatsapp")) return { ok: false, error: "WhatsApp ist nicht installiert (Menü → Plugins)." };
  const { syncAndWait } = await import("@/lib/sync/registry");
  const r = await syncAndWait("whatsapp");
  revalidateAll();
  return r.lastOk ? { ok: true, message: r.lastMessage ?? "" } : { ok: false, error: r.lastMessage ?? "Fehlgeschlagen." };
}

/** "Keep syncen" in the Keep app: your Google Keep notes — through the Sync menu's step, so it records how it went. */
export async function syncKeepAction(): Promise<ActionState> {
  if (!(await import("@/plugins/state")).isInstalled("keep")) return { ok: false, error: "Google Keep ist nicht installiert (Menü → Plugins)." };
  const { syncAndWait } = await import("@/lib/sync/registry");
  const r = await syncAndWait("keep");
  revalidateAll();
  return r.lastOk ? { ok: true, message: r.lastMessage ?? "" } : { ok: false, error: r.lastMessage ?? "Fehlgeschlagen." };
}

/** Which of these links point at a synced Teams message — that message, by link (null when none). */
export async function findTeamsMessagesAction(urls: string[]): Promise<Record<string, import("@/lib/teams/shared").TeamsMessageView | null>> {
  if (!Array.isArray(urls)) return {};
  const { teamsLinkKey } = await import("@/lib/teams/shared");
  const { teamsMessagesByKeys } = await import("@/lib/teams/store");
  const list = urls.map(String).slice(0, 50);
  const found = teamsMessagesByKeys(list.map((u) => teamsLinkKey(u) ?? ""));
  return Object.fromEntries(list.map((u) => [u, found.get(teamsLinkKey(u) ?? "") ?? null]));
}

/** The context form's Teams picker: synced messages matching the words, newest first. */
export async function searchTeamsMessagesAction(q: string): Promise<import("@/lib/teams/shared").TeamsMessageView[]> {
  const { listTeamsMessages } = await import("@/lib/teams/store");
  return listTeamsMessages({ q: String(q ?? "").slice(0, 1000), limit: 8 });
}

// ---------------------------------------------------------------------------
// GitLab (merge requests, their comments, your branches — read through the automation Chrome)
// ---------------------------------------------------------------------------

/** "Sync now" on the GitLab page: GET requests to GitLab's API from a GitLab tab in the automation Chrome (opens one if needed). */
export async function syncGitlabAction(): Promise<ActionState> {
  const { syncGitlab } = await import("@/lib/gitlab/sync");
  const r = await syncGitlab();
  revalidateAll();
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

/** Your GitLab's address (how often it syncs: the Sync settings page). */
export async function saveGitlabSyncAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const base = (str(fd, "baseUrl") ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+$/.test(base)) return { ok: false, error: "Your GitLab's address, like https://git.example.com" };
  const { updateGitlabSettings } = await import("@/lib/gitlab/store");
  updateGitlabSettings({ baseUrl: base });
  revalidateAll();
  return { ok: true, message: `Reads ${new URL(base).host}.` };
}

// ---------------------------------------------------------------------------
// Boards (your tickets gone through the Claude CLI: what happened, what's to do)
// ---------------------------------------------------------------------------

/** "Run now": the run starts in the background — the Boards page follows it. */
export async function runBoardAction(): Promise<ActionState> {
  const { startBoardRun } = await import("@/lib/boards/run");
  // By hand: Jira synced first, then the analysis.
  const r = startBoardRun({ syncJira: true });
  revalidatePath("/todos");
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

/** Which tickets on the chosen boards (a JQL filter) — how often a run goes by itself: the Sync settings page. */
export async function saveBoardSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const jql = (str(fd, "jql") ?? "").trim();
  if (jql.length < 5) return { ok: false, error: "Ein JQL-Filter, z. B.: assignee = currentUser() AND resolution = Unresolved" };
  const { updateBoardSettings } = await import("@/lib/boards/store");
  updateBoardSettings({ jql: jql.slice(0, 1000) });
  revalidatePath("/todos");
  return { ok: true, message: "Gespeichert." };
}

/** The Sync settings page: how often one sync runs by itself (an installed plugin's — its settings module sets it). */
export async function saveSyncIntervalAction(key: string, minutes: number): Promise<ActionState> {
  const { findSyncInterval } = await import("@/plugins/sync-settings-modules");
  const i = findSyncInterval(String(key));
  if (!i) return { ok: false, error: "Diesen Sync gibt es nicht (Plugin nicht installiert?)." };
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m < 0 || m > Math.max(...i.choices, i.get())) return { ok: false, error: "Kein gültiges Intervall." };
  i.set(m);
  revalidateAll();
  const { minutesText } = await import("@/plugins/sync-settings");
  return { ok: true, message: minutesText(m) };
}

// ---------------------------------------------------------------------------
// The header's sync menu (every sync, its last run, its next)
// ---------------------------------------------------------------------------

/** Every sync step: running?, how it last went, when it runs next by itself. */
export async function syncOverviewAction(): Promise<import("@/lib/sync/shared").SyncOverview> {
  const { syncOverview } = await import("@/lib/sync/registry");
  return syncOverview();
}

/** One step, started in the background (the menu follows it). */
export async function runSyncAction(key: string): Promise<ActionState> {
  const { isSyncKey } = await import("@/lib/sync/shared");
  if (!isSyncKey(key)) return { ok: false, error: "Unknown sync." };
  const { startSync } = await import("@/lib/sync/registry");
  const r = startSync(key);
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

/** "Sync all": every step one after the other, in the background. */
export async function runSyncAllAction(): Promise<ActionState> {
  const { startSyncAll } = await import("@/lib/sync/registry");
  const r = startSyncAll();
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

// ---------------------------------------------------------------------------
// Settings (app-wide: the AI provider analyses run through)
// ---------------------------------------------------------------------------

/** The AI provider (Claude Code or Copilot CLI) and each one's model. */
export async function saveAiSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { isAiProvider, isClaudeModel, AI_PROVIDER_INFO } = await import("@/lib/ai/shared");
  const provider = str(fd, "aiProvider") ?? "";
  if (!isAiProvider(provider)) return { ok: false, error: "Unknown provider." };
  const claudeModel = str(fd, "claudeModel") ?? "";
  if (!isClaudeModel(claudeModel)) return { ok: false, error: "Unknown Claude model." };
  const copilotModel = (str(fd, "copilotModel") ?? "").trim();
  if (copilotModel && !/^[\w.:-]{2,60}$/.test(copilotModel)) return { ok: false, error: "A Copilot model name, like gpt-5.4 or claude-haiku-4.5." };
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: provider, claudeModel, copilotModel });
  revalidateAll();
  return { ok: true, message: `Analyses now run through the ${AI_PROVIDER_INFO[provider].label}.` };
}

/** A short test of a provider: is it there and signed in? Answers with its time and model. */
export async function testAiAction(provider: string): Promise<ActionState> {
  try {
    const { isAiProvider } = await import("@/lib/ai/shared");
    if (!isAiProvider(provider)) return { ok: false, error: "Unknown provider." };
    const { runAi } = await import("@/lib/ai");
    const t0 = Date.now();
    const r = await runAi<{ ok: boolean }>("Antworte mit ok = true.", { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }, { provider, timeoutMs: 120000, maxBudgetUsd: 0.2 });
    if (r.output?.ok !== true) return { ok: false, error: "It answered, but not as asked." };
    const cost = r.costUsd != null ? ` · ≈ ${r.costUsd.toFixed(3)} $` : "";
    return { ok: true, message: `Works: answered in ${Math.round((Date.now() - t0) / 1000)} s${r.model ? ` · ${r.model}` : ""}${cost}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A Jira comment marked done (or not): no new todos from it. */
export async function setJiraCommentResolvedAction(commentId: string, ticket: string, resolved: boolean): Promise<ActionState> {
  if (!/^\d+$/.test(String(commentId)) || !/^[A-Z][A-Z0-9]+-\d+$/i.test(String(ticket))) return { ok: false, error: "Unbekannter Kommentar." };
  const { setJiraCommentResolved } = await import("@/lib/resolved");
  setJiraCommentResolved(String(commentId), String(ticket), !!resolved);
  revalidatePath("/todos");
  return { ok: true };
}

/** A Teams message marked done (or not): no new todos from it. */
export async function setTeamsResolvedAction(key: string, resolved: boolean): Promise<ActionState> {
  if (!String(key).includes("|")) return { ok: false, error: "Unknown message." };
  const { setTeamsResolved } = await import("@/lib/resolved");
  setTeamsResolved(String(key), !!resolved);
  revalidateAll();
  return { ok: true };
}

/**
 * A GitLab comment marked done (or open again): a thread GitLab resolves is resolved (reopened)
 * there too — through its API in the automation Chrome; either way no new todos from it.
 */
export async function setGitlabResolvedAction(key: string, resolved: boolean): Promise<ActionState> {
  try {
    if (!/^note:\d+$/.test(String(key))) return { ok: false, error: "Only GitLab comments can be marked done." };
    const { gitlabItemsByKeys, setGitlabState } = await import("@/lib/gitlab/store");
    const item = gitlabItemsByKeys([String(key)]).get(String(key));
    if (item && (item.state === "resolved" || item.state === "unresolved")) {
      const { resolveGitlabThread } = await import("@/lib/gitlab/reply");
      const r = await resolveGitlabThread(item.url, !!resolved);
      if (r.resolvable) setGitlabState(String(key), resolved ? "resolved" : "unresolved");
    }
    const { setGitlabResolved } = await import("@/lib/resolved");
    setGitlabResolved(String(key), !!resolved);
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `GitLab: ${errorMessage(err)}` };
  }
}

/** A todo done, dismissed, or open again. */
export async function setTodoStatusAction(id: number, status: "open" | "done" | "dismissed"): Promise<ActionState> {
  try {
    if (!Number.isInteger(id) || !["open", "done", "dismissed"].includes(status)) return { ok: false, error: "Unbekanntes Todo." };
    const { setTodoStatus } = await import("@/lib/boards/store");
    const { attributed } = await import("@/lib/boards/activity");
    attributed("you", () => setTodoStatus(id, status, status === "open" ? null : undefined));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The context form's GitLab picker: synced items matching the words, most recently updated first. */
export async function searchGitlabItemsAction(q: string): Promise<import("@/lib/gitlab/shared").GitlabItemView[]> {
  const { listGitlabItems } = await import("@/lib/gitlab/store");
  const { gitlabLinkKey } = await import("@/lib/gitlab/shared");
  const text = String(q ?? "").slice(0, 1000);
  // A pasted link: what it points at, with its merge request's comments.
  if (gitlabLinkKey(text)) return listGitlabItems({ q: text, limit: 12 });
  // Words: the best of each kind, so none crowds out the others — comments, what people wrote,
  // first; for a merge request's number ("!167") the merge request.
  const comments = listGitlabItems({ q: text, kind: "comment", limit: 12 });
  const mrs = listGitlabItems({ q: text, kind: "mr", limit: 5 });
  const branches = listGitlabItems({ q: text, kind: "branch", limit: 3 });
  return /^!\d+$/.test(text.trim()) ? [...mrs, ...comments, ...branches] : [...comments, ...mrs, ...branches];
}

/** The context search's todos: done ones first (work that backs an entry), then open ones. */
export async function searchTodosAction(q: string): Promise<import("@/lib/boards/shared").TodoView[]> {
  const { searchTodos } = await import("@/lib/boards/store");
  return searchTodos(String(q ?? "").slice(0, 200));
}

/** Which of these links point at a synced GitLab item — that item, by link (null when none). */
export async function findGitlabItemsAction(urls: string[]): Promise<Record<string, import("@/lib/gitlab/shared").GitlabItemView | null>> {
  if (!Array.isArray(urls)) return {};
  const { gitlabLinkKey } = await import("@/lib/gitlab/shared");
  const { gitlabItemsByKeys } = await import("@/lib/gitlab/store");
  const list = urls.map(String).slice(0, 50);
  const found = gitlabItemsByKeys(list.map((u) => gitlabLinkKey(u) ?? ""));
  return Object.fromEntries(list.map((u) => [u, found.get(gitlabLinkKey(u) ?? "") ?? null]));
}

/**
 * The entry's context search: add a synced Teams message or GitLab item to the entry — as an
 * item of its own, the one there is for its link when there is one.
 */
export async function addContextSourceAction(entryId: number, url: string, ticket: string | null): Promise<ActionState> {
  try {
    const { resolveLinks } = await import("@/lib/context-links");
    const e = resolveLinks([String(url)])[String(url).trim()];
    if (!e) return { ok: false, error: "That isn't a synced Teams message or GitLab item." };
    const { addSource } = await import("@/lib/contexts");
    addSource(String(url), e, { entryId, ticket });
    revalidateAll();
    return { ok: true, message: "Added." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** "Add context": a new item (with its files), linked to the entry when there is one. */
export async function createContextAction(entryId: number | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { createContext } = await import("@/lib/contexts");
    await createContext(contextInputOf(fd), contextFilesOf(fd), entryId ?? undefined, contextPastedOf(fd));
    revalidateAll();
    return { ok: true, message: "Context added." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateContextAction(contextId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { updateContext } = await import("@/lib/contexts");
    await updateContext(contextId, contextInputOf(fd), contextFilesOf(fd), contextPastedOf(fd));
    revalidateAll();
    return { ok: true, message: "Context saved." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteContextAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  const { deleteContext } = await import("@/lib/contexts");
  deleteContext(id);
  revalidateAll();
}

export async function deleteContextFileAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  const { deleteContextFile } = await import("@/lib/contexts");
  deleteContextFile(id);
  revalidateAll();
}

/** "Link existing": put an item that's already there on this entry too. */
export async function linkContextAction(entryId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const contextId = int(fd, "contextId");
    if (contextId === undefined) return { ok: false, error: "Pick a context item to link." };
    const { linkContext } = await import("@/lib/contexts");
    linkContext(entryId, contextId);
    revalidateAll();
    return { ok: true, message: "Context linked." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function unlinkContextAction(fd: FormData): Promise<void> {
  const entryId = int(fd, "entryId");
  const contextId = int(fd, "contextId");
  if (entryId === undefined || contextId === undefined) return;
  const { unlinkContext } = await import("@/lib/contexts");
  unlinkContext(entryId, contextId);
  revalidateAll();
}

/** An entry's context dragged into a new order (item ids, first to last). */
export async function reorderEntryContextsAction(entryId: number, contextIds: number[]): Promise<ActionState> {
  try {
    if (!Number.isInteger(entryId) || !Array.isArray(contextIds) || !contextIds.every(Number.isInteger)) return { ok: false, error: "Nothing to reorder." };
    const { reorderEntryContexts } = await import("@/lib/contexts");
    reorderEntryContexts(entryId, contextIds);
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * "Sync to Jira": post the items to their Jira tickets (a comment each, edited when they
 * changed since) and attach their files. A write to Jira — only ever run from that button.
 */
export async function syncContextsToJiraAction(contextIds: number[]): Promise<ActionState> {
  try {
    const { syncContextsToJira } = await import("@/lib/jira/context-sync");
    const r = await syncContextsToJira(contextIds);
    revalidateAll();
    const parts = [
      r.posted.length && `${r.posted.length} posted`,
      r.updated.length && `${r.updated.length} updated`,
      r.unchanged.length && `${r.unchanged.length} already up to date`,
      r.files.length && `${r.files.length} file${r.files.length === 1 ? "" : "s"} attached`,
      r.skipped.length && `${r.skipped.length} without a ticket`,
    ].filter(Boolean);
    const summary = parts.length ? `${parts.join(", ")}.` : "Nothing to sync.";
    return r.errors.length ? { ok: false, error: `${summary} Failed: ${r.errors.join("; ")}` } : { ok: true, message: `Jira: ${summary}` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Work: todos handed to workers
// ---------------------------------------------------------------------------

/** Hand a todo to a worker (provider: the AI settings' unless given) — queued, started when one is free. */
/**
 * A work session (Work, like Claude Code): your instruction to a worker — on a todo (it goes on
 * where that one is), or as a new todo on a ticket (or none) — in a repo you pick, else the
 * ticket's. Interactive with the Copilot CLI (the Work settings): you talk to it on its page.
 */
export async function startSessionAction(v: { instruction: string; ticket?: string; todoId?: number; repoId?: number; provider?: string }): Promise<{ ok: true; runId: number } | { ok: false; error: string }> {
  try {
    const instruction = String(v.instruction ?? "").trim();
    // A todo without words: it's worked on as it is (its brief).
    if (!instruction && v.todoId) {
      const { dispatchTodo } = await import("@/lib/work/runner");
      const run = dispatchTodo(Number(v.todoId));
      revalidatePath("/work");
      return { ok: true, runId: run.id };
    }
    if (!instruction) return { ok: false, error: "Was soll der Worker tun?" };
    const { isAiProvider } = await import("@/lib/ai/shared");
    const { dispatchTodo } = await import("@/lib/work/runner");
    const { addSessionTodo, getTodo } = await import("@/lib/boards/store");
    // On its todo, while it's open; else a new todo (on the ticket, or none).
    const existing = v.todoId ? getTodo(Number(v.todoId)) : undefined;
    const ticket = String(v.ticket ?? existing?.ticket ?? "").trim();
    if (ticket && !/^[A-Z][A-Z0-9]+-\d+$/i.test(ticket)) return { ok: false, error: `„${ticket}“ ist kein Ticket.` };
    const todo = existing?.status === "open" ? existing : addSessionTodo({ ticket, text: instruction.split("\n")[0].slice(0, 200) });
    const run = dispatchTodo(todo.id, { instruction, provider: isAiProvider(v.provider) ? v.provider : undefined, repoId: v.repoId ? Number(v.repoId) : undefined });
    revalidatePath("/work");
    return { ok: true, runId: run.id };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function dispatchWorkAction(todoId: number, provider?: string): Promise<ActionState> {
  try {
    const { isAiProvider } = await import("@/lib/ai/shared");
    const { dispatchTodo } = await import("@/lib/work/runner");
    const run = dispatchTodo(Number(todoId), { provider: provider && isAiProvider(provider) ? provider : undefined });
    revalidateAll();
    return { ok: true, message: `${run.ref} ${run.status === "running" ? "is running" : "waits for a free worker"}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Your instruction on a todo, done by the Copilot CLI — a run on the Work tab. */
export async function instructTodoAction(todoId: number, instruction: string): Promise<ActionState> {
  try {
    const text = String(instruction ?? "").trim();
    if (!text) return { ok: false, error: "Was soll Copilot tun?" };
    const { dispatchTodo } = await import("@/lib/work/runner");
    const run = dispatchTodo(Number(todoId), { provider: "copilot", instruction: text.slice(0, 8000) });
    revalidateAll();
    return { ok: true, message: `${run.ref} (Copilot) ${run.status === "running" ? "läuft" : "wartet auf einen freien Worker"}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A failed run once more, as it was asked for: the same provider, your instruction again (an ✨ run). */
export async function retryRunAction(runId: number): Promise<ActionState> {
  try {
    const { getRun } = await import("@/lib/work/store");
    const { dispatchTodo } = await import("@/lib/work/runner");
    const { isAiProvider } = await import("@/lib/ai/shared");
    const r = getRun(Number(runId));
    if (!r) return { ok: false, error: "Den Lauf gibt es nicht mehr." };
    const instruction = r.mode === "instruct" ? /## Deine Anweisung \(vom Nutzer — sie geht vor\)\n([\s\S]*?)(?:\n\n## Dein Auftrag|$)/.exec(r.prompt ?? "")?.[1]?.trim() : undefined;
    if (r.mode === "instruct" && !instruction) return { ok: false, error: "Die Anweisung ist nicht mehr zu finden — gib sie über ✨ neu ein." };
    const run = dispatchTodo(r.todoId, { provider: isAiProvider(r.provider) ? r.provider : undefined, instruction });
    const { markRunErrorSeen } = await import("@/lib/work/store");
    markRunErrorSeen(r.id);
    revalidateAll();
    return { ok: true, message: `${run.ref} ${run.status === "running" ? "läuft" : "wartet auf einen freien Worker"}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A failed run's error, seen: no longer shown on its todo. */
export async function dismissRunErrorAction(runId: number): Promise<ActionState> {
  try {
    const { markRunErrorSeen } = await import("@/lib/work/store");
    markRunErrorSeen(Number(runId));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A todo flagged important (to the top of its list, urgent for the Ticket-Lage) — or the flag taken off. */
export async function flagTodoAction(todoId: number, flagged: boolean): Promise<ActionState> {
  try {
    const { setTodoFlagged } = await import("@/lib/boards/store");
    setTodoFlagged(Number(todoId), !!flagged);
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A reply to the message a todo is about, drafted by the AI from the conversation — never sent. */
export async function draftReplyAction(todoId: number): Promise<import("@/lib/boards/reply-draft").ReplyDraft> {
  try {
    return await (await import("@/lib/boards/reply-draft")).draftReply(Number(todoId));
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A reply's "Öffnen": WhatsApp Web, Gmail, Outlook or Teams at the front of the automation Chrome (signed in there). */
export async function openReplyTargetAction(url: string): Promise<ActionState> {
  try {
    const { REPLY_HOSTS } = await import("@/lib/boards/reply-draft");
    if (!REPLY_HOSTS.test(String(url))) return { ok: false, error: "Diese Adresse öffnet Zeff nicht." };
    const { openInAutomationChrome } = await import("@/lib/attention");
    const r = await openInAutomationChrome(String(url), new URL(String(url)).host);
    return r.ok ? { ok: true, message: "Im Automations-Chrome vorne — Entwurf einfügen und abschicken." } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The Auswerten page: one step's context settings (sources, numbers, its own instructions). */
export async function saveContextPrefsAction(step: string, patch: { sources?: Record<string, boolean>; numbers?: Record<string, number>; extra?: string }): Promise<ActionState> {
  try {
    const { CONTEXT_STEP_IDS } = await import("@/lib/boards/context-prefs-shared");
    if (!(CONTEXT_STEP_IDS as readonly string[]).includes(step)) return { ok: false, error: "Unbekannter Schritt." };
    const { setStepPrefs } = await import("@/lib/boards/context-prefs");
    setStepPrefs(step as (typeof CONTEXT_STEP_IDS)[number], patch ?? {});
    revalidatePath("/auswerten");
    return { ok: true, message: "Gespeichert — gilt ab dem nächsten Lauf." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A todo's deadline (YYYY-MM-DD) — or none. */
export async function setTodoDueAction(todoId: number, due: string | null): Promise<ActionState> {
  try {
    const { setTodoDue } = await import("@/lib/boards/store");
    setTodoDue(Number(todoId), due ? String(due) : null);
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A todo put to the bottom for now — it comes back up when something new happens on it — or taken back up. */
export async function deferTodoAction(todoId: number, deferred: boolean): Promise<ActionState> {
  try {
    const { setTodoDeferred } = await import("@/lib/boards/store");
    setTodoDeferred(Number(todoId), !!deferred);
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Your note on a todo (context for whoever works on it) — added, or taken away by its time. */
export async function addTodoNoteAction(todoId: number, text: string): Promise<ActionState> {
  try {
    if (!String(text ?? "").trim()) return { ok: false, error: "Die Notiz ist leer." };
    const { addTodoUserNote } = await import("@/lib/boards/store");
    addTodoUserNote(Number(todoId), String(text));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function removeTodoNoteAction(todoId: number, at: string): Promise<ActionState> {
  try {
    const { removeTodoUserNote } = await import("@/lib/boards/store");
    removeTodoUserNote(Number(todoId), String(at));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Stop a run, or take it out of the queue. */
export async function cancelWorkAction(runId: number): Promise<ActionState> {
  try {
    const { cancelRun } = await import("@/lib/work/runner");
    cancelRun(Number(runId));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A todo's drafted message, as you changed it (empty: none — a worker writes one again). */
export async function saveTodoDraftAction(todoId: number, draft: string): Promise<ActionState> {
  try {
    const { setTodoDraft } = await import("@/lib/boards/store");
    setTodoDraft(Number(todoId), { draft: String(draft ?? "") });
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * A booked entry's context from its todos — after the answer (the Jira read takes a while): the
 * conversations as they are now, then what the todos came from attached.
 */
async function attachContextLater(entryId: number, ticket: string | null, todoIds: number[]) {
  if (!todoIds.length) return;
  try {
    const { attachTodoContext, commentTickets } = await import("@/lib/work/booking");
    const { refreshTicketComments } = await import("@/lib/boards/collect");
    await refreshTicketComments(commentTickets(todoIds)).catch(() => 0);
    attachTodoContext(entryId, ticket, todoIds);
  } catch (e) {
    console.error("[booking context]", errorMessage(e));
  }
}

/** An agent's suggested booking, taken over with the hours and words you settled on (a real entry, its evidence as context). */
export async function acceptSuggestionAction(id: number, edits: { hours?: number; description?: string }): Promise<ActionState> {
  try {
    const { acceptSuggestion } = await import("@/lib/work/suggestions");
    // Booked at once; its context (the conversations as Jira has them now) comes right after.
    const r = acceptSuggestion(Number(id), { hours: edits?.hours === undefined ? undefined : Number(edits.hours), description: edits?.description === undefined ? undefined : String(edits.description) }, { context: false });
    after(() => attachContextLater(r.entryId, r.ticket, r.todoIds));
    revalidateAll();
    return { ok: true, message: `${formatHours(r.hours)} h gebucht${r.ticket ? ` auf ${r.ticket}` : ""}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An agent's suggested booking, not to be booked. */
export async function skipSuggestionAction(id: number): Promise<ActionState> {
  try {
    const { skipSuggestion } = await import("@/lib/work/suggestions");
    skipSuggestion(Number(id));
    revalidateAll();
    return { ok: true, message: "Vorschlag verworfen." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A ticket's todos done today, booked as one entry with the hours and words you settled on (Weekly report) — or skipped. */
export async function bookDoneTodayAction(v: { ticket: string; todoIds: number[]; hours: number; description: string; skip?: boolean }): Promise<ActionState> {
  try {
    const { bookDoneToday } = await import("@/lib/work/booking");
    // Booked at once; its context (the conversations as Jira has them now) comes right after.
    const r = bookDoneToday({ ticket: String(v.ticket), todoIds: Array.isArray(v.todoIds) ? v.todoIds : [], hours: Number(v.hours), description: String(v.description ?? ""), skip: !!v.skip, context: false });
    if (r.entryId) {
      const entryId = r.entryId;
      after(() => attachContextLater(entryId, String(v.ticket), r.todoIds));
    }
    revalidateAll();
    return { ok: true, message: v.skip ? `${v.ticket}: not suggested any more.` : `Booked ${formatHours(r.hours)} h on ${v.ticket}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The Work tab's settings: workers at once, permission mode, isolation, repos, model, budget, house rules. */
export async function saveWorkSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { PERMISSION_MODES } = await import("@/lib/work/shared");
    const { updateWorkSettings } = await import("@/lib/work/store");
    const parallel = num(fd, "parallel");
    if (parallel === undefined || parallel < 1 || parallel > 8) return { ok: false, error: "1 to 8 workers at once." };
    const permissionMode = str(fd, "permissionMode") ?? "auto";
    if (!(PERMISSION_MODES as readonly string[]).includes(permissionMode)) return { ok: false, error: "Unknown permission mode." };
    const isolation = str(fd, "isolation") === "checkout" ? "checkout" : "worktree";
    const { COPILOT_MODES } = await import("@/lib/work/shared");
    const copilotMode = (COPILOT_MODES as readonly string[]).includes(str(fd, "copilotMode") ?? "") ? (str(fd, "copilotMode") as (typeof COPILOT_MODES)[number]) : undefined;
    const model = (str(fd, "model") ?? "").trim();
    if (model && !/^[\w.:\[\]-]{2,60}$/.test(model)) return { ok: false, error: "A model name like sonnet, opus or claude-sonnet-5-5." };
    updateWorkSettings({
      parallel,
      permissionMode: permissionMode as (typeof PERMISSION_MODES)[number],
      isolation,
      ...(copilotMode ? { copilotMode } : {}),
      model,
      instructions: str(fd, "instructions") ?? "",
      agentInstructions: { code: str(fd, "agentInstructionCode") ?? "", other: str(fd, "agentInstructionOther") ?? "" },
    });
    const { pump } = await import("@/lib/work/runner");
    pump(); // more workers: the queue goes on at once
    revalidateAll();
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** One of a Boards run's suggested ticket changes (transition, assignee, comment), done in Jira — on your click. */
export async function runTicketActionAction(runId: number, ticket: string, idx: number): Promise<ActionState> {
  try {
    const { runTicketAction } = await import("@/lib/boards/actions");
    const r = await runTicketAction(Number(runId), String(ticket), Number(idx));
    revalidateAll();
    return { ok: true, message: `${ticket}: ${r.detail}.` };
  } catch (err) {
    revalidateAll();
    return { ok: false, error: errorMessage(err) };
  }
}

/** A repo for workers (Repos page): new, or the one with `id` changed. */
export async function saveRepoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { saveRepo } = await import("@/lib/repos");
    const id = num(fd, "id");
    const r = saveRepo(
      {
        name: str(fd, "name") ?? "",
        path: str(fd, "path") ?? "",
        gitlabProject: str(fd, "gitlabProject") ?? null,
        boards: fd.getAll("boards").map((b) => Number(b)),
        tickets: (str(fd, "tickets") ?? "").split(/[\s,;]+/),
        instructions: str(fd, "instructions") ?? "",
        delivery: str(fd, "delivery") === "direct" ? "direct" : "mr",
      },
      id || undefined,
    );
    revalidateAll();
    return { ok: true, message: `${id ? "Saved" : "Added"} ${r.name}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteRepoAction(id: number): Promise<ActionState> {
  try {
    const { deleteRepo } = await import("@/lib/repos");
    deleteRepo(Number(id));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Switch a repo's checkout to another local branch (Work tab). */
export async function switchRepoBranchAction(repoId: number, branch: string): Promise<ActionState> {
  try {
    const { switchBranch } = await import("@/lib/repos");
    const now = switchBranch(Number(repoId), String(branch));
    (await import("@/lib/branches")).forgetBranchWork();
    revalidateAll();
    return { ok: true, message: `Now on ${now}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}


/** What a local branch needs, done on your click (push, open or merge its MR, delete) — or (not) listing it any more. */
export async function branchOpAction(repoId: number, branch: string, op: string): Promise<ActionState> {
  try {
    const ops = ["push", "open-mr", "merge", "delete", "ignore", "unignore", "ignore-stale"] as const;
    if (!(ops as readonly string[]).includes(op)) return { ok: false, error: "Unknown operation." };
    const { branchOp } = await import("@/lib/branches");
    const message = await branchOp(Number(repoId), String(branch), op as (typeof ops)[number]);
    revalidateAll();
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A todo done another way (one of its alternatives — "Rico zuweisen", "Merge into main"): its operations replaced, then run. */
export async function runTodoAlternativeAction(todoId: number, label: string): Promise<ActionState> {
  try {
    const { getTodo, setTodoOps } = await import("@/lib/boards/store");
    const { todoAlternatives } = await import("@/lib/boards/alternatives");
    const t = getTodo(Number(todoId));
    if (!t || t.status !== "open") return { ok: false, error: "That todo isn't open." };
    const alt = (todoAlternatives([t])[t.id] ?? []).find((a) => a.label === String(label));
    if (!alt) return { ok: false, error: "That option isn't there any more." };
    const { dispatchTodo } = await import("@/lib/work/runner");
    if (alt.also) {
      // On its own: a todo of its own (traceable, under this one), run at once — this one stays as it is.
      const { addFollowUp } = await import("@/lib/boards/store");
      const { attributed } = await import("@/lib/boards/activity");
      const child = attributed("you", () => addFollowUp({ ticket: t.ticket, text: alt.title, kind: "update", parentId: t.id, workRunId: null, source: `Option zu ${t.ref}`, ops: alt.ops }));
      const run = dispatchTodo(child.id);
      revalidateAll();
      return { ok: true, message: `${run.ref}: ${alt.title}.` };
    }
    setTodoOps(t.id, alt.ops, alt.text);
    const run = dispatchTodo(t.id);
    revalidateAll();
    return { ok: true, message: `${run.ref}: ${alt.label}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The Recap: a day's recap made (in the background) — the page follows it. */
export async function startRecapAction(day: string): Promise<ActionState> {
  try {
    const { startRecap } = await import("@/lib/boards/recap");
    const r = startRecap(String(day));
    revalidateAll();
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An operation's text (a comment, a reply, a Teams message) changed before it's sent. */
export async function saveTodoOpTextAction(todoId: number, index: number, text: string): Promise<ActionState> {
  try {
    const { getTodo, setTodoOps } = await import("@/lib/boards/store");
    const t = getTodo(Number(todoId));
    if (!t || t.status !== "open") return { ok: false, error: "That todo isn't open." };
    const op = t.ops[Number(index)];
    const body = String(text ?? "").trim();
    if (!op || !("body" in op)) return { ok: false, error: "That operation has no text." };
    if (!body) return { ok: false, error: "Empty text." };
    setTodoOps(t.id, t.ops.map((o, i) => (i === Number(index) ? { ...o, body: body.slice(0, 8000) } : o)) as typeof t.ops);
    revalidateAll();
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A ticket followed in the Ticket-Lage besides the boards' filter (1), not any more (-1), or as it comes (0). */
export async function setTicketFollowAction(key: string, value: 1 | -1 | 0): Promise<ActionState> {
  try {
    const { setFollowed } = await import("@/lib/boards/followed");
    setFollowed(String(key), value === 1 || value === -1 ? value : 0);
    revalidateAll();
    return { ok: true, message: value === 1 ? `${key}: wird weiter verfolgt (ab dem nächsten Lauf).` : value === -1 ? `${key}: nicht mehr verfolgt.` : `${key}: wie es kommt.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Backups (Settings): when and where, the password, a backup now, a restore
// ---------------------------------------------------------------------------

/** The backup settings — the password only when one is typed (or removed on purpose). */
export async function saveBackupSettingsAction(v: { enabled: boolean; everyHours: number; keepDaily: number; keepWeekly: number; keepMonthly: number; config?: boolean; dir: string; password?: string; clearPassword?: boolean }): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("backup")) return { ok: false, error: "Backups sind nicht installiert (Menü → Plugins)." };
    const { saveBackupSettings } = await import("@/plugins/backup/backup");
    const s = saveBackupSettings({ enabled: !!v.enabled, everyHours: Number(v.everyHours), keepDaily: Number(v.keepDaily), keepWeekly: Number(v.keepWeekly), keepMonthly: Number(v.keepMonthly), config: !!v.config, dir: String(v.dir ?? ""), password: v.password ? String(v.password) : undefined, clearPassword: !!v.clearPassword });
    revalidatePath("/preferences");
    return { ok: true, message: `Backup-Einstellungen gespeichert — Ziel: ${s.resolvedDir}${s.moved ? ` (${s.moved} Backup${s.moved === 1 ? "" : "s"} dorthin verschoben)` : ""}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A backup now. */
export async function runBackupAction(): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("backup")) return { ok: false, error: "Backups sind nicht installiert (Menü → Plugins)." };
    const { runBackup } = await import("@/plugins/backup/backup");
    const r = await runBackup();
    revalidatePath("/preferences");
    return r.ok ? { ok: true, message: `Gesichert: ${r.message}` } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Restore a backup (by its name in the list; the password when it isn't the settings' one):
 * checked, the current state backed up first, then put in place as Zeff restarts.
 */
export async function restoreBackupAction(name: string, password?: string): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("backup")) return { ok: false, error: "Backups sind nicht installiert (Menü → Plugins)." };
    const { stageRestore } = await import("@/plugins/backup/backup");
    const r = await stageRestore(String(name), password ? String(password) : undefined);
    // The server restarts (its launcher starts it again) and puts the backup in place before it opens the database.
    setTimeout(() => process.exit(0), 800);
    return { ok: true, message: `${r.files} Dateien bereit — Zeff startet neu und stellt ${name} wieder her. Der Stand davor ist gesichert: ${r.safety}` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A backup file from elsewhere (another machine, a copy), put in the backup folder to restore from. */
export async function uploadBackupAction(fd: FormData): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("backup")) return { ok: false, error: "Backups sind nicht installiert (Menü → Plugins)." };
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return { ok: false, error: "Keine Datei gewählt." };
    const { storeUploadedBackup } = await import("@/plugins/backup/backup");
    const name = storeUploadedBackup(file.name, Buffer.from(await file.arrayBuffer()));
    revalidatePath("/preferences");
    return { ok: true, message: name };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Settings and configuration taken over into the account you're in — from the config ZIP beside a
 * backup (`backup`: its name) or an uploaded one (`file`); `password` when not the settings' one.
 */
export async function importConfigAction(fd: FormData): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("backup")) return { ok: false, error: "Backups sind nicht installiert (Menü → Plugins)." };
    const { importConfigZip } = await import("@/plugins/backup/backup");
    const backup = fd.get("backup");
    const file = fd.get("file");
    const password = String(fd.get("password") ?? "") || undefined;
    const from = typeof backup === "string" && backup ? { backup } : file instanceof File && file.size ? { data: Buffer.from(await file.arrayBuffer()) } : null;
    if (!from) return { ok: false, error: "Keine Konfiguration gewählt." };
    const r = importConfigZip(from, password);
    (await import("@/plugins/knowledge/instances")).writeKnowledgeInstances(); // the plugins may have changed
    revalidateAll();
    return { ok: true, message: `Konfiguration von „${r.account}“ übernommen — ${r.rows} Einträge in ${r.tables} Tabellen.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

async function knowledgeOn(): Promise<string | null> {
  return (await import("@/plugins/state")).isInstalled("knowledge") ? null : "Knowledge ist nicht installiert (Menü → Plugins).";
}

/** A question to the knowledge server, with the conversation so far — its answer and sources. */
export async function askKnowledgeAction(question: string, history: { role: "user" | "assistant"; text: string }[]): Promise<{ ok: true; answer: import("@/plugins/knowledge/shared").KnowledgeAnswer } | { ok: false; error: string }> {
  try {
    const off = await knowledgeOn();
    if (off) return { ok: false, error: off };
    const q = String(question ?? "").trim();
    if (!q) return { ok: false, error: "Keine Frage." };
    const turns = (Array.isArray(history) ? history : []).slice(-8).map((t) => ({ role: t.role === "assistant" ? ("assistant" as const) : ("user" as const), text: String(t.text ?? "").slice(0, 4000) }));
    const { knowledgeAsk } = await import("@/plugins/knowledge/client");
    return { ok: true, answer: await knowledgeAsk(q, turns) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The knowledge relevant to a todo (its words, its ticket and the ticket's summary) — pages and entities. */
export async function todoKnowledgeAction(todoId: number): Promise<{ ok: true; pages: import("@/plugins/knowledge/shared").KnowledgePage[]; entities: import("@/plugins/knowledge/shared").KnowledgeEntity[] } | { ok: false; error: string }> {
  try {
    const off = await knowledgeOn();
    if (off) return { ok: false, error: off };
    const { getTodo } = await import("@/lib/boards/store");
    const { getJiraTicket } = await import("@/lib/jira/store");
    const t = getTodo(Number(todoId));
    if (!t) return { ok: false, error: "Das Todo gibt es nicht." };
    const summary = t.ticket ? (getJiraTicket(t.ticket)?.summary ?? "") : "";
    const { knowledgeRelated } = await import("@/plugins/knowledge/client");
    const r = await knowledgeRelated([t.text, summary].filter(Boolean).join(" — "), t.ticket || null, 5);
    return { ok: true, pages: r.pages, entities: r.entities };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The knowledge server: read Confluence now, and compile what's new. */
export async function knowledgeSyncAction(): Promise<ActionState> {
  try {
    const off = await knowledgeOn();
    if (off) return { ok: false, error: off };
    await (await import("@/plugins/knowledge/client")).knowledgeSync();
    return { ok: true, message: "Der Wissens-Server liest Confluence und kompiliert, was neu ist — das dauert." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

async function accountsOn(): Promise<string | null> {
  return (await import("@/plugins/state")).isInstalled("accounts") ? null : "Konten sind nicht installiert (Menü → Plugins).";
}

/** Into another account (Accounts plugin) — where to go there (its first tab: its plugins differ). */
export async function switchAccountAction(id: string): Promise<ActionState & { href?: string }> {
  try {
    const off = await accountsOn();
    if (off) return { ok: false, error: off };
    const a = (await import("@/lib/accounts")).switchAccount(String(id));
    revalidateAll();
    const { appTabs } = await import("@/plugins/tabs");
    return { ok: true, message: `Jetzt in „${a.name}“.`, href: appTabs()[0]?.href ?? "/plugins" };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A new account — empty, or with another's settings and configuration. */
export async function createAccountAction(v: { name: string; color: string; copyFrom?: string }): Promise<ActionState> {
  try {
    const off = await accountsOn();
    if (off) return { ok: false, error: off };
    const { account, copied } = await (await import("@/lib/accounts")).createAccount({ name: String(v.name ?? ""), color: String(v.color ?? ""), copyFrom: v.copyFrom ? String(v.copyFrom) : undefined });
    revalidatePath("/accounts");
    return { ok: true, message: `Konto „${account.name}“ angelegt${copied ? ` — ${copied} Einstellungen übernommen` : ""}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateAccountAction(id: string, v: { name?: string; color?: string }): Promise<ActionState> {
  try {
    const off = await accountsOn();
    if (off) return { ok: false, error: off };
    const { updateAccount } = await import("@/db/accounts");
    const a = updateAccount(String(id), { name: v.name === undefined ? undefined : String(v.name), color: v.color === undefined ? undefined : String(v.color) });
    revalidateAll();
    return { ok: true, message: `„${a.name}“ gespeichert.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An account off the list — its folder set aside (data/accounts/.deleted), not deleted. */
export async function deleteAccountAction(id: string): Promise<ActionState> {
  try {
    const off = await accountsOn();
    if (off) return { ok: false, error: off };
    const to = (await import("@/lib/accounts")).deleteAccount(String(id));
    revalidatePath("/accounts");
    return { ok: true, message: `Konto entfernt — seine Daten liegen in ${to}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Windows' folder dialog, opened on this machine (Zeff runs here) — the folder picked, or null
 * when cancelled. In front of the other windows; the server isn't held up while it's open.
 */
export async function pickFolderAction(initial?: string): Promise<{ ok: boolean; path?: string | null; error?: string }> {
  if (process.platform !== "win32") return { ok: false, error: "Der Ordner-Dialog gibt es nur unter Windows — den Pfad bitte eintippen." };
  const { execFile } = await import("node:child_process");
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = 'Minimized' }",
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$d.Description = 'Ordner für Zeffs Backups'",
    "$d.ShowNewFolderButton = $true",
    "if ($env:ZEFF_PICK_INITIAL -and (Test-Path -LiteralPath $env:ZEFF_PICK_INITIAL)) { $d.SelectedPath = $env:ZEFF_PICK_INITIAL }",
    "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
  ].join("; ");
  return new Promise((resolve) =>
    execFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-NonInteractive", "-Command", script],
      { encoding: "utf8", timeout: 5 * 60000, windowsHide: true, env: { ...process.env, ZEFF_PICK_INITIAL: initial ?? "" } },
      (err, out) => (err ? resolve({ ok: false, error: `Der Dialog ging nicht auf: ${errorMessage(err)}` }) : resolve({ ok: true, path: String(out).trim() || null })),
    ),
  );
}

// ---------------------------------------------------------------------------
// Plugins (connectors and AI tools): installed or not
// ---------------------------------------------------------------------------

/** Install or uninstall a plugin — its data stays; what it does (menu, pages, syncs) comes or goes. */
export async function setPluginInstalledAction(id: string, installed: boolean): Promise<ActionState> {
  try {
    const { isPluginId, pluginById } = await import("@/plugins/catalog");
    if (!isPluginId(id)) return { ok: false, error: "Unbekanntes Plugin." };
    const { dependents, setInstalled } = await import("@/plugins/state");
    // Uninstalled: what builds on it goes too (it stays set, and is back once this is).
    const along = installed ? [] : dependents(id);
    const ids = setInstalled(id, !!installed);
    // Knowledge in or out: the launcher starts or stops this account's knowledge server.
    (await import("@/plugins/knowledge/instances")).writeKnowledgeInstances();
    revalidateAll();
    const names = (list: string[]) => list.map((x) => (isPluginId(x) ? pluginById(x).name : x)).join(", ");
    return {
      ok: true,
      message:
        `${pluginById(id).name} ${installed ? "installiert" : "deinstalliert"}.` +
        (ids.length > 1 ? ` Mit installiert: ${names(ids.slice(1))}.` : "") +
        (along.length ? ` Ohne es nicht da: ${names(along)}.` : ""),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * An action you did in your browser (the appointment saved in Outlook, the mail draft sent):
 * taken off the todo and noted on it — so the Lage and everyone know. A mail that is the todo
 * (a reply, a question) ticks it off.
 */
export async function doneBrowserOpAction(todoId: number, index: number): Promise<ActionState> {
  try {
    const { getTodo, addTodoUserNote, setTodoStatus } = await import("@/lib/boards/store");
    const { actionHref } = await import("@/plugins/actions/catalog");
    const { getDb, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const t = getTodo(Number(todoId));
    const op = t?.ops[Number(index)];
    if (!t || !op || !actionHref(op)) return { ok: false, error: "Diese Aktion gibt es am Todo nicht (mehr)." };
    const left = t.ops.filter((_, i) => i !== Number(index));
    getDb().update(schema.todos).set({ ops: JSON.stringify(left) }).where(eq(schema.todos.id, t.id)).run();
    const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
    const what =
      op.type === "calendar-event"
        ? `Termin „${op.subject}“ in Outlook angelegt (${when(op.start)}, ${op.minutes} min${op.attendees ? `, mit ${op.attendees.replace(/;/g, ", ")}` : ""}).`
        : op.type === "mail-compose"
          ? `Mail „${op.subject}“${op.to ? ` an ${op.to.replace(/;/g, ", ")}` : ""} gesendet.`
          : "Im Browser erledigt.";
    addTodoUserNote(t.id, `✓ ${what}`);
    // A mail that answers or asks — the todo itself, done with it.
    const settles = op.type === "mail-compose" && !left.length && t.owner === "me" && ["reply", "comment", "clarify", "update"].includes(t.kind);
    if (settles) {
      const { attributed } = await import("@/lib/boards/activity");
      attributed("you", () => setTodoStatus(t.id, "done", `Erledigt: ${what}`));
    }
    revalidateAll();
    return { ok: true, message: settles ? `${t.ref} erledigt — ${what}` : `Vermerkt an ${t.ref}: ${what}` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The LLM plugin's settings: your instructions and context, each task's backend and model. */
export async function saveLlmSettingsAction(v: { instructions: string; context: string; tasks: Record<string, { provider?: string; model?: string }> }): Promise<ActionState> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("llm")) return { ok: false, error: "Das LLM-Plugin ist nicht installiert (Menü → Plugins)." };
    const { saveLlmSettings } = await import("@/plugins/llm/settings");
    saveLlmSettings({
      instructions: String(v?.instructions ?? ""),
      context: String(v?.context ?? ""),
      tasks: Object.fromEntries(Object.entries(v?.tasks ?? {}).map(([k, t]) => [k, { provider: t?.provider === "copilot" || t?.provider === "claude" ? t.provider : "", model: String(t?.model ?? "") }])),
    });
    revalidatePath("/llm");
    return { ok: true, message: "LLM-Einstellungen gespeichert — sie gelten ab der nächsten Aufgabe." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Ready actions for one todo, now (the auto-actions review, asked for on it). */
export async function suggestTodoActionsAction(todoId: number): Promise<ActionState> {
  try {
    const { isInstalled } = await import("@/plugins/state");
    if (!isInstalled("auto-actions")) return { ok: false, error: "Auto-Aktionen sind nicht installiert (Menü → Plugins)." };
    const { reviewTodosForActions } = await import("@/plugins/auto-actions/review");
    const r = await reviewTodosForActions({ ids: [Number(todoId)] });
    revalidateAll();
    if (!r.ok) return { ok: false, error: r.error ?? "Die KI hat nicht geantwortet." };
    if (!r.reviewed) return { ok: false, error: "Das Todo hat schon Aktionen (aus der Ticket-Lage) — die bleiben." };
    return { ok: true, message: r.withActions ? "Aktionen vorgeschlagen — am Todo." : "Keine passende Aktion gefunden." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An action taken off a todo, without a trace (not wanted) — the auto-actions don't propose it again till the todo changes. */
export async function removeTodoOpAction(todoId: number, index: number): Promise<ActionState> {
  try {
    const { getTodo } = await import("@/lib/boards/store");
    const { getDb, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const t = getTodo(Number(todoId));
    const op = t?.ops[Number(index)];
    if (!t || !op) return { ok: false, error: "Diese Aktion gibt es am Todo nicht (mehr)." };
    const left = t.ops.filter((_, i) => i !== Number(index));
    getDb()
      .update(schema.todos)
      .set({ ops: JSON.stringify(left), actionsReviewedAt: new Date().toISOString(), ...(left.length ? {} : { autoOpsWhy: null }) })
      .where(eq(schema.todos.id, t.id))
      .run();
    revalidateAll();
    return { ok: true, message: "Aktion entfernt." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
