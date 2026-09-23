import { listEntries } from "./entries";
import { round2 } from "./format";
import { getWorkSchedule, scheduleHours } from "./schedule";
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
};

export const DEFAULT_TIMO_CONFIG: TimoConfig = { startTime: "08:00", workdayHours: 8, breakMinutes: 30 };

export function timeToMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return 8 * 60;
  return Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2]));
}
export function minutesToTime(min: number): string {
  const m = ((Math.round(min) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
/** End of the span so the net (span − break) equals the target hours. */
export function computeEnd(startTime: string, hours: number, breakMinutes: number): string {
  return minutesToTime(timeToMinutes(startTime) + Math.round(hours * 60) + Math.max(0, breakMinutes));
}

export type TimoDay = {
  iso: string;
  label: string;
  /** Net working hours to record for the day. */
  hours: number;
  start: string;
  end: string;
  /** Where the hours came from: Zeff bookings, or a gap filled with the default day. */
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
};

export function getTimoExportPlan(
  week: WeekInfo,
  config: TimoConfig,
  opts: { reportedBy?: string; fillGaps?: boolean } = {},
): TimoExportPlan {
  const entries = listEntries({ from: week.startIso, to: week.endIso, reportedBy: opts.reportedBy });
  const byDay = new Map<string, number>();
  for (const e of entries) byDay.set(e.date, round2((byDay.get(e.date) ?? 0) + e.hours));
  const schedule = scheduleHours(getWorkSchedule()); // hours per weekday, index 0 = Monday … 6 = Sunday

  const days: TimoDay[] = [];
  week.days.forEach((d, i) => {
    const iso = isoDate(d);
    const zeff = byDay.get(iso) ?? 0;
    const isWorkday = (schedule[i] ?? 0) > 0;
    let hours = 0;
    let source: "zeff" | "gap" = "zeff";
    if (zeff > 0) {
      hours = zeff;
      source = "zeff";
    } else if (opts.fillGaps && isWorkday) {
      hours = config.workdayHours;
      source = "gap";
    } else {
      return; // nothing booked and not a gap to fill
    }
    days.push({
      iso,
      label: formatDay(d, "EEE d"),
      hours: round2(hours),
      start: config.startTime,
      end: computeEnd(config.startTime, hours, config.breakMinutes),
      source,
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
  };
}

/** The compact payload handed to the timo-mcp export tool. */
export type TimoExportPayload = {
  days: { iso: string; start: string; end: string; hours: number; source: "zeff" | "gap" }[];
};

export function toTimoPayload(plan: TimoExportPlan): TimoExportPayload {
  return { days: plan.days.map((d) => ({ iso: d.iso, start: d.start, end: d.end, hours: d.hours, source: d.source })) };
}
