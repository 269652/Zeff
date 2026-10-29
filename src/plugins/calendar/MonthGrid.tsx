"use client";

import { useRef, useState } from "react";
import { useLang, useT } from "@/components/I18nProvider";
import { addDays } from "@/lib/calendar/recurrence";
import { LANGUAGES } from "@/lib/i18n/shared";
import { textOn } from "@/lib/contrast";
import { nudged, nudgeOf } from "./nudge";
import { isoWeek, itemLabel, itemOn, local, mergeDone, minutesBetween, timeText, weekdayHeads, type Item } from "./view-shared";

const MAX = 3;

type Drag = { item: Item; from: string; day: string; x0: number; y0: number; moved: boolean };
const dayAt = (x: number, y: number) => (document.elementsFromPoint(x, y).find((el) => (el as HTMLElement).dataset?.day) as HTMLElement | undefined)?.dataset.day ?? null;

/**
 * A month (six weeks): each day its first appointments (all-day ones first) and how many more;
 * a click on a day's free space enters one there, on "+n more" opens the day. Zeff's own
 * appointments drag to another day (their time kept).
 */
export function MonthGrid({
  days,
  month,
  items,
  today,
  onCreate,
  onOpen,
  onMove,
  onPickDay,
}: {
  days: string[];
  month: string;
  items: Item[];
  today: string;
  onCreate: (v: { start: string; end: string; allDay: boolean }) => void;
  onOpen: (item: Item, rect: DOMRect) => void;
  onMove: (item: Item, start: string, end: string) => void;
  onPickDay: (day: string) => void;
}) {
  const t = useT();
  const locale = LANGUAGES[useLang()].locale;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [status, setStatus] = useState("");
  const ref = useRef<Drag | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const update = (d: Drag | null) => {
    ref.current = d;
    setDrag(d);
  };
  const shift = drag?.moved ? Math.round(minutesBetween(drag.from, drag.day) / 1440) : 0;
  const shown = items.map((it) => (drag?.moved && drag.item.id === it.id && it.editable ? { ...it, start: addDays(it.start.slice(0, 10), shift) + it.start.slice(10), end: addDays(it.end.slice(0, 10), shift) + it.end.slice(10) } : it));
  const weeks = Array.from({ length: days.length / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7));

  /** Alt+arrows on a focused appointment: a day (←/→) or a week (↑/↓) on, kept time — the keyboard way to drag it. */
  const onItemKey = (e: React.KeyboardEvent, it: Item) => {
    if (!e.altKey) return;
    const n = e.key === "ArrowUp" || e.key === "ArrowDown" ? { dDays: e.key === "ArrowUp" ? -7 : 7 } : nudgeOf(e.key, false);
    if (!n?.dDays) return;
    e.preventDefault();
    e.stopPropagation();
    const r = it.editable ? nudged(it.start, it.end, it.allDay, n) : null;
    if (!r) return;
    onMove(it, r.start, r.end);
    if (!it.event?.occurrence) setStatus(t("Moved to {when}", { when: local(r.start.slice(0, 10)).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }) }));
  };

  return (
    <div
      ref={root}
      className={`flex h-full min-h-0 flex-col ${drag ? "select-none" : ""}`}
      onPointerMove={(e) => {
        const d = ref.current;
        if (!d) return;
        const moved = d.moved || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 4;
        const day = dayAt(e.clientX, e.clientY) ?? d.day;
        if (moved !== d.moved || day !== d.day) update({ ...d, moved, day });
      }}
      onPointerUp={(e) => {
        const d = ref.current;
        update(null);
        if (!d) return;
        if (!d.moved || !d.item.editable) {
          if (!d.moved) onOpen(d.item, (e.target as HTMLElement).closest("[data-item]")?.getBoundingClientRect() ?? new DOMRect(e.clientX, e.clientY, 0, 0));
          return;
        }
        const n = Math.round(minutesBetween(d.from, d.day) / 1440);
        if (n) onMove(d.item, addDays(d.item.start.slice(0, 10), n) + d.item.start.slice(10), addDays(d.item.end.slice(0, 10), n) + d.item.end.slice(10));
      }}
      onPointerCancel={() => update(null)}
    >
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <div className="grid grid-cols-[2rem_repeat(7,minmax(0,1fr))] border-b border-zinc-200 text-center text-xs font-medium text-zinc-600 uppercase dark:text-zinc-400 dark:border-zinc-800">
        <div />
        {weekdayHeads("short", locale).map((h, i) => (
          <div key={i} className="py-1.5">
            {h}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(5.5rem, 1fr))` }}>
        {weeks.map((w) => (
          <div key={w[0]} className="grid grid-cols-[2rem_repeat(7,minmax(0,1fr))] border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
            <button type="button" onClick={() => onPickDay(w[0])} className="pt-1.5 text-xs text-zinc-600 hover:text-indigo-600 dark:text-zinc-400" title={t("Show this week")}>
              {isoWeek(w[0])}
            </button>
            {w.map((d) => {
              const list = mergeDone(shown.filter((it) => itemOn(it, d))).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
              const other = d.slice(0, 7) !== month;
              const isToday = d === today;
              const target = drag?.moved && drag.day === d;
              return (
                <div
                  key={d}
                  role="group"
                  aria-label={local(d).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
                  data-day={d}
                  onClick={(e) => (e.target === e.currentTarget || (e.target as HTMLElement).dataset.free) && onCreate({ start: `${d}T09:00`, end: `${d}T10:00`, allDay: false })}
                  className={`flex min-w-0 cursor-cell flex-col gap-0.5 overflow-hidden border-l border-zinc-100 p-1 dark:border-zinc-800 ${other ? "bg-zinc-50/70 dark:bg-zinc-900/50" : ""} ${target ? "bg-indigo-50 ring-2 ring-indigo-400 ring-inset dark:bg-indigo-950/40" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => onPickDay(d)}
                    className={`self-start rounded-full px-1.5 text-xs tabular-nums ${isToday ? "bg-indigo-600 font-semibold text-white" : other ? "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                    aria-label={local(d).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
                  >
                    {Number(d.slice(8)) === 1 ? local(d).toLocaleDateString(locale, { day: "numeric", month: "short" }) : Number(d.slice(8))}
                  </button>
                  {list.slice(0, MAX).map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      data-item
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        root.current?.setPointerCapture?.(e.pointerId);
                        update({ item: it, from: d, day: d, x0: e.clientX, y0: e.clientY, moved: false });
                      }}
                      onClick={(e) => e.detail === 0 && onOpen(it, e.currentTarget.getBoundingClientRect())}
                      onKeyDown={(e) => onItemKey(e, it)}
                      aria-label={itemLabel(it, t)}
                      className={`flex w-full min-w-0 items-center gap-1 truncate rounded px-1 text-left text-xs leading-5 ${it.allDay ? "font-medium" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"} ${it.editable ? "cursor-grab" : "cursor-pointer"} ${drag?.moved && drag.item.id === it.id ? "opacity-60" : ""} ${it.proposed || it.shadow ? "border border-dashed" : ""}`}
                      style={it.allDay && !it.shadow ? { background: it.color, color: textOn(it.color) } : it.proposed || it.shadow ? { borderColor: it.color } : undefined}
                      title={`${it.allDay ? "" : `${timeText(it.start)} `}${it.title}${it.merged ? ` ✓ ${it.merged.title}` : ""}`}
                    >
                      {!it.allDay && <span className="size-1.5 shrink-0 rounded-full" style={{ background: it.color }} />}
                      {!it.allDay && <span className="shrink-0 text-zinc-600 tabular-nums dark:text-zinc-400">{it.start.slice(0, 10) === d ? timeText(it.start) : "…"}</span>}
                      <span className="min-w-0 truncate">{it.title}</span>
                      {it.merged && <span className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden>✓</span>}
                    </button>
                  ))}
                  {list.length > MAX && (
                    <button type="button" onClick={() => onPickDay(d)} className="self-start rounded px-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      {t("+{n} more", { n: list.length - MAX })}
                    </button>
                  )}
                  <div data-free="1" className="min-h-2 flex-1" />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
