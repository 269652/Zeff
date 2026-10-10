"use server";

import { errorMessage } from "@/lib/errors";
import { num, revalidateAll, str, type ActionState } from "@/app/action-helpers";
import { callTimo } from "@/plugins/timo/call";

/** TimO: its server actions (each answers an ActionState unless it says otherwise). */

/** Read what TimO has on these days (read-only) and keep it for the weekly TimO marks. */
async function pullTimoDays(isoDays: string[]): Promise<void> {
  const { pullTimoIsoDays } = await import("@/lib/sync/pulls");
  await pullTimoIsoDays(isoDays);
}

/**
 * "Pull TimO" on the weekly table: read what TimO has on the week's days — read-only, nothing
 * changes in TimO — for the Booked row's marks (blue ✓ where TimO has Zeff's hours).
 */
export async function pullTimoAction(weekKey: string): Promise<ActionState> {
  try {
    const { isoDate, resolveWeek } = await import("@/lib/week");
    const week = resolveWeek(weekKey);
    if (!week) return { ok: false, error: "Could not read the week." };
    await pullTimoDays(week.days.map(isoDate));
    revalidateAll();
    const { timoDayStates } = await import("@/lib/timo-status");
    const { states } = timoDayStates(week);
    const synced = states.filter((s) => s?.state === "synced").length;
    const differs = states.filter((s) => s?.state === "differs").length;
    if (!synced && !differs) return { ok: true, message: "TimO has nothing in this week yet." };
    return { ok: true, message: `TimO: ${synced} day${synced === 1 ? "" : "s"} as in Zeff${differs ? `, ${differs} different` : ""}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function timoStatusAction(): Promise<ActionState> {
  try {
    return { ok: true, message: await callTimo("timo_status", {}) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function saveTimoConfigAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings } = await import("@/lib/report");
  try {
    const startTime = (str(fd, "startTime") ?? "").trim();
    updateReportSettings({
      timoConfig: {
        startTime: /^\d{1,2}:\d{2}$/.test(startTime) ? startTime : "08:00",
        workdayHours: num(fd, "workdayHours") ?? 8,
        breakMinutes: num(fd, "breakMinutes") ?? 30,
        absenceJobNumber: (str(fd, "absenceJobNumber") ?? "").trim(),
        absenceType: (str(fd, "absenceType") ?? "").trim() || "Urlaub",
      },
    });
    revalidateAll();
    return { ok: true, message: "TimO work day saved." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function exportToTimoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { resolveWeek } = await import("@/lib/week");
  const week = resolveWeek(str(fd, "week"));
  if (!week) return { ok: false, error: "Could not read the week." };
  const dryRun = fd.get("dryRun") === "on";
  const fillGaps = fd.get("fillGaps") === "on";
  const { getTimoExportPlan, toTimoPayload } = await import("@/lib/timo");
  const { getReportSettings, getTimoConfig } = await import("@/lib/report");
  const plan = getTimoExportPlan(week, getTimoConfig(getReportSettings()), { reportedBy: str(fd, "by"), fillGaps });
  if (plan.days.length === 0) return { ok: false, error: "Nothing to record (no bookings; turn on gap-fill for default days)." };
  try {
    const msg = await callTimo("timo_export", { ...toTimoPayload(plan), dryRun });
    if (!dryRun) {
      // What TimO has now, for the weekly TimO marks (read-only; the export's own result stands either way).
      const { isoDate } = await import("@/lib/week");
      await pullTimoDays(week.days.map(isoDate)).catch(() => {});
      revalidateAll();
    }
    return { ok: true, message: msg };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
