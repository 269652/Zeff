"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useLang, useT } from "@/components/I18nProvider";
import { SidebarFrame } from "@/components/SidebarFrame";
import { toast } from "@/components/Toaster";
import { SOURCE_LABELS, type CalendarEventView, type CalendarView, type ProposedEvent, type SeriesScope } from "@/lib/calendar/ir-shared";
import { LANGUAGES, type T } from "@/lib/i18n/shared";
import { AgendaList } from "./AgendaList";
import { EventDetails } from "./EventDetails";
import { EventEditor, ScopeChoice, type EditorInit } from "./EventEditor";
import { MiniMonth } from "./MiniMonth";
import { MonthGrid } from "./MonthGrid";
import { moveProposedEventAction, saveEventAction, syncCalendarsAction, updateCalendarAction } from "./server-actions";
import { TimeGrid } from "./TimeGrid";
import { itemOn, local, minutesOf, plus, stepDay, viewLabels, VIEWS, viewRange, viewTitle, ymd, type Item, type ViewKind } from "./view-shared";

type Result = { ok: boolean; message?: string; error?: string } | null;

const shortcuts = (t: T): [string, string][] => [
  ["T", t("Today")],
  ["← / →", t("Previous / next")],
  ["D W M A", t("Day, week, month, agenda")],
  ["N", t("New event")],
  ["Alt + ↑ ↓ ← →", t("Move the focused event by 15 minutes / a day")],
  ["Shift + Alt + ↑ ↓", t("Change the focused event's end")],
  ["Esc", t("Close")],
];

/** The actions that are an appointment and can be moved by dragging (their start and length are in the action). */
const MOVABLE_PROPOSALS = new Set(["calendar-event", "gcal-event", "calendar-entry"]);

const two = (n: number) => String(n).padStart(2, "0");
const clock = () => {
  const d = new Date();
  return `${ymd(d)}T${two(d.getHours())}:${two(d.getMinutes())}`;
};

/**
 * The Kalender app: every calendar (Zeff's own, Google's, Outlook's) by day, week, month or as an
 * agenda, with the appointments todos propose (dashed). Zeff's own appointments are made, moved and
 * resized by dragging, opened, edited and deleted (a series' occurrence: this one, the following,
 * or all); Google's and Outlook's open in their source.
 */
export function CalendarApp({
  view,
  day,
  explicitView,
  calendars,
  events,
  proposed,
  now: serverNow,
  canSync,
}: {
  view: ViewKind;
  /** The day the view is around ("YYYY-MM-DD"). */
  day: string;
  /** The view was asked for (else a narrow screen gets the day view). */
  explicitView: boolean;
  calendars: CalendarView[];
  events: CalendarEventView[];
  proposed: ProposedEvent[];
  now: string;
  canSync: boolean;
}) {
  const t = useT();
  const locale = LANGUAGES[useLang()].locale;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [now, setNow] = useState(serverNow);
  const [shown, setShown] = useState<Record<number, boolean>>(() => Object.fromEntries(calendars.map((c) => [c.id, c.visible])));
  const [showProposed, setShowProposed] = useState(true);
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
  const own = calendars.filter((c) => c.source === "zeff");
  const byId = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const { days } = viewRange(view, day);
  const today = now.slice(0, 10);

  const go = useCallback((v: ViewKind, d: string) => router.push(`/kalender?v=${v}&d=${d}`), [router]);

  // The clock (the now line) once a minute; a narrow screen opens on the day view.
  useEffect(() => {
    const timer = setInterval(() => setNow(clock()), 60000);
    if (!explicitView && window.innerWidth < 640 && view !== "day") router.replace(`/kalender?v=day&d=${day}`);
    return () => clearInterval(timer);
  }, [explicitView, view, day, router]);

  const items: Item[] = useMemo(
    () => [
      ...events
        .filter((e) => shown[e.calendarId] && !e.cancelled)
        .map((e): Item => {
          const id = e.occurrence ? `e${e.id}@${e.occurrence}` : `e${e.id}`;
          const cal = byId.get(e.calendarId);
          return { id, title: e.title, start: moved[id]?.start ?? e.start, end: moved[id]?.end ?? e.end, allDay: e.allDay, color: cal?.color ?? "#7A869A", editable: cal?.source === "zeff", event: e, calendar: cal };
        }),
      // An appointment a todo proposes can be dragged like one of Zeff's own: its action gets the new time.
      ...(showProposed ? proposed.map((p, i): Item => ({ id: `p${i}`, title: p.title, start: moved[`p${i}`]?.start ?? p.start, end: moved[`p${i}`]?.end ?? p.end, allDay: false, color: "#6366F1", editable: MOVABLE_PROPOSALS.has(p.type), proposed: p })) : []),
    ],
    [events, proposed, shown, showProposed, byId, moved],
  );

  const done = useCallback(
    (r: Result, undo?: () => unknown) => {
      toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error", action: r?.ok && undo ? { label: t("Undo"), run: undo } : undefined });
      router.refresh();
      return !!r?.ok;
    },
    [router, t],
  );

  const create = useCallback(
    (v: { start: string; end: string; allDay: boolean }) => {
      setPicked(null);
      setEditor({ calendarId: own[0]?.id ?? 0, title: "", start: v.start, end: v.end, allDay: v.allDay, location: "", description: "", recurrence: null });
    },
    [own],
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
      done(r, undoable && !ev.occurrence ? () => save({ ...it, start: s, end: e }, was, wasEnd, undefined, false) : undefined);
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

  const toggle = (c: CalendarView) => {
    const next = !shown[c.id];
    setShown({ ...shown, [c.id]: next });
    start(async () => {
      const r = await updateCalendarAction(c.id, { visible: next });
      if (!r?.ok) done(r);
    });
  };
  const busyDays = useMemo(() => new Set(days.filter((d) => items.some((it) => itemOn(it, d)))), [days, items]);

  const panels = (
    <>
      <MiniMonth focus={day} shown={view === "month" ? days.filter((d) => d.slice(0, 7) === day.slice(0, 7)) : days} today={today} busyDays={busyDays} onPick={(d) => go(view === "month" || view === "agenda" ? "day" : view, d)} />
      {(["zeff", "google", "outlook"] as const).map((src) => {
        const list = calendars.filter((c) => c.source === src);
        return list.length ? (
          <div key={src} className="space-y-1">
            <p className="text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:text-zinc-400">{src === "zeff" ? t("My calendars") : SOURCE_LABELS[src]}</p>
            {list.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <input type="checkbox" className="size-4 rounded" style={{ accentColor: c.color }} checked={!!shown[c.id]} onChange={() => toggle(c)} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {!c.busy && <span className="text-xs text-zinc-600 dark:text-zinc-400" title={t("Doesn't block time")}>
                    {t("free")}
                  </span>}
              </label>
            ))}
          </div>
        ) : null;
      })}
      <div className="space-y-1">
        <p className="text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:text-zinc-400">{t("Todos")}</p>
        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <input type="checkbox" className="size-4 rounded" style={{ accentColor: "#6366F1" }} checked={showProposed} onChange={() => setShowProposed(!showProposed)} />
          <span className="min-w-0 flex-1 truncate">{t("Proposed by todos")}</span>
          <span className="text-xs text-zinc-600 dark:text-zinc-400">{proposed.length}</span>
        </label>
      </div>
      <Link href="/kalender/einstellungen" className="block text-xs text-zinc-500 hover:underline">
        {t("Manage calendars …")}
      </Link>
      <details className="text-xs text-zinc-500">
        <summary className="cursor-pointer">{t("Keyboard shortcuts")}</summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {shortcuts(t).map(([k, what]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-zinc-300 px-1 font-mono text-xs dark:border-zinc-600">{k}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
  const sidebar = (
    <>
      <button type="button" onClick={newNow} className="btn btn-primary w-full justify-center" title={t("New event (N)")}>
        + {t("New event")}
      </button>
      {/* A phone: folded (the calendar first); wider: always there. */}
      <details className="space-y-3 lg:hidden">
        <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-300">{t("Calendars & date")}</summary>
        <div className="mt-3 space-y-4">{panels}</div>
      </details>
      <div className="space-y-4 max-lg:hidden">{panels}</div>
    </>
  );

  return (
    <SidebarFrame storageKey="zeff-calendar-sidebar" sidebar={sidebar} contentClassName="min-h-0">
      <div className="flex h-[calc(100dvh-7rem)] min-h-[32rem] min-w-0 flex-1 flex-col gap-2">
        {/* The toolbar: where you are, how you look at it. */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-sm" onClick={() => go(view, ymd(new Date()))} title={t("Today (T)")}>
            {t("Today")}
          </button>
          <div className="flex">
            <button type="button" className="icon-btn" onClick={() => go(view, stepDay(view, day, -1))} aria-label={t("Previous")} title={t("Previous (←)")}>
              ‹
            </button>
            <button type="button" className="icon-btn" onClick={() => go(view, stepDay(view, day, 1))} aria-label={t("Next")} title={t("Next (→)")}>
              ›
            </button>
          </div>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{viewTitle(view, day)}</h1>
          <span role="status" className="text-xs text-zinc-600 dark:text-zinc-400">
            {pending ? t("Saving…") : ""}
          </span>
          <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700" role="group" aria-label={t("View")}>
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={v === view}
                aria-keyshortcuts={v[0].toUpperCase()}
                onClick={() => go(v, day)}
                title={`${viewLabels(t)[v]} (${v[0].toUpperCase()})`}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${v === view ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
              >
                {viewLabels(t)[v]}
              </button>
            ))}
          </div>
          {canSync && (
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => start(async () => void done(await syncCalendarsAction()))} title={t("Read Google Calendar now")}>
              ⟳ {t("Sync")}
            </button>
          )}
        </div>

        <section className="card min-h-0 flex-1 overflow-hidden">
          {view === "month" ? (
            <MonthGrid days={days} month={day.slice(0, 7)} items={items} today={today} onCreate={create} onOpen={(item, rect) => setPicked({ item, rect })} onMove={move} onPickDay={(d) => go("day", d)} />
          ) : view === "agenda" ? (
            <AgendaList days={days} items={items} today={today} onOpen={(item, rect) => setPicked({ item, rect })} />
          ) : (
            <div className="h-full overflow-x-auto">
              <div className={`h-full ${view === "week" ? "min-w-[720px]" : ""}`}>
                <TimeGrid days={days} items={items} now={now} onCreate={create} onOpen={(item, rect) => setPicked({ item, rect })} onMove={move} onPickDay={(d) => go("day", d)} />
              </div>
            </div>
          )}
        </section>
      </div>

      {picked && <EventDetails key={picked.item.id} item={picked.item} anchor={picked.rect} onClose={() => setPicked(null)} onEdit={() => edit(picked.item)} onDone={(r, undo) => done(r, undo) && setPicked(null)} />}
      {editor && <EventEditor init={editor} calendars={own} onClose={() => setEditor(null)} onDone={(r, undo) => done(r, undo) && setEditor(null)} />}
      {moving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
          <div role="dialog" aria-modal="true" className="card w-full max-w-sm p-4 shadow-2xl">
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
          </div>
        </div>
      )}
    </SidebarFrame>
  );
}
