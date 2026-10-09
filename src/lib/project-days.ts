import { addDays } from "date-fns";
import type { EntryType } from "@/db/schema";
import { createEntry, listEntries } from "./entries";
import { ValidationError } from "./errors";
import { round2 } from "./format";
import { requireProject } from "./projects";
import { getWeekTargets, type WeekTargets } from "./schedule";
import { hoursSchema, isoDateSchema } from "./validation";
import { isoDate, weekFromDate } from "./week";

export type BookDaysInput = {
  projectId: number;
  from: string;
  to: string;
  /** Hours per day; undefined = each day's target (schedule minus absences). */
  hours?: number;
  /** Cap each day at what is still missing to its target. */
  fillUp: boolean;
  description: string;
  type?: EntryType;
};

export type BookDaysResult = {
  booked: { date: string; hours: number }[];
  skipped: { date: string; reason: string }[];
};

const MAX_DAYS = 62;

/**
 * Book one entry per working day of a date range on a project — e.g. the three days of
 * a training. Days without a target (weekends, days off, full absences) are skipped,
 * and with `fillUp` each day only gets what is still missing to its target.
 */
export function bookProjectDays(input: BookDaysInput): BookDaysResult {
  const from = isoDateSchema.safeParse(input.from);
  const to = isoDateSchema.safeParse(input.to || input.from);
  if (!from.success || !to.success) throw new ValidationError("Pick a start and end date.");
  if (to.data < from.data) throw new ValidationError("The end date is before the start date.");
  if (input.hours !== undefined && !hoursSchema.safeParse(input.hours).success) {
    throw new ValidationError("Hours per day must be between 0 and 24.");
  }
  const description = input.description.trim();
  if (!description) throw new ValidationError("Description is required.");
  const project = requireProject(input.projectId);

  const days: string[] = [];
  for (let d = new Date(from.data + "T00:00:00"); isoDate(d) <= to.data; d = addDays(d, 1)) {
    days.push(isoDate(d));
    if (days.length > MAX_DAYS) throw new ValidationError(`Book at most ${MAX_DAYS} days at once.`);
  }

  // Hours already booked per day (for fill-up).
  const bookedByDay = new Map<string, number>();
  for (const e of listEntries({ from: from.data, to: to.data })) {
    bookedByDay.set(e.date, round2((bookedByDay.get(e.date) ?? 0) + e.hours));
  }

  const targetsByWeek = new Map<string, WeekTargets>();
  const targetOf = (iso: string): number => {
    const week = weekFromDate(new Date(iso + "T00:00:00"));
    let t = targetsByWeek.get(week.key);
    if (!t) targetsByWeek.set(week.key, (t = getWeekTargets(week)));
    return t.targets[week.days.findIndex((d) => isoDate(d) === iso)] ?? 0;
  };

  const result: BookDaysResult = { booked: [], skipped: [] };
  for (const date of days) {
    const target = targetOf(date);
    if (target <= 0) {
      result.skipped.push({ date, reason: "day off" });
      continue;
    }
    let hours = input.hours ?? target;
    if (input.fillUp) hours = Math.min(hours, round2(target - (bookedByDay.get(date) ?? 0)));
    hours = round2(hours);
    if (hours <= 0) {
      result.skipped.push({ date, reason: "already booked" });
      continue;
    }
    createEntry({ projectId: project.id, date, hours, description, type: input.type }, "web");
    result.booked.push({ date, hours });
  }
  return result;
}
