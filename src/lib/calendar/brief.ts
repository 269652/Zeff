import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { describeRecurrence, parseRecurrence } from "./recurrence";

/** A calendar appointment a todo is related to (its series): what the todo's context shows of it. */
export type CalendarBrief = { ref: string; id: number; todoId: number; title: string; start: string; /** The rule in words ("Monthly on day 15"), none for a single appointment. */ rule: string | null; calendar: string };

export const calendarRef = (id: number) => `cal:${id}`;

/** The appointments with these refs ("cal:12"), by ref. */
export function calendarBriefsByRefs(refs: string[]): Map<string, CalendarBrief> {
  const ids = [...new Set(refs.filter((r) => r.startsWith("cal:")).map((r) => Number(r.slice(4))).filter(Number.isInteger))];
  if (!ids.length) return new Map();
  const { calendarEvents, calendars } = schema;
  const rows = getDb().select({ e: calendarEvents, c: calendars.name }).from(calendarEvents).innerJoin(calendars, eq(calendars.id, calendarEvents.calendarId)).where(and(inArray(calendarEvents.id, ids))).all();
  return new Map(
    rows.map(({ e, c }) => {
      const rule = parseRecurrence(e.recurrence);
      return [calendarRef(e.id), { ref: calendarRef(e.id), id: e.id, todoId: e.todoId ?? 0, title: e.title, start: e.start, rule: rule ? describeRecurrence(rule, e.start) : null, calendar: c }] as const;
    }),
  );
}
