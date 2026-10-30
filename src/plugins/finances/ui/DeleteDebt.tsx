"use client";

import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { deleteDebtAction } from "../server-actions";

/** A debt of your own removed — after a yes. */
export function DeleteDebt({ rowId, name, onDone }: { rowId: number; name: string; onDone: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="icon-btn icon-btn-danger print:hidden"
      title={t("Remove this debt")}
      aria-label={t("Remove the debt to {name}", { name })}
      onClick={async () => {
        if (!confirmAction(t("Remove the debt to {name}?", { name }))) return;
        const r = await deleteDebtAction(rowId);
        if (!r.ok) toast(r.error, { tone: "error" });
        else onDone();
      }}
    >
      ×
    </button>
  );
}
