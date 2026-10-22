"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { PlanSummary } from "../plans";

/**
 * What is still open, month by month, as the plans pay it off — one line falling to what has no plan (one series: the title
 * names it, no legend). Hover a month: what is open after it.
 */
export function BalanceChart({ open, months, unplanned }: { open: number; months: PlanSummary["months"]; unplanned: number }) {
  const t = useT();
  const [at, setAt] = useState<number | null>(null);
  if (!months.length) return null;
  const euro = (v: number) => v.toLocaleString(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  // Open after each month: what has no plan and what the later months still pay; the first point is today.
  const after = months.map((_, i) => unplanned + months.slice(i + 1).reduce((s, m) => s + m.amount, 0));
  const points = [{ month: null as string | null, value: open }, ...months.map((m, i) => ({ month: m.month, value: after[i] }))];
  const W = 540;
  const H = 200;
  const pad = { l: 52, r: 10, t: 10, b: 22 };
  const max = Math.max(...points.map((p) => p.value), 1);
  const step = (() => {
    const raw = max / 4;
    const p = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw)!;
  })();
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  const label = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  const every = Math.max(1, Math.ceil(points.length / 6));
  const hover = at != null ? points[at] : null;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={t("Open until debt-free")}
        onMouseLeave={() => setAt(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setAt(Math.max(0, Math.min(points.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (points.length - 1)))));
        }}
      >
        {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth={1} />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="fill-zinc-400 text-[10px] tabular-nums">
              {euro(v)}
            </text>
          </g>
        ))}
        <path d={`${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} className="fill-indigo-500/10 dark:fill-indigo-400/15" />
        <path d={line} fill="none" className="stroke-indigo-500 dark:stroke-indigo-400" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) =>
          i % every === 0 || i === points.length - 1 ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="fill-zinc-400 text-[10px]">
              {p.month ? label(p.month) : t("now")}
            </text>
          ) : null,
        )}
        {at != null && (
          <g>
            <line x1={x(at)} x2={x(at)} y1={pad.t} y2={y(0)} className="stroke-zinc-300 dark:stroke-zinc-600" strokeWidth={1} />
            <circle cx={x(at)} cy={y(points[at].value)} r={4} strokeWidth={2} className="fill-indigo-500 stroke-white dark:fill-indigo-400 dark:stroke-zinc-950" />
          </g>
        )}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute top-1 right-2 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <p className="font-medium">{hover.month ? new Date(`${hover.month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : t("now")}</p>
          <p className="text-zinc-600 tabular-nums dark:text-zinc-300">{t("{amount} open", { amount: euro(hover.value) })}</p>
        </div>
      )}
    </div>
  );
}
