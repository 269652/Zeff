"use client";

import { useLang, useT } from "@/components/I18nProvider";
import { LANGUAGES } from "@/lib/i18n/shared";
import { itemOn, local, timeText, type Item } from "./view-shared";

/** The next days as a list: each day with appointments, its appointments in order — a click opens one. */
export function AgendaList({ days, items, today, onOpen }: { days: string[]; items: Item[]; today: string; onOpen: (item: Item, rect: DOMRect) => void }) {
  const t = useT();
  const locale = LANGUAGES[useLang()].locale;
  const groups = days
    .map((d) => ({ d, list: items.filter((it) => itemOn(it, d)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start)) }))
    .filter((g) => g.list.length);
  if (!groups.length) return <p className="p-8 text-center text-sm text-zinc-500">{t("No events in these {n} days.", { n: days.length })}</p>;
  return (
    <div className="h-full overflow-y-auto [scrollbar-width:thin]">
      {groups.map(({ d, list }) => (
        <section key={d} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
          <div className="pt-0.5">
            <p className={`text-sm font-semibold ${d === today ? "text-indigo-600 dark:text-indigo-400" : ""}`}>{d === today ? t("Today") : local(d).toLocaleDateString(locale, { weekday: "long" })}</p>
            <p className="text-xs text-zinc-500">{local(d).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}</p>
          </div>
          <ul className="space-y-0.5">
            {list.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={(e) => onOpen(it, e.currentTarget.getBoundingClientRect())}
                  className={`flex w-full items-baseline gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${it.event?.response === "declined" ? "opacity-50" : ""}`}
                >
                  <span className="w-24 shrink-0 text-xs text-zinc-500 tabular-nums">{it.allDay ? t("All day") : `${it.start.slice(0, 10) < d ? "…" : timeText(it.start)} – ${it.end.slice(0, 10) > d ? "…" : timeText(it.end)}`}</span>
                  <span className={`size-2.5 shrink-0 translate-y-[1px] rounded-full ${it.proposed ? "border-2 border-dashed bg-transparent" : ""}`} style={it.proposed ? { borderColor: it.color } : { background: it.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">
                      {it.event?.recurrence ? "↻ " : ""}
                      {it.proposed ? t("Proposed: {title}", { title: it.title }) : it.title}
                    </span>
                    {it.event?.location && <span className="text-zinc-500"> · {it.event.location}</span>}
                    {it.calendar && <span className="block text-xs text-zinc-400">{it.calendar.name}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
