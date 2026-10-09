/** A donut slice; `color` (e.g. an entry type's) or a stroke-* class. */
export type DonutSegment = { key: string; value: number; color?: string; strokeClass?: string };

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
            style={s.color ? { stroke: s.color } : undefined}
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

export type BarItem = {
  key: string;
  label: React.ReactNode;
  value: number;
  valueLabel: string;
  barClass?: string;
  /** A bar color (e.g. an entry type's) instead of barClass. */
  color?: string;
};

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
              className={`h-full rounded ${it.color ? "" : (it.barClass ?? "bg-teal-500")}`}
              style={{ width: `${Math.max(2, (it.value / top) * 100)}%`, ...(it.color ? { backgroundColor: it.color } : {}) }}
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
  /** One stacked part per entry type, bottom-up, in its configured color. */
  segments: { key: string; label: string; value: number; color: string }[];
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
                  key={s.key}
                  style={{ height: `${(s.value / max) * 100}%`, backgroundColor: s.color }}
                  title={`${s.label}: ${s.value} h`}
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

export type LinePoint = { label: string; value: number | null };

/**
 * A single-series line chart (inline SVG, no chart lib). `value: null` points are
 * gaps and the line connects across them. Colors inherit from `colorClass`
 * (a text-* class) via currentColor, so it reads on light and dark.
 */
export function LineChart({
  points,
  height = 132,
  colorClass = "text-indigo-500",
  format = (v: number) => String(v),
  unit = "",
  empty = "No data.",
}: {
  points: LinePoint[];
  height?: number;
  colorClass?: string;
  format?: (v: number) => string;
  unit?: string;
  empty?: string;
}) {
  const defined = points
    .map((p, i) => ({ i, label: p.label, value: p.value }))
    .filter((p): p is { i: number; label: string; value: number } => p.value !== null);
  if (defined.length === 0) return <p className="py-6 text-center text-sm text-zinc-500">{empty}</p>;

  const max = Math.max(...defined.map((p) => p.value), 1);
  const n = points.length;
  const padY = 8; // % headroom top & bottom
  const base = 100 - padY;
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => base - (v / max) * (base - padY);

  const coords = defined.map((p) => ({ cx: x(p.i), cy: y(p.value), label: p.label, value: p.value }));
  const line = coords.map((c, k) => `${k === 0 ? "M" : "L"}${c.cx.toFixed(2)},${c.cy.toFixed(2)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1].cx.toFixed(2)},${base} L${coords[0].cx.toFixed(2)},${base} Z`;

  // Up to ~7 x-axis labels, evenly spaced.
  const step = Math.max(1, Math.ceil(n / 7));
  const last = defined[defined.length - 1];

  return (
    <div className={colorClass}>
      <div className="mb-1 flex items-baseline justify-between text-[11px] text-zinc-500 tabular-nums">
        <span>
          max {format(max)}
          {unit}
        </span>
        <span className="font-medium text-current">
          now {format(last.value)}
          {unit}
        </span>
      </div>
      <div className="relative w-full" style={{ height }}>
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <line x1="0" y1={base} x2="100" y2={base} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
          <path d={area} className="fill-current opacity-10" />
          <path d={line} className="stroke-current" strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {coords.map((c) => (
          <span
            key={c.label}
            className="absolute block size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current"
            style={{ left: `${c.cx}%`, top: `${c.cy}%` }}
            title={`${c.label}: ${format(c.value)}${unit}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        {points
          .map((p, i) => ({ p, i }))
          .filter(({ i }) => i % step === 0 || i === n - 1)
          .map(({ p, i }) => (
            <span key={i}>{p.label}</span>
          ))}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { dot?: string; color?: string; label: string; value?: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block size-2.5 rounded-sm ${it.dot ?? ""}`} style={it.color ? { backgroundColor: it.color } : undefined} />
          {it.label}
          {it.value && <span className="font-medium tabular-nums">{it.value}</span>}
        </span>
      ))}
    </div>
  );
}
