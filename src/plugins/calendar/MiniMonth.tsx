"use client";

import { useState } from "react";
import { useLang, useT } from "@/components/I18nProvider";
import { addDays } from "@/lib/calendar/recurrence";
import { LANGUAGES } from "@/lib/i18n/shared";
import { isoWeek, local, mondayOf, weekdayHeads, ymd } from "./view-shared";

/**
 * A month to pick a day from (the sidebar's): the days shown now marked, today ringed, days with
 * appointments dotted; its own ‹ › to look at other months without moving the view.
 */
export function MiniMonth({ focus, shown, today, busyDays, onPick }: { focus: string; shown: string[]; today: string; busyDays: Set<string>; onPick: (day: string) => void }) {
  const t = useT();
  const locale = LANGUAGES[useLang()].locale;
  const [month, setMonth] = useState(focus.slice(0, 7));
  const [lastFocus, setLastFocus] = useState(focus);
  // The view moved to another month: this follows.
  if (focus !== lastFocus) {
    setLastFocus(focus);
    setMonth(focus.slice(0, 7));
  }
  const first = mondayOf(`${month}-01`);
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
  const step = (n: number) => {
    const d = local(`${month}-01`);
    d.setMonth(d.getMonth() + n);
    setMonth(ymd(d).slice(0, 7));
  };
  const inView = new Set(shown);
  return (
    <div className="select-none">
      <div className="mb-1 flex items-center gap-1">
        <span className="flex-1 text-sm font-semibold">{local(`${month}-01`).toLocaleDateString(locale, { month: "long", year: "numeric" })}</span>
        <button type="button" className="icon-btn size-7" onClick={() => step(-1)} aria-label={t("Previous month")}>
          ‹
        </button>
        <button type="button" className="icon-btn size-7" onClick={() => step(1)} aria-label={t("Next month")}>
          ›
        </button>
      </div>
      <table className="w-full table-fixed text-center text-xs">
        <thead>
          <tr className="text-xs text-zinc-600 dark:text-zinc-400">
            <th scope="col" className="w-6 font-normal" aria-label={t("Week")} />
            {weekdayHeads("narrow", locale).map((h, i) => (
              <th scope="col" key={i} className="pb-1 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w[0]}>
              <td className="text-xs text-zinc-600 dark:text-zinc-400">{isoWeek(w[0])}</td>
              {w.map((day) => {
                const other = day.slice(0, 7) !== month;
                const isToday = day === today;
                return (
                  <td key={day} className="p-0">
                    <button
                      type="button"
                      onClick={() => onPick(day)}
                      aria-label={local(day).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
                      aria-current={isToday ? "date" : undefined}
                      className={`relative mx-auto flex size-7 items-center justify-center rounded-full tabular-nums transition ${
                        isToday ? "bg-indigo-600 font-semibold text-white" : inView.has(day) ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/50 dark:text-indigo-100" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      } ${other && !isToday ? "text-zinc-500 dark:text-zinc-400" : ""}`}
                    >
                      {Number(day.slice(8))}
                      {busyDays.has(day) && !isToday && <span className="absolute bottom-0.5 size-1 rounded-full bg-indigo-400" />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
