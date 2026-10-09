import { listEntries } from "./entries";
import { round2 } from "./format";
import { listPausesByDate } from "./pauses";
import type { PauseRange } from "./pauses-shared";
import { getDefaultPauses, getFlexTime, getWorkSchedule, scheduleHours } from "./schedule";
import { formatDay, isoDate, type WeekInfo } from "./week";

/**
 * TimO records working time as a start–end span per day (Kommen/Gehen). We derive
 * each day's span from Zeff's booked hours (or a configurable default work day for
 * gaps), then TimO deducts the break to get the net working time — e.g. 08:00–16:30
 * is an 8 h day with a 30 min break.
 */
export type TimoConfig = {
  /** Day start, "HH:MM". */
  startTime: string;
  /** Default net working hours for a gap day. */
  workdayHours: number;
  /** Break (minutes) added to the span so TimO's net matches the target hours. */
  breakMinutes: number;
  /** Zeff job number whose entries are absences (booked via TimO's absence form, not Kommen/Gehen). */
  absenceJobNumber?: string;
  /** TimO absence type (`art`) for those entries, e.g. "Urlaub". */
  absenceType?: string;
};

export const DEFAULT_TIMO_CONFIG: TimoConfig = { startTime: "08:00", workdayHours: 8, breakMinutes: 30, absenceJobNumber: "", absenceType: "Urlaub" };

export function timeToMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return 8 * 60;
  return Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2]));
}
export function minutesToTime(min: number): string {
  const m = ((Math.round(min) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
/**
 * Break TimO deducts from a day's span (its automatic pause follows the German ArbZG):
 * none up to 6 h, the configured break above that, at least 45 min over 9 h.
 */
export function breakFor(hours: number, breakMinutes: number): number {
  if (hours <= 6) return 0;
  return Math.max(0, hours > 9 ? Math.max(breakMinutes, 45) : breakMinutes);
}
/** End of the span so the net (span − break) equals the target hours. */
export function computeEnd(startTime: string, hours: number, breakMinutes: number): string {
  return minutesToTime(timeToMinutes(startTime) + Math.round(hours * 60) + breakFor(hours, breakMinutes));
}

/**
 * Lay a day's net hours out from the start time around its breaks: work until a break,
 * pause, carry on — TimO then gets Kommt/Geht around each break. Breaks outside the
 * working span (before the start, or after the work is done) are left out. A recorded
 * break counts toward TimO's automatic pause, so only what's missing to it is added at
 * the end; with no break this is exactly computeEnd.
 */
export function layoutDay(
  startTime: string,
  hours: number,
  breaks: PauseRange[],
  breakMinutes: number,
): { start: string; end: string; breaks: PauseRange[] } {
  const start = timeToMinutes(startTime);
  let t = start;
  let left = Math.round(hours * 60);
  let recorded = 0;
  const used: PauseRange[] = [];
  for (const b of [...breaks].sort((x, y) => timeToMinutes(x.start) - timeToMinutes(y.start))) {
    const from = timeToMinutes(b.start);
    const to = timeToMinutes(b.end);
    if (from < t) continue; // before the day starts (or overlapping the previous break)
    if (from - t >= left) break; // the work is done before this break
    left -= from - t;
    recorded += to - from;
    used.push(b);
    t = to;
  }
  const topUp = Math.max(0, breakFor(hours, breakMinutes) - recorded);
  return { start: minutesToTime(start), end: minutesToTime(t + left + topUp), breaks: used };
}

export type TimoDay = {
  iso: string;
  label: string;
  /** Working time (Kommen/Gehen span) or an absence (TimO absence form); a half day off can have both. */
  kind: "work" | "absence";
  /** Net hours (work hours, or the absence's booked hours for reference). */
  hours: number;
  /** Only for work days. */
  start: string;
  end: string;
  /** Breaks recorded between start and end (as Geht/Kommt), and where they came from. */
  breaks?: PauseRange[];
  breakSource?: "entered" | "default";
  /** Only for absence days: the TimO absence type (`art`), and whether it's a half day. */
  absenceType?: string;
  halfDay?: boolean;
  /** Work day that shares its date with a half day off. */
  withAbsence?: boolean;
  /** Where it came from: Zeff bookings, or a gap filled with the default day. */
  source: "zeff" | "gap";
};

export type TimoExportPlan = {
  weekKey: string;
  weekStartIso: string;
  config: TimoConfig;
  days: TimoDay[];
  total: number;
  fillGaps: boolean;
  filter: { reportedBy?: string };
  /** Flex time (Gleitzeit) booked per day — not recorded: TimO's own balance covers it. */
  flex: { iso: string; label: string; hours: number }[];
};

export function getTimoExportPlan(
  week: WeekInfo,
  config: TimoConfig,
  opts: { reportedBy?: string; fillGaps?: boolean } = {},
): TimoExportPlan {
  const entries = listEntries({ from: week.startIso, to: week.endIso, reportedBy: opts.reportedBy });
  const absenceJob = (config.absenceJobNumber ?? "").trim();
  const workSchedule = getWorkSchedule();
  const flexJob = getFlexTime(workSchedule).jobNumber;
  const workByDay = new Map<string, number>();
  const absenceByDay = new Map<string, number>();
  const flexByDay = new Map<string, number>();
  for (const e of entries) {
    // Absences: entries of type Absence, or anything booked on the configured absence job. Flex time
    // (the Gleitzeit job) isn't working time: left out, TimO's flex balance goes down by it.
    const map =
      e.type === "absence" || (absenceJob && e.job.number === absenceJob)
        ? absenceByDay
        : flexJob && e.job.number === flexJob
          ? flexByDay
          : workByDay;
    map.set(e.date, round2((map.get(e.date) ?? 0) + e.hours));
  }
  const schedule = scheduleHours(workSchedule); // hours per weekday, index 0 = Monday … 6 = Sunday
  // Breaks: the ones entered in the Pause row ([] = "no break"), else the default break when enabled.
  const entered = listPausesByDate(week.startIso, week.endIso);
  const defaultBreaks = workSchedule.timoDefaultPauses ? getDefaultPauses(workSchedule) : [];

  const days: TimoDay[] = [];
  const flex: TimoExportPlan["flex"] = [];
  week.days.forEach((d, i) => {
    const iso = isoDate(d);
    const label = formatDay(d, "EEE d");
    const absenceHours = absenceByDay.get(iso) ?? 0;
    const workHours = workByDay.get(iso) ?? 0;
    const flexHours = flexByDay.get(iso) ?? 0;
    const isWorkday = (schedule[i] ?? 0) > 0;
    if (flexHours > 0) flex.push({ iso, label, hours: flexHours });

    if (absenceHours > 0) {
      // A day booked on the absence job → TimO's absence form; up to half the work day is a half day.
      const halfDay = absenceHours <= config.workdayHours / 2;
      days.push({ iso, label, kind: "absence", hours: round2(absenceHours), start: "", end: "", absenceType: config.absenceType || "Urlaub", halfDay, source: "zeff" });
      if (!halfDay || workHours <= 0) return; // a whole day off, or nothing else booked that day
    }
    let hours = 0;
    let source: "zeff" | "gap" = "zeff";
    if (workHours > 0) {
      hours = workHours;
      source = "zeff";
    } else if (opts.fillGaps && isWorkday && flexHours <= 0) {
      hours = config.workdayHours;
      source = "gap";
    } else {
      return; // nothing booked (or flex time only), and not a gap to fill
    }
    const dayBreaks = entered[iso] ?? defaultBreaks;
    const layout = layoutDay(config.startTime, hours, dayBreaks, config.breakMinutes);
    days.push({
      iso,
      label,
      kind: "work",
      hours: round2(hours),
      start: layout.start,
      end: layout.end,
      ...(layout.breaks.length
        ? { breaks: layout.breaks, breakSource: entered[iso] ? ("entered" as const) : ("default" as const) }
        : {}),
      source,
      ...(absenceHours > 0 ? { withAbsence: true } : {}),
    });
  });

  return {
    weekKey: week.key,
    weekStartIso: week.startIso,
    config,
    days,
    total: round2(days.reduce((a, d) => a + d.hours, 0)),
    fillGaps: !!opts.fillGaps,
    filter: { reportedBy: opts.reportedBy },
    flex,
  };
}

/** The compact payload handed to the timo-mcp export tool. */
export type TimoExportPayload = {
  days: {
    iso: string;
    kind: "work" | "absence";
    start: string;
    end: string;
    /** Breaks inside the span: Geht at each start, Kommt at each end. */
    breaks?: PauseRange[];
    hours: number;
    absenceType?: string;
    halfDay?: boolean;
    withAbsence?: boolean;
    source: "zeff" | "gap";
  }[];
};

export function toTimoPayload(plan: TimoExportPlan): TimoExportPayload {
  return {
    days: plan.days.map((d) => ({
      iso: d.iso,
      kind: d.kind,
      start: d.start,
      end: d.end,
      breaks: d.breaks,
      hours: d.hours,
      absenceType: d.absenceType,
      halfDay: d.halfDay,
      withAbsence: d.withAbsence,
      source: d.source,
    })),
  };
}
