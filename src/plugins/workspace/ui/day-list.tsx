"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { closeDayAction, dayListAction, undoCloseDayAction, type DatabaseData } from "../actions";
import type { dayStats } from "../day-lists";
import type { RowsItem } from "../form-spec";
import { RowsField } from "./form-runner";

/**
 * A day list's own tabs (day-lists.ts), before its views: Today (each item a line — its tick, its dose and its time, changed in place;
 * the day closed or the close undone at the top), History (the days as a month: full, partial, none — and the log's table) and Figures
 * (how much was done the last 7 / 30 days, what is open, the mean time of each item — Kennzahlen too). Not views of the schema: the
 * tabs are there for every day list, from the start.
 */

export const DAY_TABS = ["day:today", "day:history", "day:stats"] as const;
export type DayTab = (typeof DAY_TABS)[number];
export const isDayTab = (id: string): id is DayTab => (DAY_TABS as readonly string[]).includes(id);

type Stats = NonNullable<ReturnType<typeof dayStats>>;

const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
const clock = (hours: number) => {
  const m = Math.round(hours * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const pct = (v: number | null) => (v === null ? "—" : `${String(v).replace(".", ",")} %`);

/** The tab strip's labels of the day tabs. */
export function useDayTabLabels(): Record<DayTab, string> {
  const t = useT();
  return { "day:today": `☑ ${t("Today")}`, "day:history": `🗓 ${t("History")}`, "day:stats": `📈 ${t("Figures")}` };
}

export function DayListTab({ tab, dbId, data, set, reload, logView }: { tab: DayTab; dbId: number; data: DatabaseData; set: (rowId: number, propId: string, value: unknown) => void; reload: () => Promise<unknown>; /** The log's table (a database view of it). */ logView: (logId: number) => ReactNode }) {
  const t = useT();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const load = useCallback(async () => {
    const r = await dayListAction(dbId);
    if (r.ok) setStats(r.stats);
  }, [dbId]);
  // Read again when the rows change (a tick, a dose) — a moment later, a burst of typing is one read.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 400);
    return () => clearTimeout(timer);
  }, [load, data.rows, tab]);
  const after = async () => {
    await reload();
    await load();
    router.refresh();
  };
  if (tab === "day:today") return <DayToday data={data} stats={stats} dbId={dbId} set={set} after={after} reload={reload} />;
  if (!stats) return <p className="py-6 text-sm text-zinc-500">{t("Loading …")}</p>;
  if (tab === "day:history") return <DayHistory stats={stats} logView={logView} />;
  return <DayFigures stats={stats} />;
}

function DayToday({ data, stats, dbId, set, after, reload }: { data: DatabaseData; stats: Stats | null; dbId: number; set: (rowId: number, propId: string, value: unknown) => void; after: () => Promise<void>; reload: () => Promise<unknown> }) {
  const t = useT();
  const props = data.schema.properties;
  const tick = props.find((p) => p.type === "checkbox");
  const time = props.find((p) => p.type === "date" && !!tick && p.stampOf === tick.id) ?? props.find((p) => p.type === "date" && p.includeTime);
  const numbers = props.filter((p) => p.type === "number" && !p.formula);
  const item: RowsItem = useMemo(
    () => ({ id: "day", kind: "rows", cols: [...(tick ? [tick.id] : []), ...numbers.map((p) => p.id), ...(time ? [time.id] : [])], ...(tick && time ? { stamp: { check: tick.id, time: time.id } } : {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick?.id, time?.id, numbers.map((p) => p.id).join()],
  );
  const rows = data.rows.filter((r) => !data.schema.hiddenRows?.includes(r.id));
  const done = rows.filter((r) => (tick ? r.cells[tick.id] === true : !!time && /T\d{2}:\d{2}/.test(String(r.cells[time.id] ?? "")))).length;
  const day = stats?.state.day;
  const closeDay = async () => {
    const r = await closeDayAction(dbId);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    await after();
    toast(t("Closed: {day}.", { day: longDay(r.day) }), { tone: "ok", action: { label: t("Undo"), run: undo } });
  };
  const undo = async () => {
    const u = await undoCloseDayAction(dbId);
    if (!u.ok) return void toast(u.error, { tone: "error" });
    await after();
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-40 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">
              {done}/{rows.length}
            </span>
            <span className="text-sm text-zinc-500">{day ? longDay(day) : ""}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={done} aria-label={t("Done today")}>
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${rows.length ? (done / rows.length) * 100 : 0}%` }} />
          </div>
        </div>
        {stats?.state.canUndo && stats.state.closed && (
          <button type="button" className="btn btn-sm" onClick={() => void undo()} title={t("Open the closed day again, with its ticks")}>
            ↶ {t("Undo the close of {day}", { day: longDay(stats.state.closed) })}
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={() => void closeDay()} disabled={!!data.locked} title={t("Close the day: its entry in the log is locked and every tick goes off. It is the day the ticks were made on — closed in the morning before the list turned at 4:00, the day before")}>
          ✓ {t("Close the day")}
        </button>
      </div>
      <RowsField
        item={{ ...item, label: t("Today") }}
        db={{ id: dbId, title: data.title, titleName: data.schema.titleName, props }}
        rows={rows}
        edits={{}}
        onEdit={(rowId, propId, value) => {
          set(rowId, propId, value);
          // (Unticked, the list clears its time by itself: read back a moment later.)
          if (propId === tick?.id && value !== true) setTimeout(() => void reload(), 800);
        }}
        uid={`day-${dbId}`}
      />
      <p className="text-xs text-zinc-500">{t("The list starts again every day at 4:00 — each day is kept in its history.")}</p>
    </div>
  );
}

const TONE = { full: "bg-emerald-500 text-white", partial: "bg-amber-300 text-amber-950 dark:bg-amber-500/70", none: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" } as const;

function DayHistory({ stats, logView }: { stats: Stats; logView: (logId: number) => ReactNode }) {
  const t = useT();
  const today = stats.state.day;
  const [month, setMonth] = useState(today.slice(0, 7));
  const byDay = useMemo(() => new Map(stats.history.map((h) => [h.day, h])), [stats.history]);
  const first = new Date(`${month}-01T12:00:00`);
  const lead = (first.getDay() + 6) % 7; // (Monday first)
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const shift = (n: number) => {
    const d = new Date(first);
    d.setMonth(d.getMonth() + n);
    setMonth(d.toLocaleDateString("sv-SE").slice(0, 7));
  };
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }));
  const oldest = stats.history[0]?.day.slice(0, 7) ?? month;
  return (
    <div className="space-y-4">
      <section aria-label={t("The days")} className="max-w-md space-y-2">
        <div className="flex items-center gap-2">
          <button type="button" className="icon-btn" aria-label={t("Month before")} disabled={month <= oldest} onClick={() => shift(-1)}>
            ‹
          </button>
          <span className="flex-1 text-center text-sm font-medium">{first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
          <button type="button" className="icon-btn" aria-label={t("Month after")} disabled={month >= today.slice(0, 7)} onClick={() => shift(1)}>
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {weekdays.map((w) => (
            <span key={w} className="text-zinc-500">
              {w}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`x${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const day = `${month}-${String(i + 1).padStart(2, "0")}`;
            const h = byDay.get(day);
            const tone = !h ? null : h.total && h.taken >= h.total ? "full" : h.taken > 0 ? "partial" : "none";
            const tip = !h ? longDay(day) : `${longDay(day)}: ${h.taken}/${h.total}${h.items.length ? ` — ${h.items.join(", ")}` : ""}`;
            return (
              <span key={day} title={tip} aria-label={tip} className={`flex aspect-square items-center justify-center rounded-md tabular-nums ${tone ? TONE[tone] : "text-zinc-400"} ${day === today ? "ring-2 ring-indigo-500" : ""}`}>
                {i + 1}
              </span>
            );
          })}
        </div>
        <p className="flex flex-wrap gap-3 text-xs text-zinc-500">
          <span><span className={`mr-1 inline-block size-2.5 rounded-sm ${TONE.full}`} />{t("all done")}</span>
          <span><span className={`mr-1 inline-block size-2.5 rounded-sm ${TONE.partial}`} />{t("partly")}</span>
          <span><span className={`mr-1 inline-block size-2.5 rounded-sm ${TONE.none}`} />{t("nothing")}</span>
        </p>
      </section>
      {stats.state.logId ? (
        <section aria-label={t("The log")} className="space-y-1">
          <h3 className="text-sm font-medium">
            <Link href={`/workspace/${stats.state.logId}`} className="hover:underline">
              📜 {t("The log")}
            </Link>
          </h3>
          {logView(stats.state.logId)}
        </section>
      ) : (
        <p className="text-sm text-zinc-500">{t("No day kept yet — tick something and it is.")}</p>
      )}
    </div>
  );
}

function DayFigures({ stats }: { stats: Stats }) {
  const t = useT();
  const open = stats.state.total - stats.state.done;
  const tiles = [
    { name: stats.names.week, label: t("Done the last 7 days"), value: pct(stats.week) },
    { name: stats.names.month, label: t("Done the last 30 days"), value: pct(stats.month) },
    { name: stats.names.open, label: t("Open today"), value: String(open) },
  ];
  return (
    <div className="space-y-4">
      <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
        {tiles.map((x) => (
          <li key={x.name} className="rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800" title={`kennzahl("${x.name}")`}>
            <span className="block truncate text-xs text-zinc-500">{x.label}</span>
            <span className="block text-lg leading-tight font-semibold tabular-nums">{x.value}</span>
          </li>
        ))}
      </ul>
      {stats.times.length > 0 && (
        <section aria-label={t("Mean time")} className="max-w-md">
          <h3 className="mb-1 text-sm font-medium">{t("Mean time, the last 30 days")}</h3>
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {stats.times.map((x) => (
              <li key={x.id} className="flex items-center gap-2 px-3 py-1.5" title={`kennzahl("${x.metric}")`}>
                <span className="flex-1">{x.title}</span>
                <span className="font-medium tabular-nums">{clock(x.hours)}</span>
                <span className="text-xs text-zinc-500">{t("{n} days", { n: x.days })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-zinc-500">
        {t("These figures are Kennzahlen: in a formula (kennzahl(\"{name}\")), as an @-chip in a page, on Today.", { name: stats.names.week })}{" "}
        <Link href="/workspace/metrics" className="text-indigo-600 hover:underline dark:text-indigo-400">
          {t("All metrics →")}
        </Link>
      </p>
    </div>
  );
}
