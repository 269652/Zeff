"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { PlanSummary } from "../plans";
import type { CreditorOf } from "./colors";

/**
 * What the debts' plans cost each month until you are debt-free: a bar a month, stacked by creditor — each in its colour,
 * the same as in "open by creditor", named in the legend under it — and your income as a line when known (the same unit, one
 * axis). Hover a month: what goes to whom.
 */
export function DebtChart({ months, creditorOf, income }: { months: PlanSummary["months"]; creditorOf: CreditorOf; income: number | null }) {
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
  // A month's parts by creditor (several debts with one creditor: one part), in the creditors' order — the same in every bar.
  const who = (id: number) => creditorOf[id] ?? { key: -id, name: "?", color: "#94a3b8" };
  const order = [...new Set(Object.values(creditorOf).map((c) => c.key))];
  const parts = months.map((m) => {
    const by = new Map<number, { name: string; color: string; amount: number }>();
    for (const b of m.by) {
      const c = who(b.id);
      const had = by.get(c.key);
      by.set(c.key, { name: c.name, color: c.color, amount: (had?.amount ?? 0) + b.amount });
    }
    const sorted = [...by].sort((a, b) => (order.indexOf(a[0]) + 1 || 999) - (order.indexOf(b[0]) + 1 || 999));
    // Each part stands on the ones before it.
    return sorted.map(([key, v], i) => ({ key, ...v, from: sorted.slice(0, i).reduce((s, [, x]) => s + x.amount, 0) }));
  });
  // The legend: the creditors that are paid in these months, in their order.
  const legend = order.filter((k) => parts.some((p) => p.some((x) => x.key === k))).map((k) => Object.values(creditorOf).find((c) => c.key === k)!);
  const hover = at != null ? { month: months[at], parts: parts[at] } : null;
  return (
    <div className="relative space-y-2">
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
          return (
            <g key={m.month} onMouseEnter={() => setAt(i)} opacity={at === null || at === i ? 1 : 0.55}>
              {/* The hit target: the whole column, bigger than the bar. */}
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="transparent" />
              {parts[i].map((p) => {
                const [y0, y1] = [y(p.from), y(p.from + p.amount)];
                return y0 - y1 > 0 ? <rect key={p.key} x={x} y={y1} width={bar} height={y0 - y1} fill={p.color} stroke="white" strokeWidth={bar > 6 ? 0.5 : 0} className="dark:stroke-zinc-900" /> : null;
              })}
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
      {legend.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 pl-11 text-xs text-zinc-600 dark:text-zinc-300">
          {legend.map((c) => (
            <li key={c.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: c.color }} aria-hidden />
              {c.name}
            </li>
          ))}
        </ul>
      )}
      {hover && (
        <div className="pointer-events-none absolute top-1 left-12 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <p className="font-medium">
            {new Date(`${hover.month.month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })} · {euro(hover.month.amount)}
          </p>
          <ul className="mt-0.5 space-y-px text-zinc-600 dark:text-zinc-300">
            {[...hover.parts]
              .sort((a, b) => b.amount - a.amount)
              .map((p) => (
                <li key={p.key} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ background: p.color }} aria-hidden />
                    {p.name}
                  </span>
                  <span className="tabular-nums">{euro(p.amount)}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
