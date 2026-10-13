import { getPref, setPref } from "@/lib/prefs";
import { listRepos, repoForTicket, type RepoView } from "@/lib/repos";
import type { TodoLink } from "./shared";

const KEY = "knowledge.repoSystems";

/** The systems (Prod, Test/Stage, Dev) of a repo, as the AI read them from the knowledge — and what it read them for. */
export type RepoSystems = { at: string; basis: string; systems: TodoLink[] };

const all = () => getPref<Record<string, RepoSystems>>(KEY, {});

export const getRepoSystems = (repoId: number): RepoSystems | null => all()[String(repoId)] ?? null;

export function setRepoSystems(repoId: number, v: RepoSystems): void {
  setPref(KEY, { ...all(), [String(repoId)]: v });
}

/** What a repo's systems depend on: if it changes (name, GitLab project, boards, tickets), they are read again. */
export const basisOf = (r: RepoView): string => JSON.stringify([r.name, r.gitlabProject, r.boards, r.tickets]);

// toTodo runs for every todo: the repos (a folder check each) and the stored systems are read once per few seconds.
let cache: { at: number; repos: RepoView[]; systems: Record<string, RepoSystems> } | null = null;
const snapshot = () => {
  if (!cache || Date.now() - cache.at > 5000) cache = { at: Date.now(), repos: listRepos(), systems: all() };
  return cache;
};

/** The systems of the repo a ticket's work goes to ([] without a repo or without systems). */
export function systemsForTicket(ticket: string | null | undefined): TodoLink[] {
  if (!ticket) return [];
  try {
    const { repos, systems } = snapshot();
    const repo = repoForTicket(ticket, repos)?.repo;
    return (repo && systems[String(repo.id)]?.systems) || [];
  } catch {
    return [];
  }
}
