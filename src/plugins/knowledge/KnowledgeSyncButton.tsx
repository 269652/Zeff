"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { knowledgeSyncAction } from "@/plugins/knowledge/server-actions";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

/** Read the sources now (and compile what's new) — on the knowledge server, in the background. */
export function KnowledgeSyncButton({ busy }: { busy: boolean }) {
  const t = useT();
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={pending || busy}
      onClick={() =>
        start(async () => {
          const r = await knowledgeSyncAction();
          toast(r?.ok ? (r.message ?? t("Running.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error" });
          router.refresh();
        })
      }
    >
      {busy ? t("running …") : t("Read the sources now")}
    </button>
  );
}
