"use client";

import { useEffect, useRef, useState } from "react";
import { useLang, useT } from "@/components/I18nProvider";
import { addDays, weekdayOf } from "@/lib/calendar/recurrence";
import { textOn } from "@/lib/contrast";
import { LANGUAGES } from "@/lib/i18n/shared";
import { nudged, nudgeOf } from "./nudge";
import { durationText, isProposal, isoWeek, itemLabel, itemOn, lanes, local, mergeDone, minutesBetween, minutesOf, plus, snap, stampAt, timeText, type Item } from "./view-shared";

const HOUR = 48;
const STEP = 15;
const WORK = { from: 8 * 60, to: 18 * 60 };

type Drag =
  | { kind: "create"; day: string; a: number; b: number; moved: boolean }
  | { kind: "move"; item: Item; grab: number; day: string; at: number; minutes: number; x0: number; y0: number; moved: boolean }
  | { kind: "resize"; item: Item; day: string; end: number }
  | { kind: "allday"; item: Item; from: string; day: string; x0: number; y0: number; moved: boolean };

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const dayAt = (x: number, y: number) => (document.elementsFromPoint(x, y).find((el) => (el as HTMLElement).dataset?.day) as HTMLElement | undefined)?.dataset.day ?? null;

/**
 * Days with their hours (the day and week views): all-day appointments on top, the timed ones in
 * their hours, side by side where they overlap; working hours light, the rest shaded; now as a
 * line. Drag on free time to enter an appointment from–to; drag one of Zeff's own to move it (to
 * another day too), its lower edge to change its length; drag an all-day one to another day.
 * Google's and Outlook's open on a click (read-only here).
 */
export function TimeGrid({
  days,
  items,
  now,
  onCreate,
  onOpen,
  onMove,
  onPickDay,
}: {
  days: string[];
  items: Item[];
  now: string;
  onCreate: (v: { start: string; end: string; allDay: boolean }) => void;
  onOpen: (item: Item, rect: DOMRect) => void;
  onMove: (item: Item, start: string, end: string) => void;
  onPickDay: (day: string) => void;
}) {
  const t = useT();
  const locale = LANGUAGES[useLang()].locale;
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const today = now.slice(0, 10);
  const [status, setStatus] = useState("");
  const dayName = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) => local(d).toLocaleDateString(locale, opts);
  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // Scrolled to the working day (or to now, when today is shown) when the days change.
  const key = days.join();
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const at = days.includes(now.slice(0, 10)) ? Math.max(0, minutesOf(now) - 90) : 7 * 60;
    el.scrollTop = (at / 60) * HOUR;
    // Not laid out yet (a hidden tab): once it has a height.
    if (el.clientHeight) return;
    const ro = new ResizeObserver(() => {
      if (!el.clientHeight) return;
      el.scrollTop = (at / 60) * HOUR;
      ro.disconnect();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when other days are shown
  }, [key]);

  /** The minute under the pointer in a day's column. */
  const minuteAt = (clientY: number) => {
    const el = scroller.current;
    if (!el) return 0;
    const top = el.getBoundingClientRect().top - el.scrollTop;
    return Math.max(0, Math.min(24 * 60, ((clientY - top) / HOUR) * 60));
  };

  const autoScroll = (clientY: number) => {
    const el = scroller.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (clientY < r.top + 36) el.scrollTop -= 14;
    else if (clientY > r.bottom - 36) el.scrollTop += 14;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "create") {
      autoScroll(e.clientY);
      const b = Math.max(0, Math.min(24 * 60, snap(minuteAt(e.clientY), STEP)));
      if (b !== d.b) update({ ...d, b, moved: true });
    } else if (d.kind === "move") {
      autoScroll(e.clientY);
      const moved = d.moved || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 4;
      const day = dayAt(e.clientX, e.clientY) ?? d.day;
      const at = Math.max(0, Math.min(24 * 60 - STEP, snap(minuteAt(e.clientY) - d.grab, STEP)));
      if (moved !== d.moved || day !== d.day || at !== d.at) update({ ...d, moved, day: days.includes(day) ? day : d.day, at });
    } else if (d.kind === "resize") {
      autoScroll(e.clientY);
      const start = minutesOf(d.item.start);
      const end = Math.max(start + STEP, Math.min(24 * 60, snap(minuteAt(e.clientY), STEP)));
      if (end !== d.end) update({ ...d, end });
    } else {
      const moved = d.moved || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 4;
      const day = dayAt(e.clientX, e.clientY) ?? d.day;
      if (moved !== d.moved || day !== d.day) update({ ...d, moved, day: days.includes(day) ? day : d.day });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    update(null);
    if (!d) return;
    if (d.kind === "create") {
      const a = Math.min(d.a, d.b);
      const b = Math.max(d.a, d.b);
      // A click: an hour from there; a drag: what was dragged.
      if (!d.moved || b - a < STEP) onCreate({ start: stampAt(d.day, Math.min(a, 23 * 60)), end: stampAt(d.day, Math.min(a, 23 * 60) + 60), allDay: false });
      else onCreate({ start: stampAt(d.day, a), end: b >= 24 * 60 ? stampAt(addDays(d.day, 1), 0) : stampAt(d.day, b), allDay: false });
    } else if (d.kind === "move") {
      // Google's, Outlook's, a proposal: only opened.
      if (!d.moved || !d.item.editable) return d.moved ? undefined : onOpen(d.item, (e.target as HTMLElement).closest("[data-item]")?.getBoundingClientRect() ?? new DOMRect(e.clientX, e.clientY, 0, 0));
      const start = stampAt(d.day, d.at);
      if (start !== d.item.start) onMove(d.item, start, plus(start, d.minutes));
    } else if (d.kind === "resize") {
      const end = stampAt(d.day, d.end) === `${d.day}T24:00` ? stampAt(addDays(d.day, 1), 0) : stampAt(d.day, d.end);
      if (end !== d.item.end) onMove(d.item, d.item.start, end);
    } else {
      if (!d.moved || !d.item.editable) return d.moved ? undefined : onOpen(d.item, (e.target as HTMLElement).closest("[data-item]")?.getBoundingClientRect() ?? new DOMRect(e.clientX, e.clientY, 0, 0));
      const shift = Math.round(minutesBetween(d.from, d.day) / 1440);
      if (shift) onMove(d.item, addDays(d.item.start, shift), addDays(d.item.end, shift));
    }
  };

  const startCreate = (e: React.PointerEvent, day: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-item]")) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const a = Math.floor(minuteAt(e.clientY) / STEP) * STEP;
    update({ kind: "create", day, a, b: a + STEP, moved: false });
  };

  const startMove = (e: React.PointerEvent, it: Item, day: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget.closest("[data-grid]") as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    if (!it.editable) return update({ kind: "move", item: it, grab: 0, day, at: minutesOf(it.start), minutes: 0, x0: e.clientX, y0: e.clientY, moved: false });
    const start = it.start.slice(0, 10) < day ? 0 : minutesOf(it.start);
    update({ kind: "move", item: it, grab: minuteAt(e.clientY) - start, day: it.start.slice(0, 10), at: minutesOf(it.start), minutes: minutesBetween(it.start, it.end), x0: e.clientX, y0: e.clientY, moved: false });
  };

  const startResize = (e: React.PointerEvent, it: Item, day: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget.closest("[data-grid]") as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    update({ kind: "resize", item: it, day, end: minutesOf(it.end) || 24 * 60 });
  };

  const startAllDay = (e: React.PointerEvent, it: Item, day: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget.closest("[data-grid]") as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    update({ kind: "allday", item: it, from: day, day, x0: e.clientX, y0: e.clientY, moved: false });
  };

  /** A key on a focused appointment: Enter/Space opens it; Alt+arrows move it (Shift+Alt+↑/↓: its end), announced. */
  const onItemKey = (e: React.KeyboardEvent, it: Item, native: boolean) => {
    if (e.altKey) {
      const n = nudgeOf(e.key, e.shiftKey);
      if (!n) return;
      e.preventDefault();
      e.stopPropagation();
      if (!it.editable) return;
      const r = nudged(it.start, it.end, it.allDay, n);
      if (!r) return;
      onMove(it, r.start, r.end);
      if (it.event?.occurrence) return;
      setStatus(
        n.resize
          ? t("Now ends at {time}", { time: timeText(r.end) })
          : t("Moved to {when}", { when: it.allDay ? dayName(r.start, { weekday: "short", day: "numeric", month: "short" }) : `${dayName(r.start, { weekday: "short" })} ${timeText(r.start)}` }),
      );
      return;
    }
    // A real button opens on Enter/Space by itself (a click without a pointer); the block is a div.
    if (!native && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onOpen(it, e.currentTarget.getBoundingClientRect());
    }
  };
  /** A click without a pointer (a screen reader's, a switch): the drag logic never saw it. */
  const onItemClick = (e: React.MouseEvent, it: Item) => e.detail === 0 && onOpen(it, e.currentTarget.getBoundingClientRect());

  // What's shown: a moved or resized one where it's being dragged to.
  const live = (it: Item): Item => {
    if (!drag) return it;
    if (drag.kind === "move" && drag.moved && drag.item.id === it.id && it.editable) {
      const start = stampAt(drag.day, drag.at);
      return { ...it, start, end: plus(start, drag.minutes) };
    }
    if (drag.kind === "resize" && drag.item.id === it.id) return { ...it, end: drag.end >= 24 * 60 ? stampAt(addDays(drag.day, 1), 0) : stampAt(drag.day, drag.end) };
    if (drag.kind === "allday" && drag.moved && drag.item.id === it.id && it.editable) {
      const shift = Math.round(minutesBetween(drag.from, drag.day) / 1440);
      return { ...it, start: addDays(it.start, shift), end: addDays(it.end, shift) };
    }
    return it;
  };
  const shown = items.map(live);
  const allDay = shown.filter((it) => it.allDay);
  const dragging = drag && ((drag.kind === "move" && drag.moved) || drag.kind === "resize" || (drag.kind === "allday" && drag.moved)) ? drag.item.id : null;
  const cols = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;
  const nowMin = minutesOf(now);

  return (
    <div className={`flex h-full min-h-0 flex-col ${drag ? "select-none" : ""}`} data-grid onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => update(null)}>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {/* The days, and their all-day appointments. */}
      <div className="grid border-b border-zinc-200 dark:border-zinc-800" style={{ gridTemplateColumns: cols }}>
        <div className="flex items-end justify-center pb-1 text-xs text-zinc-600 dark:text-zinc-400" title={t("Calendar week")}>
          {t("W{n}", { n: isoWeek(days[0]) })}
        </div>
        {days.map((d) => {
          const isToday = d === today;
          const weekend = weekdayOf(local(d)) >= 5;
          return (
            <div key={d} role="group" aria-label={dayName(d)} className="relative min-w-0 border-l border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => onCreate({ start: `${d}T09:00`, end: `${d}T10:00`, allDay: false })}
                className="absolute top-1 right-1 z-10 flex size-6 items-center justify-center rounded text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                aria-label={t("New event on {day}", { day: dayName(d) })}
                title={t("New event on {day}", { day: dayName(d) })}
              >
                +
              </button>
              <button type="button" onClick={() => onPickDay(d)} className="flex w-full flex-col items-center py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60" title={t("Show this day")}>
                <span className={`text-xs font-medium uppercase ${isToday ? "text-indigo-600 dark:text-indigo-400" : weekend ? "text-zinc-500" : "text-zinc-600 dark:text-zinc-400"}`}>{local(d).toLocaleDateString(locale, { weekday: "short" })}</span>
                <span className={`flex size-8 items-center justify-center rounded-full text-lg leading-none tabular-nums ${isToday ? "bg-indigo-600 font-semibold text-white" : ""}`}>{Number(d.slice(8))}</span>
              </button>
              <div
                data-day={d}
                role="group"
                aria-label={t("All-day events, {day}", { day: dayName(d) })}
                className="min-h-6 cursor-copy space-y-0.5 px-0.5 pb-1"
                onClick={(e) => e.target === e.currentTarget && onCreate({ start: d, end: addDays(d, 1), allDay: true })}
                title={t("Click: an all-day event")}
              >
                {allDay
                  .filter((it) => itemOn(it, d))
                  .map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      data-item
                      onPointerDown={(e) => startAllDay(e, it, d)}
                      onClick={(e) => onItemClick(e, it)}
                      onKeyDown={(e) => onItemKey(e, it, true)}
                      aria-label={itemLabel(it, t)}
                      className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-xs font-medium ${isProposal(it) ? "border-2 border-dashed" : ""} ${it.editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${dragging === it.id ? "opacity-70 shadow-lg ring-2 ring-white/70" : ""}`}
                      style={isProposal(it) ? { borderColor: it.color } : { background: it.color, color: textOn(it.color) }}
                      title={isProposal(it) ? t("Proposed: {title}", { title: it.title }) : it.title}
                    >
                      {it.start < d ? "↳ " : ""}
                      {isProposal(it) ? t("Proposed: {title}", { title: it.title }) : it.title}
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* The hours. */}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-xs text-zinc-600 tabular-nums dark:text-zinc-400" style={{ top: h * HOUR }}>
                {h ? `${String(h).padStart(2, "0")}:00` : ""}
              </div>
            ))}
            {days.includes(today) && (
              <div className="absolute right-1 z-20 -translate-y-1/2 rounded bg-red-700 px-1 text-xs font-semibold text-white tabular-nums" style={{ top: (nowMin / 60) * HOUR }}>
                {timeText(now)}
              </div>
            )}
          </div>
          {days.map((d) => {
            const weekend = weekdayOf(local(d)) >= 5;
            const timed = shown.filter((it) => !it.allDay && itemOn(it, d) && !(it.end.slice(0, 10) === d && it.end.slice(11) === "00:00" && it.start.slice(0, 10) < d));
            const ghost = drag?.kind === "create" && drag.day === d ? { a: Math.min(drag.a, drag.b), b: Math.max(drag.a, drag.b, Math.min(drag.a, drag.b) + STEP) } : null;
            return (
              <div
                key={d}
                data-day={d}
                role="group"
                aria-label={t("{day}, events", { day: dayName(d) })}
                className={`relative cursor-cell border-l border-zinc-100 dark:border-zinc-800 ${weekend ? "bg-zinc-50/80 dark:bg-zinc-900/60" : ""}`}
                style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR - 1}px, rgb(161 161 170 / 0.22) ${HOUR - 1}px, rgb(161 161 170 / 0.22) ${HOUR}px)` }}
                onPointerDown={(e) => startCreate(e, d)}
              >
                {/* Outside working hours: shaded. */}
                {!weekend && (
                  <>
                    <div className="pointer-events-none absolute inset-x-0 top-0 bg-zinc-50/80 dark:bg-zinc-900/60" style={{ height: (WORK.from / 60) * HOUR }} />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-zinc-50/80 dark:bg-zinc-900/60" style={{ top: (WORK.to / 60) * HOUR }} />
                  </>
                )}
                {/* Half hours, faint. */}
                <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR / 2 - 1}px, rgb(161 161 170 / 0.08) ${HOUR / 2 - 1}px, rgb(161 161 170 / 0.08) ${HOUR / 2}px)` }} />
                {d === today && (
                  <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500" style={{ top: (nowMin / 60) * HOUR }}>
                    <span className="absolute -top-[5px] -left-[5px] size-2.5 rounded-full bg-red-500" />
                  </div>
                )}
                {lanes(mergeDone(timed)).map((it) => {
                  const from = it.start.slice(0, 10) < d ? 0 : minutesOf(it.start);
                  const to = it.end.slice(0, 10) > d ? 24 * 60 : Math.max(from + STEP, minutesOf(it.end));
                  const h = ((to - from) / 60) * HOUR;
                  const faint = it.event?.showAs === "free" || it.event?.response === "declined";
                  const past = it.end < now;
                  const isDragged = dragging === it.id;
                  return (
                    <div
                      key={it.id}
                      data-item
                      role="button"
                      tabIndex={0}
                      onPointerDown={(e) => startMove(e, it, d)}
                      onClick={(e) => onItemClick(e, it)}
                      onKeyDown={(e) => onItemKey(e, it, false)}
                      aria-label={itemLabel(it, t)}
                      className={`group absolute overflow-hidden rounded-md px-1.5 py-0.5 text-left text-xs leading-tight transition-shadow ${isProposal(it) ? "border-2 border-dashed" : "border-l-[3px]"} ${it.editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${isDragged ? "z-30 shadow-xl ring-2 ring-indigo-400/60" : "hover:z-10 hover:shadow-md"} ${faint ? "opacity-50" : past && !isDragged ? "opacity-75" : ""}`}
                      style={{
                        top: (from / 60) * HOUR + 1,
                        height: Math.max(18, h - 2),
                        left: `calc(${(it.lane / it.of) * 100}% + 2px)`,
                        width: `calc(${100 / it.of}% - ${it.of > 1 ? 3 : 6}px)`,
                        borderColor: it.color,
                        // A tint of its calendar's colour — light and dark alike.
                        background: `${it.color}${faint ? "14" : "2E"}`,
                        ...(faint ? { backgroundImage: `repeating-linear-gradient(45deg, transparent 0 6px, ${it.color}22 6px 12px)` } : {}),
                        // Done too (a Done item merged into this meeting): its green stripes over the blue.
                        ...(it.merged ? { backgroundImage: `repeating-linear-gradient(45deg, transparent 0 6px, ${it.merged.color}55 6px 12px)` } : {}),
                      }}
                      title={`${timeText(it.start)}–${timeText(it.end)} ${it.title}${it.merged ? ` ✓ ${it.merged.title}` : ""}`}
                    >
                      <div className="dark:text-zinc-100">
                        {h < 34 ? (
                          <span className="block truncate font-semibold">
                            {it.title}
                            <span className="font-normal text-zinc-600 dark:text-zinc-400">, {timeText(it.start)}</span>
                          </span>
                        ) : (
                          <>
                            <span className="block truncate font-semibold">
                              {it.event?.recurrence ? "↻ " : ""}
                              {isProposal(it) ? t("Proposed: {title}", { title: it.title }) : it.title}
                            </span>
                            <span className="block truncate text-zinc-600 dark:text-zinc-400">
                              {timeText(it.start)} – {timeText(it.end)}
                              {isDragged ? ` · ${durationText(minutesBetween(it.start, it.end), t)}` : it.event?.location ? ` · ${it.event.location}` : ""}
                            </span>
                          </>
                        )}
                      </div>
                      {it.editable && it.end.slice(0, 10) === d && (
                        <div
                          onPointerDown={(e) => startResize(e, it, d)}
                          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100"
                          aria-hidden
                        >
                          <div className="mx-auto mt-0.5 h-0.5 w-6 rounded bg-zinc-400" />
                        </div>
                      )}
                    </div>
                  );
                })}
                {ghost && (
                  <div className="pointer-events-none absolute inset-x-1 z-30 rounded-md border-2 border-indigo-500 bg-indigo-500/15 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300" style={{ top: (ghost.a / 60) * HOUR, height: ((ghost.b - ghost.a) / 60) * HOUR }}>
                    {hhmm(ghost.a)} – {hhmm(Math.min(24 * 60, ghost.b))}
                    <span className="block font-normal opacity-80">{durationText(ghost.b - ghost.a, t)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
