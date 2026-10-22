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
  const shown = value == null || value === "" ? empty : date ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString() : Number(value).toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits });
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
    if (next === value) return;
    await onSave(next);
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
        setV(value == null ? "" : date ? String(value) : String(value).replace(".", ","));
        setEditing(true);
      }}
    >
      {shown}
      {hint && <span className="ml-1.5 text-xs font-normal text-zinc-500">{hint}</span>}
    </button>
  );
}
