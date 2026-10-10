import { isInstalled } from "@/plugins/state";
import { formatHours } from "./format";
import { isoDate, type WeekInfo } from "./week";

/**
 * Wochenabschluss: is the week done? Each step of closing it — every day booked, the meetings and
 * the agents' suggestions taken over, every entry on a job, everything in Roar and TimO, approved in
 * Roar — as it stands, with where to do what's left. Nothing new is worked out here: the weekly
 * report, the calendar, Roar's and TimO's last pull say it; this puts it in one list. Roar and TimO
 * are as fresh as their last pull (a week never pulled: "unknown", not done).
 */

/** ok: done · open: something left · unknown: not known (not pulled yet) · later: not due yet (the week isn't over). */
export type CloseState = "ok" | "open" | "unknown" | "later";
export type CloseItem = { key: string; label: string; state: CloseState; detail: string; href: string };
export type WeekClose = { items: CloseItem[]; /** Every step done. */ done: boolean; /** The week is over (its last working day passed, or it's that day). */ over: boolean };

const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const ago = (iso: string, now: Date) => {
  const h = Math.floor((now.getTime() - Date.parse(iso)) / 3600e3);
  return h < 1 ? "gerade eben" : h < 24 ? `vor ${h} Std.` : `vor ${Math.floor(h / 24)} T.`;
};

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
    label: "Jeder Tag gebucht",
    state: missing.length ? "open" : future ? "later" : "ok",
    detail: missing.length ? `fehlt: ${missing.map((m) => `${m.day} ${formatHours(m.gap)} h`).join(", ")}` : `${formatHours(report.total)} von ${formatHours(targets.weekTarget)} h`,
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
      label: "Meetings gebucht",
      state: open.length ? "open" : "ok",
      detail: open.length ? `${open.length} noch nicht gebucht: ${open.slice(0, 3).map((e) => e.subject).join(", ")}${open.length > 3 ? " …" : ""}` : "alle gebucht",
      href: `/calendar?${q}`,
    });
  }

  // 3. The agents' suggestions for the week taken over or skipped.
  const { openSuggestions } = await import("./work/suggestions");
  const suggestions = openSuggestions().filter((s) => s.date >= week.startIso && s.date <= week.endIso);
  items.push({
    key: "suggestions",
    label: "Vorschläge übernommen",
    state: suggestions.length ? "open" : "ok",
    detail: suggestions.length ? `${suggestions.length} offen (${formatHours(suggestions.reduce((a, s) => a + s.hours, 0))} h)` : "keine offen",
    href: `/?${q}`,
  });

  // 4. Every entry on a job (the "No job yet" placeholder isn't exported).
  const entries = listEntries({ from: week.startIso, to: week.endIso });
  const noJob = entries.filter((e) => e.job.number === NO_JOB_NUMBER);
  items.push({
    key: "jobs",
    label: "Jede Buchung auf einem Job",
    state: noJob.length ? "open" : "ok",
    detail: noJob.length ? `${noJob.length} ohne Job (${formatHours(noJob.reduce((a, e) => a + e.hours, 0))} h)` : "alle",
    href: `/?${q}`,
  });

  // 5. + 7. Roar: everything in it, and approved — as of the last pull.
  if (isInstalled("roar")) {
    const { roarPulledAt, roarStatusByEntry } = await import("./roar-status");
    const pulledAt = roarPulledAt(week);
    const booked = entries.filter((e) => e.job.number !== NO_JOB_NUMBER);
    if (!pulledAt) {
      items.push({ key: "roar", label: "In Roar", state: "unknown", detail: "noch nicht aus Roar geholt", href: `/export/roar?${q}` });
      items.push({ key: "approved", label: "In Roar freigegeben", state: "unknown", detail: "noch nicht aus Roar geholt", href: `/export/roar?${q}` });
    } else {
      const statuses = roarStatusByEntry(week);
      const kinds = booked.map((e) => statuses[e.id]?.kind ?? "missing");
      const count = (k: string) => kinds.filter((x) => x === k).length;
      const stand = `Stand ${ago(pulledAt, now)}`;
      const notIn = count("missing");
      const rejected = count("rejected");
      items.push({
        key: "roar",
        label: "In Roar",
        state: !booked.length ? (over ? "ok" : "later") : notIn || rejected ? "open" : "ok",
        detail: [notIn ? `${notIn} nicht in Roar` : "", rejected ? `${rejected} abgelehnt` : "", !notIn && !rejected ? "alles drin" : "", stand].filter(Boolean).join(" · "),
        href: `/export/roar?${q}`,
      });
      const draft = count("draft");
      const submitted = count("submitted");
      items.push({
        key: "approved",
        label: "In Roar freigegeben",
        state: !booked.length ? (over ? "ok" : "later") : notIn || rejected || draft || submitted ? "open" : "ok",
        detail: [draft ? `${draft} nicht eingereicht` : "", submitted ? `${submitted} warten auf Freigabe` : "", !draft && !submitted && !notIn && !rejected ? "alles freigegeben" : "", stand].filter(Boolean).join(" · "),
        href: `/export/roar?${q}`,
      });
    }
  }

  // 6. TimO: the days as Zeff would record them — as of the last read.
  if (isInstalled("timo")) {
    const { timoDayStates } = await import("./timo-status");
    const timo = timoDayStates(week);
    const differs = timo.states.filter((s) => s?.state === "differs").length;
    items.push({
      key: "timo",
      label: "In TimO",
      state: !timo.pulledAt ? "unknown" : timo.inSync ? "ok" : over ? "open" : "later",
      detail: !timo.pulledAt ? "noch nicht aus TimO gelesen" : timo.inSync ? `alles drin · Stand ${ago(timo.pulledAt, now)}` : `${differs ? `${differs} Tage abweichend · ` : ""}nicht vollständig · Stand ${ago(timo.pulledAt, now)}`,
      href: `/export/timo?${q}`,
    });
  }

  return { items, done: items.every((i) => i.state === "ok"), over };
}
