"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { SidebarFrame } from "@/components/SidebarFrame";
import { SOURCE_LABELS, type CalendarEventView, type CalendarView, type ProposedEvent } from "@/lib/calendar/ir-shared";
import type { T } from "@/lib/i18n/shared";
import { useCalendarBody } from "./CalendarBody";
import { MiniMonth } from "./MiniMonth";
import { syncCalendarsAction, updateCalendarAction } from "./server-actions";
import { itemOn, stepDay, viewLabels, viewRange, VIEWS, viewTitle, ymd, type ViewKind } from "./view-shared";

const shortcuts = (t: T): [string, string][] => [
  ["T", t("Today")],
  ["← / →", t("Previous / next")],
  ["D W M A", t("Day, week, month, agenda")],
  ["N", t("New event")],
  ["Alt + ↑ ↓ ← →", t("Move the focused event by 15 minutes / a day")],
  ["Shift + Alt + ↑ ↓", t("Change the focused event's end")],
  ["Esc", t("Close")],
];

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
  onNavigate,
  onChanged,
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
  /** In the Workspace the app is its database's view: moving to another view/day is the host's (else the address changes), and so is reading again after a change. */
  onNavigate?: (view: ViewKind, day: string) => void;
  onChanged?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [shown, setShown] = useState<Record<number, boolean>>(() => Object.fromEntries(calendars.map((c) => [c.id, c.visible])));
  const [showProposed, setShowProposed] = useState(true);

  const go = useCallback((v: ViewKind, d: string) => (onNavigate ? onNavigate(v, d) : router.push(`/kalender?v=${v}&d=${d}`)), [router, onNavigate]);
  const isShown = useCallback((c: CalendarView) => !!shown[c.id], [shown]);
  const { items, days, today, pending, start, done, newNow, grid, overlays } = useCalendarBody({ view, day, calendars, events, proposed, now: serverNow, shown: isShown, showProposed, go, onChanged });

  // A narrow screen opens on the day view.
  useEffect(() => {
    if (!explicitView && window.innerWidth < 640 && view !== "day") {
      if (onNavigate) onNavigate("day", day);
      else router.replace(`/kalender?v=day&d=${day}`);
    }
  }, [explicitView, view, day, router, onNavigate]);

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
      <Link href="/settings/calendar" className="block text-xs text-zinc-500 hover:underline">
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
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => start(async () => void done(await syncCalendarsAction(viewRange(view, day))))} title={t("Read Google Calendar now — the days shown too")}>
              ⟳ {t("Sync")}
            </button>
          )}
        </div>

        <section className="card min-h-0 flex-1 overflow-hidden">{grid}</section>
      </div>
      {overlays}
    </SidebarFrame>
  );
}
