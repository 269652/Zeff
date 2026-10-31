"use server";

import { errorMessage } from "@/lib/errors";
import { formatHours } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { int, num, revalidateAll, str, type ActionState } from "@/app/action-helpers";

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
    return { ok: true, message: t("Working hours saved.") };
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
    return { ok: true, message: s.defaultPauses ? t("Default break saved: {pauses}.", { pauses: s.defaultPauses }) : t("Default break removed.") };
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
    if (jobNumber && !job) return { ok: false, error: t("There's no job {job}.", { job: jobNumber }) };
    const { getFlexTime, updateFlexTime } = await import("@/lib/schedule");
    const flex = getFlexTime(updateFlexTime({ jobNumber: job?.number ?? null, comment: str(fd, "flexComment") ?? "" }));
    revalidateAll();
    return { ok: true, message: job ? t("Flex time goes to {job} as “{comment}”.", { job: job.number, comment: flex.comment }) : t("Flex time is off.") };
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
      return { ok: false, error: why ? t("Nothing to book — {why}.", { why }) : t("Nothing to book.") };
    }
    revalidateAll();
    const hours = r.booked.reduce((a, b) => a + b.hours, 0);
    return {
      ok: true,
      message: t("Booked {hours} h “{comment}” on {job}: {days}.", {
        hours: formatHours(hours),
        comment: r.comment,
        job: r.jobNumber,
        days: r.booked.map((b) => `${b.label} ${t("{hours} h", { hours: formatHours(b.hours) })}`).join(", "),
      }),
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
    const until = str(fd, "repeatUntil");
    const label = { vacation: t("vacation"), sick: t("sick"), holiday: t("holiday"), other: t("other") }[type] ?? type;
    if (until) {
      // Every week until then (Fridays off): one absence per week.
      const all = (await import("@/lib/schedule")).createWeeklyAbsences({ startDate: start, endDate: end, type, hours: hours ?? null, note: str(fd, "note") ?? null, until });
      revalidateAll();
      return { ok: true, message: t("Added {type} every week: {n} times, up to {until}.", { type: label, n: all.length, until: all[all.length - 1]?.startDate ?? until }) };
    }
    const a = createAbsence({ startDate: start, endDate: end, type, hours: hours ?? null, note: str(fd, "note") ?? null });
    revalidateAll();
    const dates = `${a.startDate}${a.endDate !== a.startDate ? `–${a.endDate}` : ""}`;
    return { ok: true, message: t("Added {type} {dates}.", { type: label, dates }) };
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
