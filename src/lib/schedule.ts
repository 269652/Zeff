import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Absence, WorkSchedule } from "@/db/schema";
import { ValidationError } from "./errors";
import { round2 } from "./format";
import { formatPauses, parsePauses, type PauseRange } from "./pauses-shared";
import {
  ABSENCE_TYPES,
  DEFAULT_FLEX_COMMENT,
  WEEKDAY_KEYS,
  type AbsenceType,
  type FlexTime,
  type WeekdayKey,
} from "./schedule-shared";
import { isoDate, type WeekInfo } from "./week";

const { workSchedule, absences } = schema;

export { ABSENCE_LABELS, ABSENCE_TYPES, DEFAULT_FLEX_COMMENT, WEEKDAY_KEYS, WEEKDAY_LABELS } from "./schedule-shared";
export type { AbsenceType, FlexTime, WeekdayKey } from "./schedule-shared";

// ---------------------------------------------------------------------------
// Weekly working pattern (part-time)
// ---------------------------------------------------------------------------

export function getWorkSchedule(): WorkSchedule {
  const db = getDb();
  const existing = db.select().from(workSchedule).limit(1).get();
  if (existing) return existing;
  return db.insert(workSchedule).values({ id: 1 }).returning().get();
}

/** Expected hours by weekday index (0 = Monday … 6 = Sunday). */
export function scheduleHours(s: WorkSchedule): number[] {
  return WEEKDAY_KEYS.map((k) => s[k]);
}

export function updateWorkSchedule(hours: Record<WeekdayKey, number>): WorkSchedule {
  for (const k of WEEKDAY_KEYS) {
    const v = hours[k];
    if (!Number.isFinite(v) || v < 0 || v > 24) {
      throw new ValidationError(`Hours for ${k} must be between 0 and 24.`);
    }
  }
  getWorkSchedule(); // ensure the row exists
  return getDb()
    .update(workSchedule)
    .set({
      mon: round2(hours.mon),
      tue: round2(hours.tue),
      wed: round2(hours.wed),
      thu: round2(hours.thu),
      fri: round2(hours.fri),
      sat: round2(hours.sat),
      sun: round2(hours.sun),
      updatedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

/** The default break window(s) on workdays (e.g. 12:00–13:00); empty when none is set. */
export function getDefaultPauses(s: WorkSchedule = getWorkSchedule()): PauseRange[] {
  if (!s.defaultPauses) return [];
  const parsed = parsePauses(s.defaultPauses);
  return parsed.ok ? parsed.pauses : [];
}

/** Set the default break ("12:00-13:00", "12 30m", …; empty = none) and whether TimO records it. */
export function updateDefaultPauses(text: string, exportToTimo: boolean): WorkSchedule {
  const parsed = parsePauses(text);
  if (!parsed.ok) throw new ValidationError(parsed.error);
  getWorkSchedule(); // ensure the row exists
  return getDb()
    .update(workSchedule)
    .set({
      defaultPauses: parsed.pauses.length ? formatPauses(parsed.pauses) : null,
      timoDefaultPauses: exportToTimo,
      updatedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

/** The flex-time (Gleitzeit) job and comment: where a day's missing hours can be booked in one click. */
export function getFlexTime(s: WorkSchedule = getWorkSchedule()): FlexTime {
  return { jobNumber: s.flexJobNumber?.trim() || null, comment: s.flexComment?.trim() || DEFAULT_FLEX_COMMENT };
}

/** Set the flex-time job (null = off) and the comment its bookings get (empty = the default). */
export function updateFlexTime(input: { jobNumber: string | null; comment: string }): WorkSchedule {
  getWorkSchedule(); // ensure the row exists
  const comment = input.comment.trim().slice(0, 200);
  return getDb()
    .update(workSchedule)
    .set({
      flexJobNumber: input.jobNumber?.trim() || null,
      flexComment: comment && comment !== DEFAULT_FLEX_COMMENT ? comment : null,
      updatedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

// ---------------------------------------------------------------------------
// One-off absences
// ---------------------------------------------------------------------------

export function listAbsences(opts: { from?: string; to?: string } = {}): Absence[] {
  const conditions = [];
  // Overlap test: absence.start <= range.to AND absence.end >= range.from
  if (opts.to) conditions.push(lte(absences.startDate, opts.to));
  if (opts.from) conditions.push(gte(absences.endDate, opts.from));
  return getDb()
    .select()
    .from(absences)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(absences.startDate))
    .all();
}

export function createAbsence(input: {
  startDate: string;
  endDate: string;
  type: AbsenceType;
  hours?: number | null;
  note?: string | null;
}): Absence {
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoRe.test(input.startDate) || !isoRe.test(input.endDate)) {
    throw new ValidationError("Absence dates must be YYYY-MM-DD.");
  }
  if (input.endDate < input.startDate) {
    throw new ValidationError("The end date cannot be before the start date.");
  }
  if (input.hours != null && (input.hours <= 0 || input.hours > 24)) {
    throw new ValidationError("Partial-day hours must be between 0 and 24.");
  }
  if (!ABSENCE_TYPES.includes(input.type)) {
    throw new ValidationError(`Unknown absence type "${input.type}".`);
  }
  return getDb()
    .insert(absences)
    .values({
      startDate: input.startDate,
      endDate: input.endDate,
      type: input.type,
      hours: input.hours ?? null,
      note: input.note?.trim() || null,
    })
    .returning()
    .get();
}

export function deleteAbsence(id: number): void {
  getDb().delete(absences).where(eq(absences.id, id)).run();
}

// ---------------------------------------------------------------------------
// Targets for a week (schedule minus absences)
// ---------------------------------------------------------------------------

export type WeekTargets = {
  /** Target hours per weekday (0 = Monday … 6 = Sunday), after absences. */
  targets: number[];
  /** Base schedule hours per weekday, before absences. */
  base: number[];
  /** The absence covering each weekday, if any. */
  absenceByDay: (Absence | undefined)[];
  /** Sum of `targets`. */
  weekTarget: number;
};

export function getWeekTargets(week: WeekInfo): WeekTargets {
  const days = getDayTargets(week.days);
  const targets = days.map((d) => d.target);
  return {
    targets,
    base: days.map((d) => d.base),
    absenceByDay: days.map((d) => d.absence),
    weekTarget: round2(targets.reduce((a, b) => a + b, 0)),
  };
}

/** A day's target: its weekday's scheduled hours, less any absence covering it. */
export type DayTarget = {
  /** YYYY-MM-DD */
  date: string;
  target: number;
  /** The schedule's hours for the weekday, before absences. */
  base: number;
  /** The absence covering the day, if any. */
  absence: Absence | undefined;
};

/** The targets of consecutive days (a week, a month). */
export function getDayTargets(days: Date[]): DayTarget[] {
  if (days.length === 0) return [];
  const base = scheduleHours(getWorkSchedule());
  const isos = days.map(isoDate);
  const covering = listAbsences({ from: isos[0], to: isos[isos.length - 1] });
  return days.map((day, i) => {
    const iso = isos[i];
    const weekday = (day.getDay() + 6) % 7; // 0 = Monday
    let target = base[weekday];
    let absence: Absence | undefined;
    for (const a of covering) {
      if (iso >= a.startDate && iso <= a.endDate) {
        absence ??= a;
        target = a.hours == null ? 0 : Math.max(0, target - a.hours);
      }
    }
    return { date: iso, target: round2(target), base: base[weekday], absence };
  });
}
