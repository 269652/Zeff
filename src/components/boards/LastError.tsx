"use client";

import { useTransition } from "react";
import { dismissRunErrorAction, retryRunAction } from "@/plugins/work/server-actions";
import { toast } from "../Toaster";
import { useT } from "@/components/I18nProvider";

/** Why the todo's last run failed — try it again (as it was asked for), or put the error away. */
export function LastError({ text, run }: { text: string; run?: number }) {
  const t = useT();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string } | null | undefined>) =>
    start(async () => {
      const r = await fn();
      if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
      else if (r.message) toast(r.message);
    });
  return (
    <span className="mt-1 flex items-start gap-2 text-xs text-red-600 dark:text-red-400" title={text}>
      <span className="min-w-0 flex-1">✗ {t("Last attempt failed: {error}", { error: text })}</span>
      {run !== undefined && (
        <span className="flex shrink-0 gap-1">
          <button type="button" className="rounded border border-red-300 px-1.5 font-medium hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:hover:bg-red-950" disabled={pending} onClick={() => act(() => retryRunAction(run))} title={t("Start the run once more — as it was meant (your ✨ instruction too)")}>
            {t("Retry")}
          </button>
          <button type="button" className="rounded px-1.5 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950" disabled={pending} onClick={() => act(() => dismissRunErrorAction(run))} title={t("Hide the error")} aria-label={t("Hide the error")}>
            ×
          </button>
        </span>
      )}
    </span>
  );
}
