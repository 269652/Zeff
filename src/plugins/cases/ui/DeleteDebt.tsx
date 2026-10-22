"use client";

import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { deleteDebtAction } from "../block-actions";

/** A debt of your own removed — after a yes. */
export function DeleteDebt({ caseId, name, onDone }: { caseId: number; name: string; onDone: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="icon-btn icon-btn-danger print:hidden"
      title={t("Remove this debt")}
      aria-label={t("Remove the debt to {name}", { name })}
      onClick={async () => {
        if (!window.confirm(t("Remove the debt to {name}?", { name }))) return;
        const r = await deleteDebtAction(caseId);
        if (!r.ok) toast(r.error, { tone: "error" });
        else onDone();
      }}
    >
      ×
    </button>
  );
}
