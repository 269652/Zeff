"use client";

import type { ChartPoint } from "../blocks";

/**
 * The charts of the chart block - plain SVG, no library: bars (horizontal, with the labels beside them), columns, a line over time,
 * a pie with its legend. Each takes the points (label, value, colour) and the unit to show after a value.
 */

const fmt = (n: number, unit: string) => `${Math.round(n * 100) / 100}${unit ? ` ${unit}` : ""}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function BarChart({ points, unit }: { points: ChartPoint[]; unit: string }) {
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <ul className="space-y-1.5" aria-label="Bar chart">
      {points.map((p) => (
        <li key={p.label} className="grid grid-cols-[minmax(5rem,11rem)_1fr_auto] items-center gap-2 text-sm">
          <span className="truncate text-zinc-600 dark:text-zinc-300" title={p.label}>
            {p.label}
          </span>
          <span className="h-5 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
            <span className="block h-full rounded transition-[width]" style={{ width: `${Math.max(2, (p.value / max) * 100)}%`, background: p.color }} />
          </span>
          <span className="w-16 text-right tabular-nums">{fmt(p.value, unit)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ColumnChart({ points, unit }: { points: ChartPoint[]; unit: string }) {
  const max = Math.max(...points.map((p) => p.value), 1);
  const W = Math.max(320, points.length * 56);
  const H = 190;
  const base = H - 34;
  const step = W / points.length;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full min-w-80" role="img" aria-label="Column chart">
        <line x1="0" x2={W} y1={base} y2={base} stroke="currentColor" strokeOpacity="0.15" />
        {points.map((p, i) => {
          const h = Math.max(2, (p.value / max) * (base - 20));
          const x = i * step + step * 0.18;
          const w = step * 0.64;
          return (
            <g key={p.label}>
              <rect x={x} y={base - h} width={w} height={h} rx="4" fill={p.color} />
              <text x={x + w / 2} y={base - h - 5} textAnchor="middle" fontSize="11" fill="currentColor">
                {fmt(p.value, unit)}
              </text>
              <text x={x + w / 2} y={base + 15} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.6">
                {clip(p.label, 10)}
              </text>
              <title>{`${p.label}: ${fmt(p.value, unit)}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function LineChart({ points, unit }: { points: ChartPoint[]; unit: string }) {
  const max = Math.max(...points.map((p) => p.value), 1);
  const W = Math.max(320, points.length * 56);
  const H = 190;
  const base = H - 34;
  const step = points.length > 1 ? (W - 40) / (points.length - 1) : 0;
  const xy = points.map((p, i) => [20 + i * step, base - (p.value / max) * (base - 24)] as const);
  const line = xy.map(([x, y]) => `${x},${y}`).join(" ");
  const color = points[0]?.color ?? "#6366f1";
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full min-w-80" role="img" aria-label="Line chart">
        <line x1="0" x2={W} y1={base} y2={base} stroke="currentColor" strokeOpacity="0.15" />
        {xy.length > 1 && <polygon points={`${xy[0][0]},${base} ${line} ${xy[xy.length - 1][0]},${base}`} fill={color} fillOpacity="0.1" />}
        <polyline points={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {xy.map(([x, y], i) => (
          <g key={points[i].label}>
            <circle cx={x} cy={y} r="4" fill={color} />
            <text x={x} y={y - 9} textAnchor="middle" fontSize="11" fill="currentColor">
              {fmt(points[i].value, unit)}
            </text>
            <text x={x} y={base + 15} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.6">
              {clip(points[i].label, 10)}
            </text>
            <title>{`${points[i].label}: ${fmt(points[i].value, unit)}`}</title>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function PieChart({ points, unit }: { points: ChartPoint[]; unit: string }) {
  const total = points.reduce((a, p) => a + p.value, 0) || 1;
  const R = 70;
  let angle = -Math.PI / 2;
  const arcs = points.map((p) => {
    const sweep = (p.value / total) * Math.PI * 2;
    const a0 = angle;
    angle += sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const [x0, y0] = [90 + R * Math.cos(a0), 90 + R * Math.sin(a0)];
    const [x1, y1] = [90 + R * Math.cos(angle), 90 + R * Math.sin(angle)];
    return { p, d: sweep >= Math.PI * 2 - 1e-6 ? `M 90 ${90 - R} A ${R} ${R} 0 1 1 89.99 ${90 - R} Z` : `M 90 90 L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z` };
  });
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 180 180" className="size-44 shrink-0" role="img" aria-label="Pie chart">
        {arcs.map(({ p, d }) => (
          <path key={p.label} d={d} fill={p.color} stroke="white" strokeWidth="1.5" className="dark:stroke-zinc-900">
            <title>{`${p.label}: ${fmt(p.value, unit)} (${Math.round((p.value / total) * 100)} %)`}</title>
          </path>
        ))}
        <circle cx="90" cy="90" r="34" className="fill-white dark:fill-zinc-950" />
        <text x="90" y="95" textAnchor="middle" fontSize="15" fontWeight="600" fill="currentColor">
          {fmt(total, unit)}
        </text>
      </svg>
      <ul className="min-w-40 flex-1 space-y-1 text-sm">
        {points.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-sm" style={{ background: p.color }} />
            <span className="min-w-0 flex-1 truncate" title={p.label}>
              {p.label}
            </span>
            <span className="tabular-nums text-zinc-500">
              {fmt(p.value, unit)} · {Math.round((p.value / total) * 100)} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
