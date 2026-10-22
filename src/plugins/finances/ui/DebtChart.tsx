"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { PlanSummary } from "../plans";

/**
 * What the debts' plans cost each month until you are debt-free: a bar a month (one series, so no legend — the title names it),
 * your income as a line when known (the same unit, one axis). Hover a month: what goes to whom.
 */
export function DebtChart({ months, names, income }: { months: PlanSummary["months"]; names: Record<number, string>; income: number | null }) {
  const t = useT();
  const [at, setAt] = useState<number | null>(null);
  if (!months.length) return null;
  const euro = (v: number) => v.toLocaleString(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const W = 1100;
  const H = 220;
  const pad = { l: 44, r: 8, t: 8, b: 22 };
  const max = Math.max(...months.map((m) => m.amount), income ?? 0, 1);
  // A round top for the axis: 1, 2 or 5 times a power of ten.
  const step = (() => {
    const raw = max / 4;
    const p = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw)!;
  })();
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const slot = (W - pad.l - pad.r) / months.length;
  const bar = Math.max(2, Math.min(18, slot - 2));
  const label = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  // Every n-th month named, so the labels don't collide.
  const every = Math.max(1, Math.ceil(months.length / 12));
  const hover = at != null ? months[at] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[1100px]" role="img" aria-label={t("Monthly payments until debt-free")} onMouseLeave={() => setAt(null)}>
        {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth={1} />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="fill-zinc-400 text-[10px] tabular-nums">
              {euro(v)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = pad.l + i * slot + (slot - bar) / 2;
          const h = Math.max(0, y(0) - y(m.amount));
          return (
            <g key={m.month} onMouseEnter={() => setAt(i)}>
              {/* The hit target: the whole column, bigger than the bar. */}
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="transparent" />
              {h > 0 && <path d={`M${x},${y(0)} V${y(m.amount) + Math.min(4, h)} Q${x},${y(m.amount)} ${x + Math.min(4, bar / 2)},${y(m.amount)} H${x + bar - Math.min(4, bar / 2)} Q${x + bar},${y(m.amount)} ${x + bar},${y(m.amount) + Math.min(4, h)} V${y(0)} Z`} className={at === i ? "fill-indigo-700 dark:fill-indigo-300" : "fill-indigo-500 dark:fill-indigo-400"} />}
              {i % every === 0 && (
                <text x={pad.l + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="fill-zinc-400 text-[10px]">
                  {label(m.month)}
                </text>
              )}
            </g>
          );
        })}
        {income != null && income > 0 && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(income)} y2={y(income)} className="stroke-zinc-500 dark:stroke-zinc-400" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={W - pad.r} y={y(income) - 4} textAnchor="end" className="fill-zinc-500 text-[10px] dark:fill-zinc-400">
              {t("Income {amount}", { amount: euro(income) })}
            </text>
          </g>
        )}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute top-1 left-12 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <p className="font-medium">
            {new Date(`${hover.month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })} · {euro(hover.amount)}
          </p>
          <ul className="mt-0.5 space-y-px text-zinc-600 dark:text-zinc-300">
            {hover.by
              .sort((a, b) => b.amount - a.amount)
              .map((b) => (
                <li key={b.id} className="flex justify-between gap-4">
                  <span>{names[b.id] ?? "?"}</span>
                  <span className="tabular-nums">{euro(b.amount)}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
