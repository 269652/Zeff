"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { caseMoneyAction } from "../block-actions";

/**
 * A case's amount (or due day) as text — a click makes it a field: Enter or leaving it saves yours (it stays over what the AI
 * sums up later), Escape cancels, emptied it takes yours back.
 */
export function EditMoney({ caseId, field, value, onSaved, className = "" }: { caseId: number; field: "total" | "open" | "installment" | "due"; value: number | string | null; onSaved: () => void; className?: string }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  const date = field === "due";
  const shown = value == null || value === "" ? "—" : date ? new Date(String(value)).toLocaleDateString() : Number(value).toLocaleString(undefined, { style: "currency", currency: "EUR" });
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
    const r = await caseMoneyAction(caseId, { [field]: next });
    if (!r.ok) toast(r.error, { tone: "error" });
    else onSaved();
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
    </button>
  );
}
