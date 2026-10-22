import { SOURCE_LABELS } from "@/lib/calendar/ir-shared";
import type { T } from "@/lib/i18n/shared";
import type { CalendarData } from "./view-data";
import { isView, stepDay, viewTitle, type ViewKind } from "./view-shared";

/**
 * What the calendar view's template reads as app.* (view-template.ts): where the view is (the view and the day from its state, the
 * steps back and forth, the range as a title), the calendars by source for the sidebar, how many appointments todos propose. The
 * toolbar's figures come from the state alone, so it is there while the appointments load. Client-safe; the parts read the data
 * itself (app.data).
 */
export function calendarAppData(d: CalendarData | null, v: { state: Record<string, string>; t: T; today: string; error?: string }): Record<string, unknown> {
  const { t, today } = v;
  const view: ViewKind = isView(v.state.view) ? v.state.view : "week";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(v.state.day ?? "") ? v.state.day : today;
  const groups = (["zeff", "google", "outlook"] as const)
    .map((source) => ({
      source,
      label: source === "zeff" ? t("My calendars") : SOURCE_LABELS[source],
      calendars: (d?.calendars ?? []).filter((c) => c.source === source).map((c) => ({ id: c.id, name: c.name, color: c.color, free: !c.busy })),
    }))
    .filter((g) => g.calendars.length);
  return {
    loading: !d,
    error: v.error ?? "",
    view,
    day,
    today,
    prev: stepDay(view, day, -1),
    next: stepDay(view, day, 1),
    title: viewTitle(view, day),
    canSync: !!d?.canSync,
    groups,
    proposedCount: d?.proposed.length ?? 0,
    data: d,
  };
}

/** What app.* holds — the AI and the language's help read it. */
export const CALENDAR_APP_DATA =
  "app.loading, app.error, app.view (day|week|month|agenda), app.day (the day the view is around, YYYY-MM-DD), app.today, app.prev and app.next (the day a step back or on goes to), app.title (the range written out), app.canSync (Google Calendar there), app.groups (each: source zeff|google|outlook, label, calendars: id, name, color, free — doesn't block time), app.proposedCount (appointments todos propose). State: state.view, state.day (empty: today), state.proposed (\"true\": the todos' proposals shown), state.cal<id> (\"1\"/\"0\": a calendar switched on or off here), state.saving (\"true\" while a change is saved).";
