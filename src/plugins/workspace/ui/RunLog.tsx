"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { pipelineRunsAction } from "../actions";
import type { PipelineRun } from "../pipeline";

/** How one run went, in a line: what it did to the rows, what the AI did, how long. */
export function RunLine({ r }: { r: Pick<PipelineRun, "at" | "ms" | "ok" | "error" | "created" | "updated" | "archived" | "reviewed" | "judged" | "kept" | "aiCalls" | "costUsd"> }) {
  const t = useT();
  const parts = [
    r.created || r.updated || r.archived ? t("{c} new · {u} changed · {a} gone", { c: r.created, u: r.updated, a: r.archived }) : t("no changes"),
    ...(r.judged ? [t("{j} judged, {k} kept", { j: r.judged, k: r.kept })] : []),
    ...(r.reviewed ? [t("{n} AI fields filled", { n: r.reviewed })] : []),
    ...(r.aiCalls ? [`${r.aiCalls} ${t("AI calls")}${r.costUsd ? ` · $${r.costUsd.toFixed(3)}` : ""}`] : []),
    `${r.ms < 1000 ? `${r.ms} ms` : `${(r.ms / 1000).toFixed(1)} s`}`,
  ];
  return (
    <span className={r.ok ? "" : "text-rose-600 dark:text-rose-400"}>
      <span className="text-zinc-400">{new Date(r.at).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span> {r.ok ? "✓" : "✗"} {r.ok ? parts.join(" · ") : (r.error ?? t("failed"))}
    </span>
  );
}

/** A pipeline's last runs (in the steps editor): what each did and what the AI in it cost. */
export function RunLog({ dbId, tick }: { dbId: number; tick: number }) {
  const t = useT();
  const [runs, setRuns] = useState<PipelineRun[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void pipelineRunsAction(dbId).then((r) => live && r.ok && setRuns(r.runs));
    return () => {
      live = false;
    };
  }, [dbId, tick]);
  if (!runs?.length) return null;
  const spent = runs.reduce((n, r) => n + r.costUsd, 0);
  return (
    <div className="rounded-lg border border-zinc-200 text-sm dark:border-zinc-800" data-run-log>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="font-medium">{t("Runs")}</span>
        <span className="min-w-0 flex-1 truncate text-zinc-500">
          <RunLine r={runs[0]} />
        </span>
        {spent > 0 && <span className="shrink-0 text-xs text-zinc-500">${spent.toFixed(2)}</span>}
        <span aria-hidden className="text-zinc-400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <ul className="space-y-0.5 border-t border-zinc-100 px-3 py-2 text-xs dark:border-zinc-800">
          {runs.map((r) => (
            <li key={r.id}>
              <RunLine r={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
