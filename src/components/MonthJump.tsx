"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

const isMonthKey = (v: string) => /^\d{4}-\d{2}$/.test(v);

/**
 * "Jump to month" and "Reported by" on the monthly page: they navigate as soon as a month
 * is picked (or on Enter) / a reporter is chosen — no Apply button.
 */
export function MonthJump({ monthKey, by, reporters }: { monthKey: string; by?: string; reporters: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const go = (m: string, r?: string) =>
    start(() => router.push(`/month?month=${m}${r ? `&by=${encodeURIComponent(r)}` : ""}`));

  return (
    <>
      <div>
        <label className="label" htmlFor="month">Jump to month</label>
        <input
          id="month"
          type="month"
          defaultValue={monthKey}
          className={`input ${pending ? "opacity-60" : ""}`}
          onChange={(e) => {
            const v = e.target.value;
            if (timer.current) clearTimeout(timer.current);
            // Debounced so typing a year digit by digit doesn't jump on every keystroke.
            if (isMonthKey(v) && v !== monthKey) timer.current = setTimeout(() => go(v, by), 450);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (timer.current) clearTimeout(timer.current);
            const v = e.currentTarget.value;
            if (isMonthKey(v) && v !== monthKey) go(v, by);
          }}
        />
      </div>
      <div>
        <label className="label" htmlFor="by">Reported by</label>
        <select
          id="by"
          defaultValue={by ?? ""}
          className="input min-w-36"
          onChange={(e) => go(monthKey, e.target.value || undefined)}
        >
          <option value="">Everyone</option>
          {reporters.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
    </>
  );
}
