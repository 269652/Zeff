"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { deleteConnection } from "@/lib/calendar/microsoft";
import { createEntry } from "@/lib/entries";
import { errorMessage } from "@/lib/errors";
import { int, num, revalidateAll, str, type ActionState } from "@/app/action-helpers";

/** Calendar import — its server actions (each answers an ActionState unless it says otherwise). */

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
