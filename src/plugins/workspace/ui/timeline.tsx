"use client";

import { useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { dateRange, type DbSchema, type Row, type View } from "../model";

/**
 * The timeline: a line per row, a bar from where it starts to where it ends (two date fields, or one date with a range, or a single
 * day), the day marked today. Drag a bar to move it, drag its right end to change the end - the dates are written back to the fields.
 * Rows without a date wait below.
 */

const DAY = 86400000;
const ZOOM = { day: 28, week: 10, month: 3 } as const;
type Zoom = keyof typeof ZOOM;

/** A date cell's day as a number of days (UTC), null when it has none. */
const dayOf = (s: string | undefined | null): number | null => {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null;
  return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY) : null;
};
const iso = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

type Bar = { row: Row; start: number; end: number };

export function TimelineView({ view, rows, schema, api, openRow, locked }: { view: View; rows: Row[]; schema: DbSchema; api: { set: (rowId: number, propId: string, value: unknown) => Promise<void> | void }; openRow: (id: number) => void; locked?: boolean }) {
  const t = useT();
  const [zoom, setZoom] = useState<Zoom>("week");
  const [drag, setDrag] = useState<{ id: number; mode: "move" | "end"; days: number } | null>(null);
  const startProp = schema.properties.find((p) => p.id === view.dateProp && p.type === "date");
  const endProp = schema.properties.find((p) => p.id === view.endProp && p.type === "date");
  const group = schema.properties.find((p) => p.id === view.groupBy);
  const w = ZOOM[zoom];
  const origin = useRef(0);

  const { bars, loose } = useMemo(() => {
    const bars: Bar[] = [];
    const loose: Row[] = [];
    if (!startProp) return { bars, loose: rows };
    for (const row of rows) {
      const range = dateRange(row.cells[startProp.id]);
      const start = dayOf(range?.start);
      if (start === null) {
        loose.push(row);
        continue;
      }
      const end = (endProp ? dayOf(dateRange(row.cells[endProp.id])?.start) : null) ?? dayOf(range?.end) ?? start;
      bars.push({ row, start, end: Math.max(start, end) });
    }
    bars.sort((a, b) => a.start - b.start || a.end - b.end);
    return { bars, loose };
  }, [rows, startProp, endProp]);

  if (!startProp)
    return <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">{t("Pick the date field the bars start at (“Date by …” above).")}</p>;

  const today = Math.round(Date.now() / DAY);
  const first = Math.min(today, ...bars.map((b) => b.start)) - 3;
  const last = Math.max(today, ...bars.map((b) => b.end)) + 10;
  const days = last - first + 1;
  const x = (day: number) => (day - first) * w;
  const months: { label: string; from: number; to: number }[] = [];
  for (let d = first; d <= last; d++) {
    const date = new Date(d * DAY);
    const label = date.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
    const prev = months[months.length - 1];
    if (prev?.label === label) prev.to = d;
    else months.push({ label, from: d, to: d });
  }

  const shown = (b: Bar) => {
    const d = drag?.id === b.row.id ? drag.days : 0;
    return drag?.mode === "end" && drag.id === b.row.id ? { start: b.start, end: Math.max(b.start, b.end + d) } : { start: b.start + d, end: b.end + d };
  };

  const begin = (e: React.PointerEvent, b: Bar, mode: "move" | "end") => {
    if (locked) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    origin.current = e.clientX;
    setDrag({ id: b.row.id, mode, days: 0 });
  };
  const move = (e: React.PointerEvent) => {
    if (drag) setDrag({ ...drag, days: Math.round((e.clientX - origin.current) / w) });
  };
  const finish = async (b: Bar) => {
    const cur = drag;
    setDrag(null);
    if (!cur || !cur.days) return;
    const next = shown(b);
    const keepRange = !endProp && dateRange(b.row.cells[startProp.id])?.end !== undefined;
    const ranged = !endProp && (keepRange || next.end !== next.start);
    if (endProp) {
      if (cur.mode === "move") await api.set(b.row.id, startProp.id, iso(next.start));
      await api.set(b.row.id, endProp.id, iso(next.end));
    } else await api.set(b.row.id, startProp.id, ranged ? { start: iso(next.start), end: iso(next.end) } : iso(next.start));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs">
        {(Object.keys(ZOOM) as Zoom[]).map((z) => (
          <button key={z} type="button" aria-pressed={zoom === z} className={`rounded px-1.5 py-0.5 ${zoom === z ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`} onClick={() => setZoom(z)}>
            {{ day: t("Days"), week: t("Weeks"), month: t("Months") }[z]}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div style={{ width: `calc(13rem + ${days * w}px)`, minWidth: "100%" }}>
          <div className="sticky top-0 z-10 flex h-7 border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="sticky left-0 z-10 w-52 shrink-0 border-r border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900">{schema.titleName}</div>
            <div className="relative flex-1">
              {months.map((m) => (
                <span key={m.from} className="absolute top-0 truncate border-l border-zinc-200 px-1 py-1 dark:border-zinc-800" style={{ left: x(m.from), width: (m.to - m.from + 1) * w }}>
                  {m.label}
                </span>
              ))}
            </div>
          </div>
          {bars.map((b) => {
            const s = shown(b);
            const opt = group?.options?.find((o) => o.id === b.row.cells[group.id] || (Array.isArray(b.row.cells[group.id]) && (b.row.cells[group.id] as unknown[]).includes(o.id)));
            return (
              <div key={b.row.id} className="flex h-8 items-center border-b border-zinc-100 dark:border-zinc-900">
                <button type="button" className="sticky left-0 z-[1] w-52 shrink-0 truncate border-r border-zinc-100 bg-white px-2 py-1 text-left text-sm hover:underline dark:border-zinc-900 dark:bg-zinc-950" onClick={() => openRow(b.row.id)}>
                  {b.row.icon ? `${b.row.icon} ` : ""}
                  {b.row.title || t("Untitled")}
                </button>
                <div className="relative h-full flex-1">
                  {today >= first && today <= last && <span className="absolute inset-y-0 w-px bg-red-400/70" style={{ left: x(today) + w / 2 }} aria-hidden />}
                  <div
                    role="button"
                    tabIndex={0}
                    className="ws-tag absolute top-1 flex h-6 cursor-grab touch-none items-center overflow-hidden px-1.5 text-xs select-none"
                    data-color={opt?.color}
                    style={{ left: x(s.start), width: Math.max(w, (s.end - s.start + 1) * w) }}
                    title={`${iso(s.start)}${s.end > s.start ? ` → ${iso(s.end)}` : ""}`}
                    onPointerDown={(e) => begin(e, b, "move")}
                    onPointerMove={move}
                    onPointerUp={() => void finish(b)}
                    onClick={() => !drag && openRow(b.row.id)}
                    onKeyDown={(e) => e.key === "Enter" && openRow(b.row.id)}
                  >
                    <span className="truncate">{b.row.title}</span>
                    {!locked && <span className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" onPointerDown={(e) => begin(e, b, "end")} onPointerMove={move} onPointerUp={() => void finish(b)} aria-hidden />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {loose.length > 0 && (
        <p className="text-xs text-zinc-500">
          {t("{n} without a date:", { n: loose.length })}{" "}
          {loose.slice(0, 12).map((r, i) => (
            <button key={r.id} type="button" className="hover:underline" onClick={() => openRow(r.id)}>
              {i ? " · " : ""}
              {r.title || t("Untitled")}
            </button>
          ))}
          {loose.length > 12 ? " …" : ""}
        </p>
      )}
    </div>
  );
}
