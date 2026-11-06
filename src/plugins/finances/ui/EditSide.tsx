"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { ContactField, type ContactOption } from "@/plugins/cases/ui/ContactField";
import { debtSideAction } from "../server-actions";

/** Who is on the other side of a debt: ✎ beside the name opens a contact field — a contact picked, or a new one, and it is changed. */
export function EditSide({ rowId, value, contacts, onSaved }: { rowId: number; value: number | null; contacts: ContactOption[]; onSaved: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const save = async (side: { creditorId: number } | { creditorName: string; creditorKind: ContactOption["kind"] }) => {
    const r = await debtSideAction(rowId, side);
    if (!r.ok) return toast(r.error, { tone: "error" });
    setOpen(false);
    onSaved();
  };
  return (
    <span className="relative print:hidden">
      <button type="button" className="icon-btn" title={t("Change the other side")} aria-label={t("Change the other side")} aria-expanded={open} onClick={() => setOpen(!open)}>
        ✎
      </button>
      {open && (
        <span className="absolute top-full left-0 z-20 mt-1 block w-72 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <ContactField contacts={contacts} value={value} label={t("Other side")} placeholder={t("Person, bank, collection agency …")} onPick={(id) => (id ? void save({ creditorId: id }) : undefined)} onNew={(name, kind) => void save({ creditorName: name, creditorKind: kind })} />
        </span>
      )}
    </span>
  );
}
