"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { FunnelProgress } from "./funnel";
import { newsFunnelAction, newsFunnelStatusAction } from "./server-actions";

/**
 * "Let the agent look now": the agent works through what is waiting in the background, round after round. The button says how far
 * it is; when it is through, it says what came of it and the page's numbers are read again — the page doesn't follow by itself,
 * so that nothing moves while you read.
 */
export function FunnelButton({ className = "" }: { className?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<FunnelProgress | null>(null);
  const running = !!progress?.running;
  const wasRunning = useRef(false);

  useEffect(() => {
    let live = true;
    const ask = async () => {
      const p = await newsFunnelStatusAction().catch(() => null);
      if (!live || !p) return;
      setProgress(p);
      if (wasRunning.current && !p.running) {
        if (p.error) toast(p.error, { tone: "error" });
        else if (!p.judged) toast(t("Nothing to read right now — no new headlines are waiting for the agent."));
        else toast(t("The agent read {n} headlines: {p} let through, {d} filtered out.", { n: p.judged, p: p.passed + p.top, d: p.dropped }));
        router.refresh();
      }
      wasRunning.current = p.running;
    };
    void ask();
    if (!running) return () => void (live = false);
    const timer = setInterval(ask, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [running, router, t]);

  const pct = progress?.total ? Math.min(100, Math.round((progress.judged / progress.total) * 100)) : 0;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={`btn btn-sm ${className}`}
        disabled={pending || running}
        title={t("The agent reads the best new headlines it hasn't seen yet now, instead of after the next fetch")}
        onClick={() =>
          start(async () => {
            const r = await newsFunnelAction();
            if (!r.ok) return void toast(r.error ?? t("Didn't work."), { tone: "error" });
            wasRunning.current = true;
            setProgress(await newsFunnelStatusAction());
          })
        }
      >
        🔎 {running ? t("The agent is reading … {n} of {total}", { n: progress?.judged ?? 0, total: progress?.total ?? 0 }) : t("Let the agent look now")}
      </button>
      {running && (
        <span className="block h-1.5 w-24 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("Let the agent look now")}>
          <span className="block h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  );
}
