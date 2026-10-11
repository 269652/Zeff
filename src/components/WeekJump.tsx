"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { useT } from "@/components/I18nProvider";

const isWeekKey = (v: string) => /^\d{4}-W\d{2}$/.test(v);

/**
 * "Jump to week" and "Reported by" on the weekly page: they navigate as soon as a week
 * is picked (or on Enter) / a reporter is chosen — no Apply button.
 */
export function WeekJump({ weekKey, by, reporters }: { weekKey: string; by?: string; reporters: string[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const go = (w: string, r?: string) =>
    start(() => router.push(`/?week=${w}${r ? `&by=${encodeURIComponent(r)}` : ""}`));

  return (
    <>
      <div>
        <label className="label" htmlFor="week">{t("Jump to week")}</label>
        <input
          id="week"
          type="week"
          defaultValue={weekKey}
          className={`input ${pending ? "opacity-60" : ""}`}
          onChange={(e) => {
            const v = e.target.value;
            if (timer.current) clearTimeout(timer.current);
            // Debounced so typing "35" doesn't jump to week 3 first; picking from the calendar jumps right after.
            if (isWeekKey(v) && v !== weekKey) timer.current = setTimeout(() => go(v, by), 450);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (timer.current) clearTimeout(timer.current);
            const v = e.currentTarget.value;
            if (isWeekKey(v) && v !== weekKey) go(v, by);
          }}
        />
      </div>
      <div>
        <label className="label" htmlFor="by">{t("Reported by")}</label>
        <select
          id="by"
          defaultValue={by ?? ""}
          className="input min-w-36"
          onChange={(e) => go(weekKey, e.target.value || undefined)}
        >
          <option value="">{t("Everyone")}</option>
          {reporters.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
    </>
  );
}
