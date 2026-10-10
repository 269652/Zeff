import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { listTodos } from "@/lib/boards/store";
import { eventsBetween, listCalendars } from "@/lib/calendar/ir";
import { dateOf, dayOf, plusMinutes, stampOf, type ProposedEvent } from "@/lib/calendar/ir-shared";
import { CalendarApp } from "@/plugins/calendar/CalendarApp";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Kalender" };

/** The Monday of the week of a day ("YYYY-MM-DD"; else today's). */
function mondayOf(day?: string): string {
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? dateOf(day) : new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayOf(d);
}

/**
 * Kalender: a week of every calendar — Zeff's own, Google's, Outlook's (Zeff's calendar model) — and
 * the appointments the open todos propose.
 */
export default async function KalenderPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  await connection();
  if (!isInstalled("calendar")) return <PluginNotInstalled id="calendar" />;
  const week = mondayOf((await searchParams).w);
  const end = dateOf(week);
  end.setDate(end.getDate() + 7);
  const calendars = listCalendars();
  const events = eventsBetween(week, dayOf(end)).map(({ calendar: _c, ...e }) => e);
  // The appointments todos propose (their actions — not entered yet).
  const proposed: ProposedEvent[] = listTodos({ status: "open" }).flatMap((t) =>
    t.ops.flatMap((op): ProposedEvent[] => {
      const base = { todoId: t.id, todoRef: t.ref, todoText: t.text.slice(0, 120) };
      if (op.type === "calendar-event") return [{ ...base, type: op.type, title: op.subject, start: op.start, end: plusMinutes(op.start, op.minutes), target: "Outlook" }];
      if (op.type === "gcal-event") return [{ ...base, type: op.type, title: op.title, start: op.start, end: plusMinutes(op.start, op.minutes), target: "Google Calendar" }];
      if (op.type === "calendar-entry") return [{ ...base, type: op.type, title: op.title, start: op.start, end: plusMinutes(op.start, op.minutes), target: op.calendar || "Zeff-Kalender" }];
      return [];
    }),
  ).filter((p) => p.start >= week && p.start < dayOf(end));
  return (
    <div className="page">
      <CalendarApp week={week} calendars={calendars} events={events} proposed={proposed} now={stampOf(new Date())} canSync={isInstalled("google-calendar")} />
    </div>
  );
}
