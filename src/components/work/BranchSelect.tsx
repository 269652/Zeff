"use client";

import { useState, useTransition } from "react";
import { switchRepoBranchAction } from "@/plugins/work/server-actions";
import { toast } from "../Toaster";

/**
 * A repo's checked-out branch as a small dropdown of its local branches: choosing one switches
 * the checkout (asked first; git refuses — and says why — when what's not committed is in the way).
 */
export function BranchSelect({ repoId, repo, path, branch, branches }: { repoId: number; repo: string; path: string; branch: string; branches: string[] }) {
  const [value, setValue] = useState(branch);
  const [from, setFrom] = useState(branch);
  if (from !== branch) {
    setFrom(branch);
    setValue(branch);
  }
  const [pending, start] = useTransition();
  const list = branches.includes(branch) ? branches : [branch, ...branches];
  return (
    <label
      className="inline-flex max-w-72 items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      title={`Checked out now in ${path} — pick another local branch to switch to it. (Workers start from the ticket's own branch, else the default branch, in a worktree of their own.)`}
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className="size-3 shrink-0" aria-hidden>
        <circle cx="6" cy="4.5" r="1.75" />
        <circle cx="6" cy="15.5" r="1.75" />
        <circle cx="14" cy="7" r="1.75" />
        <path d="M6 6.25v7.5M14 8.75c0 3-4.5 2.5-7.25 5.25" />
      </svg>
      <span className="sr-only">Branch of {repo}</span>
      <select
        className="min-w-0 max-w-64 cursor-pointer truncate bg-transparent outline-none disabled:cursor-wait"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          if (next === value) return;
          if (!window.confirm(`Switch ${repo} (${path}) from ${value} to ${next}?`)) return;
          setValue(next);
          start(async () => {
            const r = await switchRepoBranchAction(repoId, next);
            if (r?.ok) toast(`${repo}: ${r.message}`);
            else {
              setValue(branch);
              toast(r?.error ?? "Couldn't switch.", { tone: "error", ms: 15000 });
            }
          });
        }}
      >
        {list.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
    </label>
  );
}
