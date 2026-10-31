"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { dateRange, type DbSchema, type Row, type View } from "../../model";
import type { Api } from "./use-database";
import { ymd } from "./shared";

export function CalendarView({ canAdd = true, view, rows, schema, api, openRow, newRow }: { canAdd?: boolean; view: View; rows: Row[]; schema: DbSchema; api: Api; openRow: (id: number) => void; newRow: (cells?: Record<string, unknown>, templateId?: number, open?: boolean) => Promise<void> }) {
  const t = useT();
  const prop = schema.properties.find((p) => p.id === view.dateProp);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  if (!prop) return <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">{t("Choose the date property the calendar is laid out by.")}</p>;
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const rg = dateRange(r.cells[prop.id]);
    if (!rg) continue;
    const from = new Date(`${rg.start.slice(0, 10)}T00:00:00`);
    const to = new Date(`${(rg.end ?? rg.start).slice(0, 10)}T00:00:00`);
    for (let d = new Date(from), n = 0; d <= to && n < 62; d.setDate(d.getDate() + 1), n++) {
      const k = ymd(d);
      byDay.set(k, [...(byDay.get(k) ?? []), r]);
    }
  }
  const undated = rows.filter((r) => !dateRange(r.cells[prop.id]));
  const today = ymd(new Date());
  const names = [t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat"), t("Sun")];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label={t("Previous month")}>
          ‹
        </button>
        <span className="min-w-32 text-center text-sm font-medium">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <button type="button" className="btn btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label={t("Next month")}>
          ›
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          {t("Today")}
        </button>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-zinc-200 text-xs dark:border-zinc-800">
        {names.map((n) => (
          <div key={n} className="border-b border-zinc-200 bg-zinc-50 px-1.5 py-1 text-center font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50">
            {n}
          </div>
        ))}
        {days.map((d) => {
          const k = ymd(d);
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div
              key={k}
              className={`group/day min-h-24 border-r border-b border-zinc-200 p-1 dark:border-zinc-800 ${inMonth ? "" : "bg-zinc-50/60 text-zinc-400 dark:bg-zinc-900/30"}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = Number(e.dataTransfer.getData("text/ws-row"));
                const row = rows.find((r) => r.id === id);
                if (!row) return;
                const rg = dateRange(row.cells[prop.id]);
                if (!rg) return api.set(id, prop.id, k);
                // The span keeps its length.
                const days = Math.round((Date.parse(`${(rg.end ?? rg.start).slice(0, 10)}T00:00:00Z`) - Date.parse(`${rg.start.slice(0, 10)}T00:00:00Z`)) / 864e5);
                const to = new Date(`${k}T00:00:00`);
                to.setDate(to.getDate() + days);
                api.set(id, prop.id, days ? { start: k, end: ymd(to) } : k);
              }}
            >
              <div className="flex items-center justify-between">
                <span className={k === today ? "rounded-full bg-indigo-600 px-1.5 text-white" : ""}>{d.getDate()}</span>
                <button type="button" hidden={!canAdd} className="icon-btn opacity-0 group-hover/day:opacity-100" aria-label={t("New row on {day}", { day: k })} onClick={() => void newRow({ [prop.id]: k })}>
                  +
                </button>
              </div>
              <div className="space-y-0.5">
                {(byDay.get(k) ?? []).slice(0, 4).map((r) => (
                  <button key={r.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData("text/ws-row", String(r.id))} onClick={() => openRow(r.id)} className="block w-full truncate rounded bg-indigo-100 px-1 py-0.5 text-left text-indigo-900 hover:bg-indigo-200 dark:bg-indigo-950 dark:text-indigo-100" title={r.title}>
                    {r.icon} {r.title || t("Untitled")}
                  </button>
                ))}
                {(byDay.get(k)?.length ?? 0) > 4 && <span className="text-zinc-500">+{(byDay.get(k)?.length ?? 0) - 4}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {undated.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">{t("{n} without a date", { n: undated.length })}</summary>
          <ul className="mt-1 flex flex-wrap gap-1">
            {undated.map((r) => (
              <li key={r.id}>
                <button type="button" className="ws-chip" onClick={() => openRow(r.id)}>
                  {r.title || t("Untitled")}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
