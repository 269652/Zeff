"use client";

import { useState } from "react";

/**
 * What is open with whom — a bar each, largest first, in the creditor's colour (the same as in the monthly payments; the
 * names beside the bars, the amounts at their ends). Hover a bar: its share of all.
 */
export function ShareChart({ items, colors = {} }: { items: { id: number; name: string; amount: number }[]; colors?: Record<number, string> }) {
  const [at, setAt] = useState<number | null>(null);
  const rows = items.filter((i) => i.amount > 0).sort((a, b) => b.amount - a.amount);
  if (!rows.length) return null;
  const euro = (v: number) => v.toLocaleString(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const max = rows[0].amount;
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <ul className="space-y-1.5" onMouseLeave={() => setAt(null)}>
      {rows.map((r) => (
        <li key={r.id} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-xs" onMouseEnter={() => setAt(r.id)} title={`${r.name}: ${euro(r.amount)} · ${Math.round((r.amount / sum) * 100)} %`}>
          <span className="truncate text-zinc-600 dark:text-zinc-300">{r.name}</span>
          <span className="flex items-center gap-2">
            <span className={`h-3 rounded-r-[4px] transition-opacity ${colors[r.id] ? "" : "bg-indigo-500 dark:bg-indigo-400"} ${at !== null && at !== r.id ? "opacity-55" : ""}`} style={{ width: `${Math.max(1, (r.amount / max) * 100) * 0.8}%`, ...(colors[r.id] ? { background: colors[r.id] } : {}) }} />
            <span className="whitespace-nowrap text-zinc-500 tabular-nums">
              {euro(r.amount)}
              {at === r.id && ` · ${Math.round((r.amount / sum) * 100)} %`}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
