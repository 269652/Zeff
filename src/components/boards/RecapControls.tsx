"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { startRecapAction } from "@/plugins/todos/server-actions";

const PHASES: Record<string, string> = { gather: "sammelt den Tag", ai: "schreibt", saving: "speichert" };

const sinceText = (since: number) => {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** "Zusammenfassen" for a day: starts it on the server; while it runs, the page follows (refreshed every few seconds). */
export function RecapControls({ day, running, phase, since, provider, again }: { day: string; running: boolean; phase: string | null; since: number | null; provider: string; again: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!running) return;
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
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
          {since ? sinceText(since) : ""} · {phase === "ai" ? `${provider} ${PHASES.ai}` : (PHASES[phase ?? ""] ?? "läuft")}
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
            if (r && !r.ok) setError(r.error ?? "Ging nicht.");
            router.refresh();
          })
        }
        title="Sammelt, was du an dem Tag gemacht hast (Buchungen, Todos, Worker, Jira, Commits, GitLab), und lässt die KI aus den Einstellungen es zusammenfassen"
      >
        {running || pending ? "Läuft…" : again ? "Neu zusammenfassen" : "Zusammenfassen"}
      </button>
      {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
