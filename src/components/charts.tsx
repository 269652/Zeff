import type { EntryType } from "@/db/schema";

/** Shared, theme-agnostic palette (mid shades read on light and dark). */
export const TYPE_STYLE: Record<EntryType, { bar: string; stroke: string; dot: string; label: string }> = {
  ticket: { bar: "bg-indigo-500", stroke: "stroke-indigo-500", dot: "bg-indigo-500", label: "Tickets" },
  meeting: { bar: "bg-violet-500", stroke: "stroke-violet-500", dot: "bg-violet-500", label: "Meetings" },
  other: { bar: "bg-zinc-400", stroke: "stroke-zinc-400", dot: "bg-zinc-400", label: "Other" },
};

export type DonutSegment = { key: string; value: number; strokeClass: string };

/** A donut chart. Segment values are summed; the center shows `centerValue`. */
export function Donut({
  segments,
  centerValue,
  centerLabel,
  size = 140,
}: {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel: string;
  size?: number;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const pcts = segments.map((s) => (s.value / total) * 100);
  // Offset each arc by the sum of the preceding arcs; 25 starts it at 12 o'clock.
  const offsets = pcts.map((_, i) => 25 - pcts.slice(0, i).reduce((sum, p) => sum + p, 0));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 42 42" className="-rotate-90" width={size} height={size} role="img" aria-label={centerLabel}>
        <circle cx="21" cy="21" r="15.915" fill="none" className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth="4" />
        {segments.map((s, i) => (
          <circle
            key={s.key}
            cx="21"
            cy="21"
            r="15.915"
            fill="none"
            className={s.strokeClass}
            strokeWidth="4"
            strokeDasharray={`${pcts[i]} ${100 - pcts[i]}`}
            strokeDashoffset={offsets[i]}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums">{centerValue}</span>
        <span className="text-[11px] text-zinc-500 uppercase">{centerLabel}</span>
      </div>
    </div>
  );
}

export type BarItem = { key: string; label: React.ReactNode; value: number; valueLabel: string; barClass?: string };

/** A horizontal bar list, sorted by the caller. */
export function BarList({ items, max, empty = "No data." }: { items: BarItem[]; max?: number; empty?: string }) {
  if (items.length === 0) return <p className="py-3 text-center text-sm text-zinc-500">{empty}</p>;
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.key} className="flex items-center gap-3 text-sm">
          <div className="w-40 shrink-0 truncate" title={typeof it.label === "string" ? it.label : undefined}>
            {it.label}
          </div>
          <div className="h-4 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
            <div
              className={`h-full rounded ${it.barClass ?? "bg-teal-500"}`}
              style={{ width: `${Math.max(2, (it.value / top) * 100)}%` }}
            />
          </div>
          <div className="w-16 shrink-0 text-right font-medium tabular-nums">{it.valueLabel}</div>
        </div>
      ))}
    </div>
  );
}

export type WeekColumn = {
  key: string;
  label: string;
  segments: { type: EntryType; value: number }[];
  total: number;
  badge?: string;
};

/** Stacked vertical bars per week, with an optional badge under each column. */
export function WeeklyBars({ weeks, height = 130 }: { weeks: WeekColumn[]; height?: number }) {
  const max = Math.max(...weeks.map((w) => w.total), 1);
  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ minHeight: height + 44 }}>
      {weeks.map((w) => (
        <div key={w.key} className="flex min-w-9 flex-1 flex-col items-center gap-1">
          <div className="text-[11px] font-medium tabular-nums text-zinc-500">{w.total ? w.total : ""}</div>
          <div className="flex w-full flex-col-reverse items-stretch" style={{ height }}>
            {w.segments.map((s) =>
              s.value > 0 ? (
                <div
                  key={s.type}
                  className={TYPE_STYLE[s.type].bar}
                  style={{ height: `${(s.value / max) * 100}%` }}
                  title={`${TYPE_STYLE[s.type].label}: ${s.value} h`}
                />
              ) : null,
            )}
            {w.total === 0 && <div className="mt-auto h-0.5 w-full bg-zinc-200 dark:bg-zinc-800" />}
          </div>
          <div className="text-[11px] text-zinc-500">{w.label}</div>
          {w.badge !== undefined && (
            <div className="rounded bg-sky-50 px-1 text-[10px] font-medium text-sky-700 tabular-nums dark:bg-sky-950 dark:text-sky-300">
              {w.badge}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { dot: string; label: string; value?: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block size-2.5 rounded-sm ${it.dot}`} />
          {it.label}
          {it.value && <span className="font-medium tabular-nums">{it.value}</span>}
        </span>
      ))}
    </div>
  );
}
