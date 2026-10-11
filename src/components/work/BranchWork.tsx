"use client";

import { useState, useTransition } from "react";
import { branchOpAction } from "@/plugins/work/server-actions";
import type { BranchItem, BranchOp, BranchState } from "@/lib/branches";
import { toast } from "../Toaster";
import { formatDate } from "@/lib/format";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";

const STATE_STYLE: Record<BranchState, string> = {
  dirty: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  unpushed: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  ahead: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  "no-mr": "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  "mr-open": "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  merged: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  gone: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};
const stateLabels = (t: T): Record<BranchState, string> => ({
  dirty: t("uncommitted"),
  unpushed: t("local only"),
  ahead: t("ahead"),
  "no-mr": t("no MR"),
  "mr-open": t("MR open"),
  merged: t("merged"),
  gone: t("gone on origin"),
});

/** The button a branch's state calls for (none for uncommitted changes: those are yours). */
const actions = (t: T): Partial<Record<BranchState, { op: BranchOp; label: string; ask: (b: BranchItem) => string }>> => ({
  unpushed: { op: "push", label: t("Push"), ask: (b) => t("Push {branch} to origin ({repo})?", { branch: b.branch, repo: b.repo }) },
  ahead: { op: "push", label: t("Push"), ask: (b) => t("Push {n} commit(s) of {branch} to origin?", { n: b.ahead, branch: b.branch }) },
  "no-mr": { op: "open-mr", label: t("Open MR"), ask: (b) => t("Open a merge request for {branch} into the default branch?", { branch: b.branch }) },
  "mr-open": { op: "merge", label: t("Merge"), ask: (b) => t("Merge !{iid} ({branch}) in GitLab?", { iid: b.mr?.iid, branch: b.branch }) },
  merged: { op: "delete", label: t("Delete"), ask: (b) => t("Delete the local branch {branch}? (It's merged.)", { branch: b.branch }) },
  gone: {
    op: "delete",
    label: t("Delete"),
    ask: (b) => t("Delete the local branch {branch}? Its remote is gone — commits only here would be lost.", { branch: b.branch }),
  },
});

function Row({ b }: { b: BranchItem }) {
  const t = useT();
  const [pending, start] = useTransition();
  const act = actions(t)[b.state];
  const go = (op: BranchOp, ask?: string) => {
    if (ask && !window.confirm(ask)) return;
    start(async () => {
      const r = await branchOpAction(b.repoId, b.branch, op);
      toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error", ms: r?.ok ? 8000 : 15000 });
    });
  };
  return (
    <li className={`flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm ${b.ignored ? "opacity-60" : ""}`}>
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATE_STYLE[b.state]}`}>{stateLabels(t)[b.state]}</span>
      <span className="font-mono text-xs" title={b.checkedOutAt ? t("Checked out in {path}", { path: b.checkedOutAt }) : undefined}>
        {b.branch}
      </span>
      {b.mr && (
        <a href={b.mr.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-orange-700 hover:underline dark:text-orange-300">
          !{b.mr.iid} ↗
        </a>
      )}
      <span className="min-w-0 text-xs text-zinc-500">
        {b.todo}
        {b.lastCommit ? ` · ${formatDate(b.lastCommit, { weekday: false })}` : ""}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        {act && !b.ignored && (
          <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => go(act.op, act.ask(b))}>
            {pending ? "…" : act.label}
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => go(b.ignored ? "unignore" : "ignore")} title={b.ignored ? t("List it again") : t("Don't list this branch any more")}>
          {b.ignored ? t("Show again") : t("Ignore")}
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
  const t = useT();
  const [showIgnored, setShowIgnored] = useState(false);
  const [pending, start] = useTransition();
  const repos = [...new Set(items.map((b) => b.repoId))];
  if (!items.some((b) => !b.ignored)) return null;
  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Branches")}</h2>
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
                      toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
                    })
                  }
                >
                  {t("Ignore the {n} older than 30 days", { n: stale.length })}
                </button>
              )}
              {ignored.length > 0 && (
                <button type="button" className="hover:underline" onClick={() => setShowIgnored(!showIgnored)}>
                  {showIgnored ? t("Hide ignored ({n})", { n: ignored.length }) : t("Show ignored ({n})", { n: ignored.length })}
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
