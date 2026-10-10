import { isInstalled } from "@/plugins/state";
import { formatAgo, formatHours } from "./format";
import { isoDate, type WeekInfo } from "./week";

/**
 * Wochenabschluss: is the week done? Each step of closing it — every day booked, the meetings and
 * the agents' suggestions taken over, every entry on a job, everything in Chrono and Punch, approved in
 * Chrono — as it stands, with where to do what's left. Nothing new is worked out here: the weekly
 * report, the calendar, Chrono's and Punch's last pull say it; this puts it in one list. Chrono and Punch
 * are as fresh as their last pull (a week never pulled: "unknown", not done).
 */

/** ok: done · open: something left · unknown: not known (not pulled yet) · later: not due yet (the week isn't over). */
export type CloseState = "ok" | "open" | "unknown" | "later";
export type CloseItem = { key: string; label: string; state: CloseState; detail: string; href: string };
export type WeekClose = { items: CloseItem[]; /** Every step done. */ done: boolean; /** The week is over (its last working day passed, or it's that day). */ over: boolean };

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ago = (iso: string, now: Date) => formatAgo(iso, now.getTime());

export async function weekClose(week: WeekInfo, now = new Date()): Promise<WeekClose> {
  const { getWeeklyReport, listEntries, listBookedOnDates } = await import("./entries");
  const { getWeekTargets } = await import("./schedule");
  const { dayShortfalls } = await import("./day-status");
  const { NO_JOB_NUMBER } = await import("./projects-shared");
  const today = isoDate(now);
  const q = `week=${encodeURIComponent(week.key)}`;
  const items: CloseItem[] = [];
  const report = getWeeklyReport(week);
  const targets = getWeekTargets(week);
  const lastWorkday = [...week.days].reverse().find((_, i) => (targets.targets[6 - i] ?? 0) > 0);
  const over = today > week.endIso || (!!lastWorkday && today >= isoDate(lastWorkday));

  // 1. Every day booked up to its target (today counts once it's the week's last working day).
  const shortfall = dayShortfalls(week, report.dayTotals, targets.targets, { today: over ? isoDate(new Date(Date.parse(week.endIso) + 864e5)) : today });
  const missing = shortfall.map((s, i) => ({ ...s, day: DAY_NAMES[i] })).filter((s) => s.state === "missing" || (over && s.state === "short"));
  const future = !over && week.days.some((d, i) => isoDate(d) >= today && (targets.targets[i] ?? 0) > 0);
  items.push({
    key: "hours",
    label: "Every day booked",
    state: missing.length ? "open" : future ? "later" : "ok",
    detail: missing.length ? `missing: ${missing.map((m) => `${m.day} ${formatHours(m.gap)} h`).join(", ")}` : `${formatHours(report.total)} of ${formatHours(targets.weekTarget)} h`,
    href: `/?${q}`,
  });

  // 2. The week's finished meetings taken over.
  if (isInstalled("outlook-calendar")) {
    const { getCalendarWeek } = await import("./calendar/week-view");
    const { getMeetingDefaultJob, getMeetingExcludeRules, getMeetingJobRules, getReportSettings } = await import("./report");
    const settings = getReportSettings();
    const days = getCalendarWeek(week, {
      now,
      booked: listBookedOnDates(week.days.map(isoDate)),
      excludeRules: getMeetingExcludeRules(settings),
      jobRules: getMeetingJobRules(settings),
      defaultJob: getMeetingDefaultJob(settings) ?? "",
    });
    const open = days.flatMap((d) => d.events).filter((e) => e.state === "importable" && `${e.date}T${e.endTime}` <= `${today}T${now.toTimeString().slice(0, 5)}`);
    items.push({
      key: "meetings",
      label: "Meetings booked",
      state: open.length ? "open" : "ok",
      detail: open.length ? `${open.length} not booked yet: ${open.slice(0, 3).map((e) => e.subject).join(", ")}${open.length > 3 ? " …" : ""}` : "all booked",
      href: `/calendar?${q}`,
    });
  }

  // 3. The agents' suggestions for the week taken over or skipped.
  const { openSuggestionTotals } = await import("./work/suggestions");
  const suggestions = openSuggestionTotals(week.startIso, week.endIso);
  items.push({
    key: "suggestions",
    label: "Suggestions taken over",
    state: suggestions.count ? "open" : "ok",
    detail: suggestions.count ? `${suggestions.count} open (${formatHours(suggestions.hours)} h)` : "none open",
    href: `/?${q}`,
  });

  // 4. Every entry on a job (the "No job yet" placeholder isn't exported).
  const entries = listEntries({ from: week.startIso, to: week.endIso });
  const noJob = entries.filter((e) => e.job.number === NO_JOB_NUMBER);
  items.push({
    key: "jobs",
    label: "Every entry on a job",
    state: noJob.length ? "open" : "ok",
    detail: noJob.length ? `${noJob.length} without a job (${formatHours(noJob.reduce((a, e) => a + e.hours, 0))} h)` : "all",
    href: `/?${q}`,
  });

  // 5. + 7. Chrono: everything in it, and approved — as of the last pull.
  if (isInstalled("chrono")) {
    const { chronoPulledAt, chronoStatusByEntry } = await import("./chrono-status");
    const pulledAt = chronoPulledAt(week);
    const booked = entries.filter((e) => e.job.number !== NO_JOB_NUMBER);
    if (!pulledAt) {
      items.push({ key: "chrono", label: "In Chrono", state: "unknown", detail: "not pulled from Chrono yet", href: `/export/chrono?${q}` });
      items.push({ key: "approved", label: "Approved in Chrono", state: "unknown", detail: "not pulled from Chrono yet", href: `/export/chrono?${q}` });
    } else {
      const statuses = chronoStatusByEntry(week);
      const kinds = booked.map((e) => statuses[e.id]?.kind ?? "missing");
      const count = (k: string) => kinds.filter((x) => x === k).length;
      const stand = `pulled ${ago(pulledAt, now)}`;
      const notIn = count("missing");
      const rejected = count("rejected");
      items.push({
        key: "chrono",
        label: "In Chrono",
        state: !booked.length ? (over ? "ok" : "later") : notIn || rejected ? "open" : "ok",
        detail: [notIn ? `${notIn} not in Chrono` : "", rejected ? `${rejected} rejected` : "", !notIn && !rejected ? "all in" : "", stand].filter(Boolean).join(" · "),
        href: `/export/chrono?${q}`,
      });
      const draft = count("draft");
      const submitted = count("submitted");
      items.push({
        key: "approved",
        label: "Approved in Chrono",
        state: !booked.length ? (over ? "ok" : "later") : notIn || rejected || draft || submitted ? "open" : "ok",
        detail: [draft ? `${draft} not submitted` : "", submitted ? `${submitted} waiting for approval` : "", !draft && !submitted && !notIn && !rejected ? "all approved" : "", stand].filter(Boolean).join(" · "),
        href: `/export/chrono?${q}`,
      });
    }
  }

  // 6. Punch: the days as Zeff would record them — as of the last read.
  if (isInstalled("punch")) {
    const { punchDayStates } = await import("./punch-status");
    const punch = punchDayStates(week);
    const differs = punch.states.filter((s) => s?.state === "differs").length;
    items.push({
      key: "punch",
      label: "In Punch",
      state: !punch.pulledAt ? "unknown" : punch.inSync ? "ok" : over ? "open" : "later",
      detail: !punch.pulledAt ? "not read from Punch yet" : punch.inSync ? `all in · read ${ago(punch.pulledAt, now)}` : `${differs ? `${differs} ${differs === 1 ? "day differs" : "days differ"} · ` : ""}not complete · read ${ago(punch.pulledAt, now)}`,
      href: `/export/punch?${q}`,
    });
  }

  return { items, done: items.every((i) => i.state === "ok"), over };
}
