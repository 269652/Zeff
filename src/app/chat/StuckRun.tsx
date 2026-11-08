"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { cancelWorkAction } from "@/plugins/work/server-actions";

/**
 * A chat whose session Zeff lost (it says "running", but no live session answers — after Zeff restarted or reloaded):
 * the messages after it would wait for it forever. Ending it frees them; the next message resumes the conversation.
 */
export function StuckRun({ runId }: { runId: number }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" role="status">
      <span className="min-w-0 flex-1">{t("The session isn't connected any more. End it, then write again — the conversation goes on where it was.")}</span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await cancelWorkAction(runId);
            if (r && !r.ok) return void toast(r.error ?? "", { tone: "error" });
            router.refresh();
          })
        }
      >
        {t("End the session")}
      </button>
    </div>
  );
}
