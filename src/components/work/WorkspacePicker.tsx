"use client";

import { useEffect, useRef, useState } from "react";

/** What a new session works in: a folder in a git repo, the branch, and how (a worktree of its own, or the repo itself). */
export type Workspace = { path: string; branch: string; mode: "" | "worktree" | "branch" | "checkout" };
export const NO_WORKSPACE: Workspace = { path: "", branch: "", mode: "" };

type Listing = { ok: true; path: string; parent: string | null; dirs: { name: string; path: string; repo: boolean }[]; repo: boolean } | { ok: false; error: string };
type Branches = { ok: true; root: string; current: string | null; branches: { name: string; remote: boolean; current: boolean; worktree: string | null }[] } | { ok: false; error: string };

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const MODES: { id: Workspace["mode"]; label: string; hint: string }[] = [
  { id: "", label: "Default isolation", hint: "As set in the Work settings" },
  { id: "worktree", label: "New branch in a worktree", hint: "A new zeff/ branch from the chosen one, in a folder of its own - your checkout stays untouched" },
  { id: "branch", label: "This branch in a worktree", hint: "Work goes on the chosen branch itself, in a folder of its own" },
  { id: "checkout", label: "In the repo itself", hint: "Directly in the checkout (switches it to the chosen branch if nothing is uncommitted)" },
];

/** The folder picker: your registered repos and a browser through your folders. */
function FolderPopover({ repos, value, onPick, onClose }: { repos: { id: number; name: string; path: string }[]; value: string; onPick: (path: string) => void; onClose: () => void }) {
  const [list, setList] = useState<Listing | null>(null);
  const [typed, setTyped] = useState("");
  const load = (p: string) => {
    fetch(`/api/work/folders?path=${encodeURIComponent(p)}`)
      .then((r) => r.json())
      .then((j: Listing) => {
        setList(j);
        if (j.ok) setTyped(j.path);
      })
      .catch(() => setList({ ok: false, error: "Couldn't list the folder." }));
  };
  useEffect(() => load(value || ""), []); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);
  return (
    <div ref={ref} className="absolute bottom-full left-0 z-30 mb-1 w-96 max-w-[90vw] rounded-lg border border-zinc-200 bg-white p-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <button type="button" className="mb-1 block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => onPick("")}>
        The ticket&apos;s repo <span className="text-zinc-400">(default)</span>
      </button>
      {repos.length > 0 && (
        <div className="mb-1 border-b border-zinc-100 pb-1 dark:border-zinc-800">
          <div className="px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">Your repos</div>
          {repos.map((r) => (
            <button key={r.id} type="button" className="block w-full truncate rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" title={r.path} onClick={() => onPick(r.path)}>
              {r.name} <span className="text-zinc-400">{r.path}</span>
            </button>
          ))}
        </div>
      )}
      <form
        className="flex gap-1 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          load(typed);
        }}
      >
        <input className="min-w-0 flex-1 rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 font-mono dark:border-zinc-700" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Folder" />
        <button type="submit" className="btn btn-sm">
          Go
        </button>
      </form>
      {list && !list.ok && <p className="px-1 py-1 text-red-600 dark:text-red-400">{list.error}</p>}
      {list?.ok && (
        <>
          <div className="flex items-center gap-1 pb-1">
            {list.parent !== null && (
              <button type="button" className="rounded px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => load(list.parent!)} aria-label="Up">
                ↑ ..
              </button>
            )}
            <span className="min-w-0 flex-1 truncate text-zinc-500" title={list.path}>
              {list.path || "Drives"}
            </span>
            {list.repo && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onPick(list.path)}>
                Use this repo
              </button>
            )}
          </div>
          <ul className="max-h-56 overflow-y-auto">
            {list.dirs.map((d) => (
              <li key={d.path} className="flex items-center">
                <button type="button" className="min-w-0 flex-1 truncate rounded px-2 py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => load(d.path)}>
                  {d.repo ? "⎇ " : "📁 "}
                  {d.name}
                </button>
                {d.repo && (
                  <button type="button" className="rounded px-1.5 py-0.5 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950" onClick={() => onPick(d.path)}>
                    use
                  </button>
                )}
              </li>
            ))}
            {!list.dirs.length && <li className="px-2 py-1 text-zinc-400">No sub-folders.</li>}
          </ul>
        </>
      )}
    </div>
  );
}

/** For a new session: pick the repo folder, the branch and how to work there. */
export function WorkspacePicker({ repos, value, onChange, selectClass }: { repos: { id: number; name: string; path: string }[]; value: Workspace; onChange: (w: Workspace) => void; selectClass: string }) {
  const [open, setOpen] = useState(false);
  // The branches of the folder asked about (kept with it: a stale answer for another folder isn't shown).
  const [loaded, setLoaded] = useState<{ path: string; data: Branches } | null>(null);
  const branches = loaded && loaded.path === value.path ? loaded.data : null;
  useEffect(() => {
    if (!value.path) return;
    let live = true;
    const path = value.path;
    fetch(`/api/work/branches?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((j: Branches) => live && setLoaded({ path, data: j }))
      .catch(() => live && setLoaded({ path, data: { ok: false, error: "Couldn't read the branches." } }));
    return () => {
      live = false;
    };
  }, [value.path]);
  const mode = MODES.find((m) => m.id === value.mode) ?? MODES[0];
  return (
    <>
      <span className="relative">
        <button type="button" className={`${selectClass} max-w-52 truncate`} onClick={() => setOpen((o) => !o)} title={value.path || "The repo of the ticket"} aria-label="Repo folder">
          📁 {value.path ? base(value.path) : "Repo: the ticket's"}
        </button>
        {open && (
          <FolderPopover
            repos={repos}
            value={value.path}
            onClose={() => setOpen(false)}
            onPick={(path) => {
              onChange({ path, branch: "", mode: value.mode });
              setOpen(false);
            }}
          />
        )}
      </span>
      {value.path && branches?.ok && (
        <select className={`${selectClass} max-w-48`} value={value.branch} onChange={(e) => onChange({ ...value, branch: e.target.value })} aria-label="Branch" title={mode.id === "branch" ? "The branch the work goes on" : "The branch to start from"}>
          <option value="">⎇ {branches.current ? `${branches.current} (current)` : "default branch"}</option>
          {branches.branches.map((b) => (
            <option key={b.name} value={b.name} disabled={value.mode === "branch" && (!!b.worktree || b.current)}>
              {b.name}
              {b.remote ? " (remote)" : ""}
              {b.worktree ? " - in a worktree" : b.current ? " - checked out" : ""}
            </option>
          ))}
        </select>
      )}
      {value.path && branches && !branches.ok && <span className="px-1 text-[11px] text-red-600 dark:text-red-400">{branches.error}</span>}
      {value.path && (
        <select className={`${selectClass} max-w-52`} value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as Workspace["mode"] })} aria-label="Isolation" title={mode.hint}>
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
