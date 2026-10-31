"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode, type TransitionStartFunction } from "react";
import { useLang, useT } from "@/components/I18nProvider";
import { FocusDialog } from "@/components/Overlay";
import { toast } from "@/components/Toaster";
import type { CalendarEventView, CalendarView, ProposedEvent, SeriesScope } from "@/lib/calendar/ir-shared";
import { LANGUAGES } from "@/lib/i18n/shared";
import { AgendaList } from "./AgendaList";
import { EventDetails } from "./EventDetails";
import { EventEditor, ScopeChoice, type EditorInit } from "./EventEditor";
import { MonthGrid } from "./MonthGrid";
import { moveProposedEventAction, saveEventAction } from "./server-actions";
import { TimeGrid } from "./TimeGrid";
import { calendarItems, local, minutesOf, plus, stepDay, viewRange, ymd, type Item, type ViewKind } from "./view-shared";

export type Result = { ok: boolean; message?: string; error?: string } | null;

const two = (n: number) => String(n).padStart(2, "0");
const clock = () => {
  const d = new Date();
  return `${ymd(d)}T${two(d.getHours())}:${two(d.getMinutes())}`;
};

/**
 * The calendar itself — what the Kalender app and the Workspace's calendar view share: the appointments of the calendars shown by
 * day, week, month or as an agenda, made, moved and resized by dragging, opened, edited (a series' occurrence: which ones, asked
 * first), the keyboard, the now line. The grid and its dialogs come back to be put where the host wants them; going to another
 * view or day is the host's (`go`), and so is reading again after a change (`onChanged`; else the page is refreshed).
 */
export function useCalendarBody({
  view,
  day,
  calendars,
  events,
  proposed,
  now: serverNow,
  shown,
  showProposed,
  go,
  onChanged,
  defaultCalendarId,
}: {
  view: ViewKind;
  day: string;
  calendars: CalendarView[];
  events: CalendarEventView[];
  proposed: ProposedEvent[];
  now: string;
  shown: (c: CalendarView) => boolean;
  showProposed: boolean;
  go: (view: ViewKind, day: string) => void;
  onChanged?: () => void;
  /** @deprecated Shadow calendars are gone: a proposed appointment is one wherever it shows — ignored. */
  shadowAsProposal?: boolean;
  /** Where a new appointment goes (the embedded calendar's) — else the first of Zeff's own. */
  defaultCalendarId?: number;
}): { items: Item[]; days: string[]; today: string; pending: boolean; start: TransitionStartFunction; done: (r: Result, undo?: () => unknown) => boolean; newNow: () => void; grid: ReactNode; overlays: ReactNode } {
  const t = useT();
  const locale = LANGUAGES[useLang()].locale;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [now, setNow] = useState(serverNow);
  const [picked, setPicked] = useState<{ item: Item; rect: DOMRect | null } | null>(null);
  const [editor, setEditor] = useState<EditorInit | null>(null);
  const [moving, setMoving] = useState<{ item: Item; start: string; end: string } | null>(null);
  // Moved or resized here, until the server has it: shown where it went.
  const [moved, setMoved] = useState<Record<string, { start: string; end: string }>>({});
  const [lastEvents, setLastEvents] = useState(events);
  if (events !== lastEvents) {
    setLastEvents(events);
    setMoved({});
  }
  // Where a new appointment can go: Zeff's own calendars, then Google's you may write to (written there through its API).
  const own = [...calendars.filter((c) => c.source === "zeff"), ...calendars.filter((c) => c.source === "google" && c.writable)];
  const { days } = viewRange(view, day);
  const today = now.slice(0, 10);

  // The clock (the now line) once a minute.
  useEffect(() => {
    const timer = setInterval(() => setNow(clock()), 60000);
    return () => clearInterval(timer);
  }, []);

  const items: Item[] = useMemo(() => calendarItems(events, proposed, calendars, shown, showProposed, moved), [events, proposed, calendars, shown, showProposed, moved]);

  const done = useCallback(
    (r: Result, undo?: () => unknown) => {
      toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error", action: r?.ok && undo ? { label: t("Undo"), run: undo } : undefined });
      if (onChanged) onChanged();
      else router.refresh();
      return !!r?.ok;
    },
    [router, t, onChanged],
  );

  const create = useCallback(
    (v: { start: string; end: string; allDay: boolean }) => {
      setPicked(null);
      setEditor({ calendarId: defaultCalendarId ?? own.find((c) => c.source === "zeff")?.id ?? 0, title: "", start: v.start, end: v.end, allDay: v.allDay, location: "", description: "", recurrence: null });
    },
    [own, defaultCalendarId],
  );
  const newNow = useCallback(() => {
    const at = Math.ceil((minutesOf(now) + 1) / 30) * 30;
    const base = days.includes(today) ? today : days[0];
    const start = days.includes(today) && at < 24 * 60 ? `${base}T${two(Math.floor(at / 60))}:${two(at % 60)}` : `${base}T09:00`;
    create({ start, end: plus(start, 60), allDay: false });
  }, [now, days, today, create]);

  const edit = (it: Item) => {
    const e = it.event;
    if (!e || !it.editable) return;
    setPicked(null);
    setEditor({ id: e.id, calendarId: e.calendarId, title: e.title, start: it.start, end: it.end, allDay: e.allDay, location: e.location, description: e.description, recurrence: e.recurrence, occurrence: e.occurrence });
  };

  /** A drag ended: an appointment's new times saved (a series' occurrence: which ones, asked first). */
  const save = (it: Item, s: string, e: string, scope?: SeriesScope, undoable = true) => {
    const ev = it.event!;
    const [was, wasEnd] = [it.start, it.end];
    setMoved((m) => ({ ...m, [it.id]: { start: s, end: e } }));
    start(async () => {
      const r = await saveEventAction({ id: ev.id, calendarId: ev.calendarId, title: ev.title, start: s, end: e, allDay: ev.allDay, location: ev.location, description: ev.description, occurrence: ev.occurrence, scope });
      if (!r?.ok) setMoved((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== it.id)));
      // Undo: the same handler with the old times (not for one occurrence of a series — it has moved to another day's id).
      // (A Google event is read back with a new id here: its undo is in Google Calendar.)
      done(r, undoable && !ev.occurrence && it.calendar?.source !== "google" ? () => save({ ...it, start: s, end: e }, was, wasEnd, undefined, false) : undefined);
    });
  };
  /** A proposed appointment dragged or resized: shown where it went, saved in the todo's action. */
  const moveProposed = (it: Item, s: string, e: string, undoable = true) => {
    const p = it.proposed!;
    const [was, wasEnd] = [it.start, it.end];
    setMoved((m) => ({ ...m, [it.id]: { start: s, end: e } }));
    start(async () => {
      const r = await moveProposedEventAction(p.todoId, p.index, s, e);
      if (!r?.ok) setMoved((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== it.id)));
      done(r, undoable ? () => moveProposed({ ...it, start: s, end: e }, was, wasEnd, false) : undefined);
    });
  };
  const move = (it: Item, s: string, e: string) => {
    if (it.proposed && it.editable) return moveProposed(it, s, e);
    if (!it.editable || !it.event) return;
    if (it.event.occurrence) setMoving({ item: it, start: s, end: e });
    else save(it, s, e);
  };

  // The keyboard: today, back, forward, the views, a new appointment.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (editor || moving || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === "t") go(view, ymd(new Date()));
      else if (e.key === "ArrowLeft" || k === "j") go(view, stepDay(view, day, -1));
      else if (e.key === "ArrowRight" || k === "k") go(view, stepDay(view, day, 1));
      else if (k === "d" || k === "w" || k === "m" || k === "a") go(({ d: "day", w: "week", m: "month", a: "agenda" } as const)[k], day);
      else if (k === "n" || k === "c") newNow();
      else if (k === "e" && picked?.item.editable) edit(picked.item);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const open = (item: Item, rect: DOMRect | null) => setPicked({ item, rect });
  const grid =
    view === "month" ? (
      <MonthGrid days={days} month={day.slice(0, 7)} items={items} today={today} onCreate={create} onOpen={open} onMove={move} onPickDay={(d) => go("day", d)} />
    ) : view === "agenda" ? (
      <AgendaList days={days} items={items} today={today} onOpen={open} />
    ) : (
      <div className="h-full overflow-x-auto">
        <div className={`h-full ${view === "week" ? "min-w-[720px]" : ""}`}>
          <TimeGrid days={days} items={items} now={now} onCreate={create} onOpen={open} onMove={move} onPickDay={(d) => go("day", d)} />
        </div>
      </div>
    );

  const overlays = (
    <>
      {picked && <EventDetails key={picked.item.id} item={picked.item} anchor={picked.rect} onClose={() => setPicked(null)} onEdit={() => edit(picked.item)} onDone={(r, undo) => done(r, undo) && setPicked(null)} />}
      {editor && <EventEditor init={editor} calendars={own} onClose={() => setEditor(null)} onDone={(r, undo) => done(r, undo) && setEditor(null)} />}
      {moving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
          <FocusDialog label={t("Move recurring event")} className="card w-full max-w-sm p-4 shadow-2xl">
            <p className="mb-2 text-xs text-zinc-500">
              “{moving.item.title}” → {local(moving.start).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </p>
            <ScopeChoice
              title={t("Move recurring event")}
              pending={pending}
              onCancel={() => setMoving(null)}
              onPick={(scope) => {
                save(moving.item, moving.start, moving.end, scope);
                setMoving(null);
              }}
            />
          </FocusDialog>
        </div>
      )}
    </>
  );

  return { items, days, today, pending, start, done, newNow, grid, overlays };
}
