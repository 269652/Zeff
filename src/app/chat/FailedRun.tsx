"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { chatSendAction } from "./actions";

/**
 * A chat whose last run failed (Docker not running, the CLI not signed in …): said, with why — it answered nothing, and
 * nobody was told — and "Try again", which sends your last message once more (the conversation goes on where it was).
 */
export function FailedRun({ runId, error, text }: { runId: number; error: string | null; text: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="alert" className="mb-2 flex flex-col gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <p className="font-medium">{t("This didn't get an answer — the run failed.")}</p>
      {error && <p className="text-xs break-words whitespace-pre-wrap opacity-90">{error.slice(0, 600)}</p>}
      {text.trim() && (
        <div>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await chatSendAction({ text, runId }).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
                if (!r.ok) return void toast(r.error, { tone: "error" });
                router.refresh();
              })
            }
          >
            {pending ? t("Sending …") : t("Try again")}
          </button>
        </div>
      )}
    </div>
  );
}
