"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { exportPackageAction } from "@/plugins/workspace/actions";

/**
 * "Export": the learning space as a package file — its databases with every row (courses, steps with your progress, exercises,
 * conversations, cards) and the links between them. Imported (the tree's "Import package"), it is a learning space again.
 */
export function ExportSpace({ pageId }: { pageId: number }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={busy}
      title={t("The learning space with its courses and progress as a file — import it in another Zeff or account")}
      onClick={async () => {
        setBusy(true);
        const r = await exportPackageAction(pageId, true).finally(() => setBusy(false));
        if (!r.ok) return void toast(r.error, { tone: "error" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([r.json], { type: "application/json;charset=utf-8" }));
        a.download = r.filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }}
    >
      📦 {busy ? t("Exporting …") : t("Export")}
    </button>
  );
}
