"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { newsDigestAction, refreshNewsAction } from "./server-actions";

/** "Refresh" (fetch the sources now) and, with the overview on, "Overview now". */
export function NewsRefreshButtons({ digest }: { digest: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      toast(r.ok ? (r.message ?? t("Done.")) : (r.error ?? t("Didn't work.")), { tone: r.ok ? "ok" : "error" });
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(refreshNewsAction)}>
        {pending ? t("Fetching …") : t("Refresh")}
      </button>
      {digest && (
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(newsDigestAction)} title={t("The AI sums up the best unread items")}>
          {t("Overview now")}
        </button>
      )}
    </div>
  );
}
