"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { FormError } from "@/components/FormError";
import { toast } from "@/components/Toaster";
import { switchSessionBranchAction } from "@/plugins/work/server-actions";

type Branches = { ok: true; root: string; current: string | null; branches: { name: string; remote: boolean; current: boolean; worktree: string | null }[] } | { ok: false; error: string };

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/**
 * Where a session works, like Claude Code's status line: its repo folder and branch - with the
 * branch switcher (when the session is idle; nothing uncommitted, not a branch checked out
 * elsewhere). `worktree`: it works in a worktree of its own.
 */
export function SessionBranch({ runId, repo, cwd, branch, worktree, idle }: { runId: number; repo: string | null; cwd: string | null; branch: string | null; worktree: boolean; idle: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ cwd: string; data: Branches } | null>(null);
  const list = loaded && loaded.cwd === cwd ? loaded.data : null;
  const [pending, start] = useTransition();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open || !cwd) return;
    let live = true;
    fetch(`/api/work/branches?path=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((j: Branches) => live && setLoaded({ cwd, data: j }))
      .catch(() => live && setLoaded({ cwd, data: { ok: false, error: "Couldn't read the branches." } }));
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => {
      live = false;
      document.removeEventListener("mousedown", away);
    };
  }, [open, cwd]);
  if (!repo && !branch) return null;
  const switchTo = (name: string) =>
    start(async () => {
      const r = await switchSessionBranchAction(runId, name);
      if (!r.ok) return void toast(r.error, { tone: "error" });
      toast(`Now on ${r.branch}.`);
      setOpen(false);
      router.refresh();
    });
  return (
    <span ref={ref} className="relative inline-flex items-center gap-1">
      {repo && (
        <span className="font-mono" title={cwd && cwd !== repo ? `${repo}\n${cwd}` : repo}>
          📁 {base(repo)}
        </span>
      )}
      {branch && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-px font-mono hover:bg-zinc-200 disabled:cursor-default disabled:hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:disabled:hover:bg-zinc-800"
          onClick={() => setOpen((o) => !o)}
          disabled={!idle || !cwd}
          title={idle ? "Switch the branch of this session" : "Working - switch the branch once it has answered"}
          aria-label="Branch"
        >
          ⎇ {branch}
          {worktree && <span className="rounded bg-indigo-100 px-1 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">worktree</span>}
          {idle && cwd && <span aria-hidden>▾</span>}
        </button>
      )}
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {!list && <p className="px-2 py-1 text-zinc-400">Loading …</p>}
          {list && !list.ok && <FormError as="p" className="px-2 py-1">{list.error}</FormError>}
          {list?.ok &&
            list.branches.map((b) => (
              <button
                key={b.name}
                type="button"
                className="flex w-full items-center gap-1 rounded px-2 py-1 text-left hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                disabled={pending || b.current || !!b.worktree}
                title={b.worktree ? `Checked out in ${b.worktree}` : undefined}
                onClick={() => switchTo(b.name)}
              >
                <span className="w-3 text-emerald-600">{b.current ? "✓" : ""}</span>
                <span className="min-w-0 flex-1 truncate font-mono">{b.name}</span>
                {b.remote && <span className="text-zinc-400">remote</span>}
                {b.worktree && <span className="text-zinc-400">worktree</span>}
              </button>
            ))}
        </div>
      )}
    </span>
  );
}
