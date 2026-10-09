"use client";

import { useActionState, useState, useTransition } from "react";
import { deleteRepoAction, saveRepoAction, type ActionState } from "@/app/actions";
import type { RepoView } from "@/lib/repos";
import { SubmitButton } from "./SubmitButton";

export type RepoChoices = {
  projects: { project: string; url: string; folder: string | null }[];
  boards: { id: number; name: string; enabled: boolean; projectKey: string | null }[];
};

/**
 * A repo for workers — new (empty) or one to change: pick its GitLab project (the folder here
 * that looks like it, and its name, come along), the Jira boards whose tickets go there (the
 * synced ones first), single tickets, and what its workers should know.
 */
export function RepoForm({ repo, choices, onDone }: { repo?: RepoView; choices: RepoChoices; onDone?: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const r = await saveRepoAction(prev, fd);
    if (r?.ok && !repo) onDone?.();
    return r;
  }, null);
  const [project, setProject] = useState(repo?.gitlabProject ?? "");
  const [name, setName] = useState(repo?.name ?? "");
  const [folder, setFolder] = useState(repo?.path ?? "");
  const [deleting, startDelete] = useTransition();
  const id = repo ? `repo-${repo.id}` : "repo-new";
  const pick = (p: string) => {
    setProject(p);
    const hit = choices.projects.find((x) => x.project === p);
    if (!hit) return;
    if (!name.trim() || choices.projects.some((x) => x.project.split("/").pop() === name)) setName(p.split("/").pop() ?? "");
    if (!folder.trim() && hit.folder) setFolder(hit.folder);
  };
  const enabled = choices.boards.filter((b) => b.enabled);
  const others = choices.boards.filter((b) => !b.enabled);
  const board = (b: RepoChoices["boards"][number]) => (
    <label key={b.id} className="flex items-center gap-2 text-sm">
      <input type="checkbox" name="boards" value={b.id} defaultChecked={repo?.boards.includes(b.id)} className="accent-indigo-600" />
      <span>{b.name}</span>
      {b.projectKey && <span className="font-mono text-xs text-zinc-400">{b.projectKey}</span>}
    </label>
  );

  return (
    <form action={action} className="space-y-3">
      {repo && <input type="hidden" name="id" value={repo.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${id}-project`}>
            GitLab project
          </label>
          <select id={`${id}-project`} name="gitlabProject" className="input" value={project} onChange={(e) => pick(e.target.value)}>
            <option value="">— none —</option>
            {choices.projects.map((p) => (
              <option key={p.project} value={p.project}>
                {p.project}
              </option>
            ))}
            {project && !choices.projects.some((p) => p.project === project) && <option value={project}>{project}</option>}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${id}-name`}>
            Name
          </label>
          <input id={`${id}-name`} name="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="proj-bund" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`${id}-path`}>
          Folder on this machine
        </label>
        <input id={`${id}-path`} name="path" className="input font-mono text-xs" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="C:\Users\…\proj-bund" required />
        {repo && (
          <p className={`mt-1 text-xs ${repo.ok ? "text-zinc-500" : "text-red-600 dark:text-red-400"}`}>
            {repo.ok ? `A git repo — on ${repo.branch ?? "?"}.` : "Not a git repo (any more) — work can't go here."}
          </p>
        )}
      </div>
      <fieldset>
        <legend className="label">Jira boards whose tickets go here</legend>
        {choices.boards.length ? (
          <div className="grid gap-1 sm:grid-cols-2">{enabled.map(board)}</div>
        ) : (
          <p className="text-sm text-zinc-500">No boards yet — sync them on the Jira tab.</p>
        )}
        {others.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-zinc-500">Boards not synced ({others.length})</summary>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">{others.map(board)}</div>
          </details>
        )}
      </fieldset>
      <fieldset>
        <legend className="label">When work is done</legend>
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="delivery" value="mr" defaultChecked={(repo?.delivery ?? "mr") === "mr"} className="mt-1 accent-indigo-600" />
            <span>
              <span className="font-medium">Merge request</span>
              <span className="block text-xs text-zinc-500">Follow-ups: push it as a feature branch → open the MR → merge it once it&apos;s approved. Each a “Run”.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="delivery" value="direct" defaultChecked={repo?.delivery === "direct"} className="mt-1 accent-indigo-600" />
            <span>
              <span className="font-medium">Straight into the default branch</span>
              <span className="block text-xs text-zinc-500">One follow-up: merge it into main (in a worktree of its own — your checkout stays as it is) and push.</span>
            </span>
          </label>
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor={`${id}-tickets`}>
          Single tickets (before their board&apos;s repo)
        </label>
        <input id={`${id}-tickets`} name="tickets" className="input font-mono text-xs" defaultValue={repo?.tickets.join(", ")} placeholder="PROJ-321, PROJ-400" />
      </div>
      <div>
        <label className="label" htmlFor={`${id}-instructions`}>
          What its workers should know
        </label>
        <textarea
          id={`${id}-instructions`}
          name="instructions"
          rows={2}
          className="input text-sm"
          defaultValue={repo?.instructions}
          placeholder="e.g. Tests: npm run test:e2e in packages/proj-core/Build (needs Storybook on :6006)."
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={pending}>{repo ? "Save" : "Add repo"}</SubmitButton>
        {repo && (
          <button
            type="button"
            className="btn btn-sm text-red-700 dark:text-red-400"
            disabled={deleting}
            onClick={() => {
              if (window.confirm(`Remove ${repo.name}? (Its folder stays as it is.)`)) startDelete(async () => void (await deleteRepoAction(repo.id)));
            }}
          >
            Remove
          </button>
        )}
        {state?.ok && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
        {state && !state.ok && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
      </div>
    </form>
  );
}
