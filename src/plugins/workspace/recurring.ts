import { randomUUID } from "node:crypto";
import { getPref, setPref } from "@/lib/prefs";
import { addRow, getDatabase, getPage } from "./store";
import { localDay } from "@/lib/dates";

/**
 * Rows that come back by themselves: a rule per database - from a row template, every N days, on some weekdays every N weeks, or on a
 * day of the month every N months, at a time - makes the next row when it is due (a date field of the row gets that day). Switched
 * off while Zeff was not running, a rule makes one row at the next look, not one per missed day. Server only.
 */

export type Recurrence = {
  id: string;
  db: number;
  /** The row template the rows are made from (none: an empty row with the title). */
  templateId?: number;
  title?: string;
  unit: "day" | "week" | "month";
  /** Every N days / weeks / months. */
  interval: number;
  /** Week: the weekdays (0 = Sunday); none: the weekday of the start. */
  weekdays?: number[];
  at: string;
  /** The first day (YYYY-MM-DD) - the weeks and months count from it. */
  start: string;
  /** A date field of the database (its id) that gets the day the row is for. */
  dateProp?: string;
  paused?: boolean;
  nextAt: string;
  lastRow?: number;
};

const KEY = "workspace.recurring";
const at = (d: Date, time: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), m ? Number(m[1]) : 8, m ? Number(m[2]) : 0);
};
const midnight = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

/** Whether the rule has a row for this day. */
export function occursOn(r: Pick<Recurrence, "unit" | "interval" | "weekdays" | "start">, d: Date): boolean {
  const s = midnight(r.start);
  const days = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(s.getFullYear(), s.getMonth(), s.getDate())) / 86400000);
  if (days < 0) return false;
  const n = Math.max(1, r.interval);
  if (r.unit === "day") return days % n === 0;
  if (r.unit === "week") {
    const wanted = r.weekdays?.length ? r.weekdays : [s.getDay()];
    // Weeks start on Monday.
    const weeks = Math.floor((days + ((s.getDay() + 6) % 7)) / 7);
    return wanted.includes(d.getDay()) && weeks % n === 0;
  }
  const months = (d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  // The 31st in a month with 30 days: its last day.
  return months >= 0 && months % n === 0 && d.getDate() === Math.min(s.getDate(), last);
}

/** The first moment after `from` the rule is due (null: never - nothing within about eight years). */
export function nextDue(r: Pick<Recurrence, "unit" | "interval" | "weekdays" | "start" | "at">, from: Date): Date | null {
  const t0 = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 3000; i++) {
    const d = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + i);
    const when = at(d, r.at);
    if (when.getTime() > from.getTime() && occursOn(r, d)) return when;
  }
  return null;
}

const all = (): Recurrence[] => {
  const v = getPref<Recurrence[]>(KEY, []);
  return Array.isArray(v) ? v : [];
};
export const recurrences = (db?: number): Recurrence[] => all().filter((r) => !db || r.db === db);

export type RecurrenceInput = Pick<Recurrence, "db" | "unit" | "interval" | "at" | "start"> & Partial<Pick<Recurrence, "id" | "templateId" | "title" | "weekdays" | "dateProp" | "paused">>;

/** A rule saved (new without an id). */
export function saveRecurrence(v: RecurrenceInput, now = new Date()): Recurrence {
  const database = getDatabase(v.db);
  if (!database) throw new Error("No such database.");
  if (!["day", "week", "month"].includes(v.unit)) throw new Error("Unknown unit.");
  if (v.templateId && getPage(v.templateId)?.dbId !== v.db) throw new Error("That template is not one of this database.");
  const prop = v.dateProp ? database.schema.properties.find((p) => p.id === v.dateProp && p.type === "date") : undefined;
  const rule: Recurrence = {
    id: v.id ?? randomUUID().slice(0, 8),
    db: v.db,
    ...(v.templateId ? { templateId: v.templateId } : {}),
    ...(v.title?.trim() ? { title: v.title.trim().slice(0, 200) } : {}),
    unit: v.unit,
    interval: Math.max(1, Math.min(365, Math.round(Number(v.interval) || 1))),
    ...(v.unit === "week" && v.weekdays?.length ? { weekdays: [...new Set(v.weekdays.filter((d) => d >= 0 && d <= 6))].sort() } : {}),
    at: /^\d{2}:\d{2}$/.test(v.at) ? v.at : "08:00",
    start: /^\d{4}-\d{2}-\d{2}$/.test(v.start) ? v.start : localDay(now),
    ...(prop ? { dateProp: prop.id } : {}),
    ...(v.paused ? { paused: true } : {}),
    nextAt: "",
  };
  // The first row: the start day at its time - or, when that is past, the next one.
  const startMs = midnight(rule.start).getTime();
  rule.nextAt = (nextDue(rule, new Date(Math.max(startMs - 1, now.getTime()))) ?? now).toISOString();
  setPref(KEY, [...all().filter((r) => r.id !== rule.id), rule]);
  return rule;
}

export function removeRecurrence(id: string): void {
  setPref(KEY, all().filter((r) => r.id !== id));
}

/** The rules that are due make their row - each once. How many rows were made. */
export function runDueRecurrences(now = new Date()): number {
  let made = 0;
  const rules = all();
  for (const r of rules) {
    if (r.paused || Date.parse(r.nextAt) > now.getTime()) continue;
    const dueDay = localDay(new Date(r.nextAt));
    r.nextAt = (nextDue(r, now) ?? new Date(now.getTime() + 365 * 86400000)).toISOString();
    try {
      const database = getDatabase(r.db);
      if (!database || database.page.archivedAt) continue;
      r.lastRow = addRow(r.db, { ...(r.title ? { title: r.title } : {}), ...(r.templateId ? { templateId: r.templateId } : {}), cells: r.dateProp ? { [r.dateProp]: dueDay } : {} });
      made++;
    } catch (e) {
      console.error(`[workspace] the repeating rule ${r.id} made no row: ${e instanceof Error ? e.message : e}`);
    }
  }
  setPref(KEY, rules);
  return made;
}
