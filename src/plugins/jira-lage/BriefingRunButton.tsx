"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { runBoardAction } from "@/plugins/todos/server-actions";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { formatDateTime } from "@/lib/format";
import type { RichBoard } from "@/plugins/kanban/shared";

/**
 * "My briefing"'s run: the briefing itself (the Todos tab's "Jetzt auswerten" — Jira synced first, then the
 * tickets through the AI), whose tickets these cards are. The page follows it while it goes.
 */
export function BriefingRunButton({ state }: { state: NonNullable<RichBoard["briefing"]> }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const running = state.running || pending;
  useEffect(() => {
    if (!state.running) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [state.running, router]);
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={running}
        title={t("Syncs Jira first, then the briefing reads your tickets with everything Zeff knows — the cards fill in when it's done")}
        onClick={() =>
          start(async () => {
            const r = await runBoardAction();
            toast(r?.ok ? (r.message ?? t("Running.")) : (r?.error ?? t("That didn't work.")), { tone: r?.ok ? "ok" : "error" });
            router.refresh();
          })
        }
      >
        {running ? (
          <>
            <span className="size-2 animate-pulse rounded-full bg-white" aria-hidden /> {t("Briefing running …")}
          </>
        ) : (
          t("Run the briefing")
        )}
      </button>
      {state.lastAt && !running && <p className="text-xs text-zinc-500">{t("Last briefing: {when}", { when: formatDateTime(state.lastAt) })}</p>}
    </div>
  );
}
