"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { collectIntoHeadAction } from "@/app/entry-group-actions";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";

/** "Collect N parallel entries": the day's other entries that run parallel to the collecting entry are grouped under it. */
export function CollectGroupButton({ headId, count }: { headId: number; count: number }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!count) return null;
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await collectIntoHeadAction(headId);
          toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
          router.refresh();
        })
      }
      title={t("Groups this day's other entries that run parallel to it under it — they keep their real hours and evidence, and the collecting entry books the hours.")}
    >
      {count === 1 ? t("Collect 1 parallel entry") : t("Collect {n} parallel entries", { n: count })}
    </button>
  );
}
