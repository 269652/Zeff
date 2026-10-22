"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";

/**
 * An amount (or a date) as text — a click makes it a field: Enter or leaving it saves, Escape cancels, emptied it saves null
 * (what was there before you set it: the AI's, the statements'). `hint`: shown small beside it (where the figure is from).
 */
export function InlineAmount({ value, onSave, date = false, hint, className = "", digits = 2, empty = "—" }: { value: number | string | null; onSave: (v: number | string | null) => Promise<boolean | void> | boolean | void; date?: boolean; hint?: string; className?: string; digits?: number; /** Shown when there is no value. */ empty?: string }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  // What was just saved — shown until the new value comes back (else the old one would stand there meanwhile).
  const [saved, setSaved] = useState<{ v: number | string | null; over: number | string | null } | null>(null);
  const current = saved && saved.over === value ? saved.v : value;
  const shown = current == null || current === "" ? empty : date ? new Date(`${String(current).slice(0, 10)}T12:00:00`).toLocaleDateString() : Number(current).toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits });
  const save = async () => {
    setEditing(false);
    const raw = v.trim();
    let next: number | string | null = null;
    if (raw) {
      if (date) next = raw;
      else {
        const n = Number(raw.replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(n) || n < 0) return void toast(t("Not an amount — e.g. 11,52"), { tone: "error" });
        next = n;
      }
    }
    if (next === current) return;
    setSaved({ v: next, over: value });
    // Not saved (onSave says false or fails): the value before.
    const ok = await Promise.resolve(onSave(next)).catch(() => false);
    if (ok === false) setSaved(null);
  };
  if (editing)
    return (
      <input
        className={`input w-28 px-1.5 py-0.5 text-right text-sm tabular-nums ${className}`}
        type={date ? "date" : "text"}
        inputMode={date ? undefined : "decimal"}
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
        aria-label={t("Change")}
      />
    );
  return (
    <button
      type="button"
      className={`rounded px-1 tabular-nums hover:bg-zinc-100 hover:ring-1 hover:ring-zinc-200 dark:hover:bg-zinc-800 dark:hover:ring-zinc-700 print:hover:bg-transparent ${className}`}
      title={t("Click to change")}
      onClick={() => {
        setV(current == null ? "" : date ? String(current) : String(current).replace(".", ","));
        setEditing(true);
      }}
    >
      {shown}
      {hint && <span className="ml-1.5 text-xs font-normal text-zinc-500">{hint}</span>}
    </button>
  );
}
