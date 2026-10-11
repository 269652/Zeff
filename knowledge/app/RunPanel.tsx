"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export type RunState = {
  sync: boolean;
  compile: boolean;
  stopping: boolean;
  with: { backend: string; model: string } | null;
  compiled: number;
  pages: number;
};

/**
 * What runs now — reading, or compiling with which CLI and model, how far — following itself
 * (it asks every few seconds; the page around it stays as it is, a form half filled too), and
 * stopping it. When the run is over, the page shows the new state once.
 */
export function RunPanel({ initial, stop }: { initial: RunState; stop: () => Promise<void> }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  useEffect(() => {
    if (!s.sync && !s.compile) return;
    const t = setInterval(async () => {
      try {
        const r = (await (await fetch("/api/status", { cache: "no-store" })).json()) as {
          counts: { compiled: number; pages: number };
          running: { sync: boolean; compile: boolean; stopping?: boolean; compilingWith: { backend: string; model: string } | null };
        };
        const next = { sync: r.running.sync, compile: r.running.compile, stopping: !!r.running.stopping, with: r.running.compilingWith, compiled: r.counts.compiled, pages: r.counts.pages };
        setS(next);
        if (!next.sync && !next.compile) router.refresh();
      } catch {
        // the next time
      }
    }, 4000);
    return () => clearInterval(t);
  }, [s.sync, s.compile, router]);
  if (!s.sync && !s.compile) return null;
  const pct = s.pages ? Math.round((s.compiled / s.pages) * 100) : 0;
  return (
    <section className="card flex flex-wrap items-center gap-4 border-indigo-200 p-4 dark:border-indigo-900">
      <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-indigo-500" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium">
          {s.sync ? (
            "Reading the sources …"
          ) : (
            <>
              Compiling with {s.with?.backend === "claude" ? "Claude CLI" : "GitHub Copilot CLI"}
              <span className="font-normal text-zinc-500"> · model {s.with?.model || "the CLI's default"}</span>
            </>
          )}
          {s.stopping && <span className="font-normal text-amber-700 dark:text-amber-400"> — stopping once the running calls are done</span>}
        </p>
        {!s.sync && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div className="h-full rounded-full bg-indigo-500 transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <span className="tabular-nums">
              {s.compiled}/{s.pages} pages
            </span>
          </div>
        )}
      </div>
      <form
        action={async () => {
          setS((x) => ({ ...x, stopping: true }));
          await stop();
        }}
      >
        <button className="btn btn-danger" disabled={s.stopping}>
          {s.stopping ? "stopping …" : "Stop"}
        </button>
      </form>
    </section>
  );
}
