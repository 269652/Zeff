"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";

/** How many people show as chips in the bar — the rest are in its "+N" menu. */
const PEOPLE_SHOWN = 6;

/**
 * Whose rows: "Mine", then a chip per person with their count (and nobody), several at once — as Kanban's person chips. One
 * quiet line: those with the most rows (and the ones picked), long names cut short; everyone else in a "+N" menu with a search.
 */
export function PeopleBar({ chips, picked, onPick, onAll, mine, onMine }: { chips: { key: string; label: string; count: number }[]; picked: Set<string>; onPick: (key: string) => void; onAll: () => void; mine: boolean; onMine?: () => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  if (chips.length < 2 && !onMine) return null;
  const name = (c: { key: string; label: string }) => (c.key ? c.label : `— ${t("Nobody")}`);
  const byCount = [...chips].sort((a, b) => b.count - a.count || name(a).localeCompare(name(b)));
  const top = new Set(byCount.slice(0, PEOPLE_SHOWN).map((c) => c.key));
  const shown = byCount.filter((c) => top.has(c.key) || picked.has(c.key));
  const rest = byCount.filter((c) => !shown.includes(c));
  const chip = (on: boolean) => `inline-flex max-w-44 shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs transition ${on ? "bg-indigo-600 text-white dark:bg-indigo-500" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"}`;
  const w = q.trim().toLowerCase();
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden" role="group" aria-label={t("Filter by person")}>
      {onMine && (
        <button type="button" className={chip(mine)} aria-pressed={mine} onClick={onMine}>
          ★ {t("Mine")}
        </button>
      )}
      {shown.map((c) => {
        const on = picked.has(c.key);
        return (
          <button key={c.key || "none"} type="button" className={chip(on)} aria-pressed={on} onClick={() => onPick(c.key)} title={`${name(c)} · ${c.count}`}>
            <span className="truncate">{name(c)}</span>
            <span className={`tabular-nums ${on ? "text-indigo-100" : "text-zinc-400"}`}>{c.count}</span>
          </button>
        );
      })}
      {rest.length > 0 && (
        <details className="relative shrink-0">
          <summary className={`${chip(false)} cursor-pointer list-none`}>+{rest.length}</summary>
          <div className="absolute left-0 z-30 mt-1 w-64 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <input className="input mb-1 h-7 w-full text-xs" aria-label={t("Search people")} placeholder={t("Search people …")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <ul className="max-h-64 overflow-y-auto">
              {rest
                .filter((c) => !w || name(c).toLowerCase().includes(w))
                .map((c) => (
                  <li key={c.key || "none"}>
                    <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => onPick(c.key)}>
                      <span className="min-w-0 flex-1 truncate">{name(c)}</span>
                      <span className="text-zinc-400 tabular-nums">{c.count}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        </details>
      )}
      {(picked.size > 0 || mine) && (
        <button type="button" className="shrink-0 px-1 text-xs text-zinc-500 hover:underline" onClick={onAll}>
          {t("all")}
        </button>
      )}
    </div>
  );
}
