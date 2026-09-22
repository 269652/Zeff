"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteConnection } from "@/lib/calendar/microsoft";
import { createEntry, deleteEntry, getJobNumberForTicket, updateEntry } from "@/lib/entries";
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
  return t === "ticket" || t === "meeting" || t === "other" ? t : undefined;
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
  try {
    const gb = str(fd, "groupBy");
    updateReportSettings({
      groupBy: gb === "type" || gb === "tag" || gb === "ticket" ? gb : undefined,
      groupMeetingsByDay: fd.get("groupMeetingsByDay") === "on",
      meetingsLabel: str(fd, "meetingsLabel"),
      groupTicketsByDay: fd.get("groupTicketsByDay") === "on",
      ticketTemplate: str(fd, "ticketTemplate"),
    });
    revalidateAll();
    return { ok: true, message: "Report settings saved." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
