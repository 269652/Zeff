import { getSqlite } from "@/db";
import { listTodos } from "@/lib/boards/store";
import { eventsBetween, listCalendars } from "@/lib/calendar/ir";
import { dayOf, plusMinutes, stampOf, type CalendarEventView, type CalendarView, type ProposedEvent } from "@/lib/calendar/ir-shared";
import { t } from "@/lib/i18n/server";
import { actionHref } from "@/plugins/actions/catalog";
import { isInstalled } from "@/plugins/state";
import { isView, viewRange, type ViewKind } from "./view-shared";

/** What the calendar app shows for a view around a day: the calendars, the appointments in range, those todos propose. Server only. */
export type CalendarData = { view: ViewKind; day: string; calendars: CalendarView[]; events: CalendarEventView[]; proposed: ProposedEvent[]; now: string; canSync: boolean };

/**
 * The shadow calendars a page (not in the trash) still embeds: those the main calendar shows — a plan whose block is gone stays
 * out (it isn't deleted: Ctrl+Z brings its block back).
 */
function shadowsInUse(): Set<number> {
  const out = new Set<number>();
  try {
    const rows = getSqlite().prepare("select content from ws_pages where archived_at is null and content like '%calendarEmbed%'").all() as { content: string }[];
    for (const r of rows) for (const m of r.content.matchAll(/"calendarId":(\d+)/g)) out.add(Number(m[1]));
  } catch {
    // no Workspace: none
  }
  return out;
}

/** `keep`: shadow calendars shown all the same (the block showing them — just made, its page not saved yet). */
export async function calendarViewData(viewIn: string | undefined, dayIn: string | undefined, keep: number[] = []): Promise<CalendarData> {
  const view: ViewKind = isView(viewIn) ? viewIn : "week";
  const day = dayIn && /^\d{4}-\d{2}-\d{2}$/.test(dayIn) ? dayIn : dayOf(new Date());
  const { from, to } = viewRange(view, day);
  // The entries with a start time as a calendar of their own ("Done"): read again from them for what is shown.
  if (isInstalled("zeiterfassung")) (await import("@/lib/calendar/done")).syncDoneCalendar(from, to);
  // Google's calendars you may write to (and Google holds the right): changed here, through Google's API.
  const { googleGrants } = await import("@/lib/google/grants");
  const gcal = googleGrants().includes("gcal-write") ? await import("@/plugins/google-calendar/sync") : null;
  if (gcal) await gcal.learnWritableGoogleCalendars();
  const writable = new Set(gcal?.writableGoogleCalendars() ?? []);
  const used = shadowsInUse();
  const calendars = listCalendars()
    .filter((c) => !c.shadow || used.has(c.id) || keep.includes(c.id))
    .map((c) => (c.source === "google" && writable.has(c.key.replace(/^google:/, "")) ? { ...c, writable: true } : c));
  const shown = new Set(calendars.map((c) => c.id));
  const events = eventsBetween(from, to)
    .filter((e) => shown.has(e.calendarId))
    .map(({ calendar: _c, ...e }) => e);
  // The appointments todos propose (their actions — not entered yet).
  const proposed: ProposedEvent[] = listTodos({ status: "open" })
    .flatMap((todo) =>
      todo.ops.flatMap((op, index): ProposedEvent[] => {
        const base = { todoId: todo.id, todoRef: todo.ref, todoText: todo.text.slice(0, 120), index, href: actionHref(op) };
        if (op.type === "calendar-event") return [{ ...base, type: op.type, title: op.subject, start: op.start, end: plusMinutes(op.start, op.minutes), target: "Outlook" }];
        if (op.type === "gcal-event") return [{ ...base, type: op.type, title: op.title, start: op.start, end: plusMinutes(op.start, op.minutes), target: "Google Calendar" }];
        if (op.type === "calendar-entry") return [{ ...base, type: op.type, title: op.title, start: op.start, end: plusMinutes(op.start, op.minutes), target: op.calendar || t("your Zeff calendar") }];
        return [];
      }),
    )
    .filter((p) => p.start < to && p.end > from);
  return { view, day, calendars, events, proposed, now: stampOf(new Date()), canSync: isInstalled("google-calendar") };
}
