"use client";

import { useState, useTransition } from "react";
import { branchOpAction } from "@/plugins/work/server-actions";
import type { BranchItem, BranchOp, BranchState } from "@/lib/branches";
import { toast } from "../Toaster";

const STATE_STYLE: Record<BranchState, string> = {
  dirty: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  unpushed: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  ahead: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  "no-mr": "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  "mr-open": "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  merged: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  gone: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};
const STATE_LABEL: Record<BranchState, string> = { dirty: "uncommitted", unpushed: "local only", ahead: "ahead", "no-mr": "no MR", "mr-open": "MR open", merged: "merged", gone: "gone on origin" };

/** The button a branch's state calls for (none for uncommitted changes: those are yours). */
const ACTION: Partial<Record<BranchState, { op: BranchOp; label: string; ask: (b: BranchItem) => string }>> = {
  unpushed: { op: "push", label: "Push", ask: (b) => `Push ${b.branch} to origin (${b.repo})?` },
  ahead: { op: "push", label: "Push", ask: (b) => `Push ${b.ahead} commit(s) of ${b.branch} to origin?` },
  "no-mr": { op: "open-mr", label: "Open MR", ask: (b) => `Open a merge request for ${b.branch} into the default branch?` },
  "mr-open": { op: "merge", label: "Merge", ask: (b) => `Merge !${b.mr?.iid} (${b.branch}) in GitLab?` },
  merged: { op: "delete", label: "Delete", ask: (b) => `Delete the local branch ${b.branch}? (It's merged.)` },
  gone: { op: "delete", label: "Delete", ask: (b) => `Delete the local branch ${b.branch}? Its remote is gone — commits only here would be lost.` },
};

function Row({ b }: { b: BranchItem }) {
  const [pending, start] = useTransition();
  const act = ACTION[b.state];
  const go = (op: BranchOp, ask?: string) => {
    if (ask && !window.confirm(ask)) return;
    start(async () => {
      const r = await branchOpAction(b.repoId, b.branch, op);
      toast(r?.ok ? (r.message ?? "Done.") : (r?.error ?? "Didn't work."), { tone: r?.ok ? "ok" : "error", ms: r?.ok ? 8000 : 15000 });
    });
  };
  return (
    <li className={`flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm ${b.ignored ? "opacity-60" : ""}`}>
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATE_STYLE[b.state]}`}>{STATE_LABEL[b.state]}</span>
      <span className="font-mono text-xs" title={b.checkedOutAt ? `Checked out in ${b.checkedOutAt}` : undefined}>
        {b.branch}
      </span>
      {b.mr && (
        <a href={b.mr.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-orange-700 hover:underline dark:text-orange-300">
          !{b.mr.iid} ↗
        </a>
      )}
      <span className="min-w-0 text-xs text-zinc-500">
        {b.todo}
        {b.lastCommit ? ` · ${new Date(b.lastCommit).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        {act && !b.ignored && (
          <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => go(act.op, act.ask(b))}>
            {pending ? "…" : act.label}
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => go(b.ignored ? "unignore" : "ignore")} title={b.ignored ? "List it again" : "Don't list this branch any more"}>
          {b.ignored ? "Show again" : "Ignore"}
        </button>
      </span>
    </li>
  );
}

/**
 * The repos' local branches that need something — uncommitted changes, commits to push, a merge
 * request to open or merge, a merged branch to delete — each with its button (asked first). Old
 * ones (no commit for 30 days) can be ignored at once; ignored ones fold away.
 */
export function BranchWork({ items }: { items: BranchItem[] }) {
  const [showIgnored, setShowIgnored] = useState(false);
  const [pending, start] = useTransition();
  const repos = [...new Set(items.map((b) => b.repoId))];
  if (!items.some((b) => !b.ignored)) return null;
  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase">Branches</h2>
      {repos.map((id) => {
        const list = items.filter((b) => b.repoId === id);
        const shown = list.filter((b) => !b.ignored);
        const ignored = list.filter((b) => b.ignored);
        const stale = shown.filter((b) => b.stale);
        return (
          <div key={id} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="font-semibold text-zinc-700 dark:text-zinc-200">{list[0].repo}</span>
              {stale.length > 0 && (
                <button
                  type="button"
                  className="text-indigo-600 hover:underline dark:text-indigo-400"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await branchOpAction(id, "", "ignore-stale");
                      toast(r?.ok ? (r.message ?? "Done.") : (r?.error ?? "Didn't work."), { tone: r?.ok ? "ok" : "error" });
                    })
                  }
                >
                  Ignore the {stale.length} older than 30 days
                </button>
              )}
              {ignored.length > 0 && (
                <button type="button" className="hover:underline" onClick={() => setShowIgnored(!showIgnored)}>
                  {showIgnored ? "Hide" : "Show"} ignored ({ignored.length})
                </button>
              )}
            </div>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {[...shown, ...(showIgnored ? ignored : [])].map((b) => (
                <Row key={b.branch} b={b} />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
