"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { startRecapAction } from "@/plugins/todos/server-actions";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";

const phases = (t: T): Record<string, string> => ({ gather: t("gathering the day"), ai: t("writing"), saving: t("saving") });

const sinceText = (since: number) => {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** "Zusammenfassen" for a day: starts it on the server; while it runs, the page follows (refreshed every few seconds). */
export function RecapControls({ day, running, phase, since, provider, again }: { day: string; running: boolean; phase: string | null; since: number | null; provider: string; again: boolean }) {
  const t = useT();
  const PHASES = phases(t);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!running) return;
    const clock = setInterval(() => setTick((n) => n + 1), 1000);
    const follow = setInterval(() => router.refresh(), 4000);
    return () => {
      clearInterval(clock);
      clearInterval(follow);
    };
  }, [running, router]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {running && (
        <span className="inline-flex items-center gap-2 text-sm text-zinc-500" role="status">
          <span className="size-2 animate-pulse rounded-full bg-indigo-500" aria-hidden />
          {since ? sinceText(since) : ""} · {phase === "ai" ? t("{provider} writing", { provider }) : (PHASES[phase ?? ""] ?? t("running"))}
        </span>
      )}
      <button
        type="button"
        className="btn btn-primary"
        disabled={running || pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startRecapAction(day);
            if (r && !r.ok) setError(r.error ?? t("Didn't work."));
            router.refresh();
          })
        }
        title={t("Gathers what you did that day (entries, todos, workers, Jira, commits, GitLab) and has the AI from the settings summarize it")}
      >
        {running || pending ? t("Running…") : again ? t("Summarize again") : t("Summarize")}
      </button>
      {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
