import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { listTodos } from "@/lib/boards/store";
import { eventsBetween, listCalendars } from "@/lib/calendar/ir";
import { dayOf, plusMinutes, stampOf, type ProposedEvent } from "@/lib/calendar/ir-shared";
import { CalendarApp } from "@/plugins/calendar/CalendarApp";
import { isView, viewRange, type ViewKind } from "@/plugins/calendar/view-shared";
import { actionHref } from "@/plugins/actions/catalog";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Calendar" };

/**
 * Kalender: every calendar — Zeff's own, Google's, Outlook's (Zeff's calendar model) — by day,
 * week, month or as an agenda (?v=…&d=YYYY-MM-DD; ?w= of old links: that week), with the
 * appointments the open todos propose.
 */
export default async function KalenderPage({ searchParams }: { searchParams: Promise<{ v?: string; d?: string; w?: string }> }) {
  await connection();
  if (!isInstalled("calendar")) return <PluginNotInstalled id="calendar" />;
  const sp = await searchParams;
  const view: ViewKind = isView(sp.v) ? sp.v : "week";
  const asked = sp.d ?? sp.w;
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : dayOf(new Date());
  const { from, to } = viewRange(view, day);
  const calendars = listCalendars();
  const events = eventsBetween(from, to).map(({ calendar: _c, ...e }) => e);
  // The appointments todos propose (their actions — not entered yet).
  const proposed: ProposedEvent[] = listTodos({ status: "open" }).flatMap((t) =>
    t.ops.flatMap((op, index): ProposedEvent[] => {
      const base = { todoId: t.id, todoRef: t.ref, todoText: t.text.slice(0, 120), index, href: actionHref(op) };
      if (op.type === "calendar-event") return [{ ...base, type: op.type, title: op.subject, start: op.start, end: plusMinutes(op.start, op.minutes), target: "Outlook" }];
      if (op.type === "gcal-event") return [{ ...base, type: op.type, title: op.title, start: op.start, end: plusMinutes(op.start, op.minutes), target: "Google Calendar" }];
      if (op.type === "calendar-entry") return [{ ...base, type: op.type, title: op.title, start: op.start, end: plusMinutes(op.start, op.minutes), target: op.calendar || "your Zeff calendar" }];
      return [];
    }),
  ).filter((p) => p.start < to && p.end > from);
  return (
    <CalendarApp view={view} day={day} explicitView={isView(sp.v)} calendars={calendars} events={events} proposed={proposed} now={stampOf(new Date())} canSync={isInstalled("google-calendar")} />
  );
}
