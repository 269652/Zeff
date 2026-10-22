"use client";

import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { caseMoneyAction } from "../block-actions";
import { InlineAmount } from "./InlineAmount";

/**
 * A case's amount (or due day) as text — a click makes it a field: Enter or leaving it saves yours, Escape cancels, emptied it
 * takes yours back. `readOnly` (what the AI read off the case's letters and mails): shown only — it is what they say.
 */
export function EditMoney({ caseId, field, value, onSaved, className = "", readOnly = false }: { caseId: number; field: "total" | "open" | "installment" | "due"; value: number | string | null; onSaved: () => void; className?: string; readOnly?: boolean }) {
  const t = useT();
  if (readOnly) {
    const shown = value == null || value === "" ? "—" : field === "due" ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString() : Number(value).toLocaleString(undefined, { style: "currency", currency: "EUR" });
    return (
      <span className={`px-1 tabular-nums ${className}`} title={t("From the case's letters and mails")}>
        {shown}
      </span>
    );
  }
  return (
    <InlineAmount
      value={value}
      date={field === "due"}
      className={className}
      onSave={async (next) => {
        const r = await caseMoneyAction(caseId, { [field]: next });
        if (!r.ok) toast(r.error, { tone: "error" });
        else onSaved();
      }}
    />
  );
}
