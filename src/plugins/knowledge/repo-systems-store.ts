import { getPref, setPref } from "@/lib/prefs";
import { listRepos, repoForTicket, type RepoView } from "@/lib/repos";
import type { RepoSummary } from "./shared";

const KEY = "knowledge.repoSystems";
const PROMPT_KEY = "knowledge.repoPickPrompt";

/** One system of a repo the AI picked from the knowledge: its environment, what it is, its address — and whether the AI was sure it belongs to the repo. */
export type RepoPick = { env: "prod" | "test" | "dev" | "other"; label: string; url: string; sure: boolean };

/** What the AI wrote about a repo from the knowledge (Markdown) — and what it wrote it for. `systems`: the addresses it picked, the table in the summary is made from them. */
export type RepoSystems = { at: string; basis: string; summary?: string; systems?: RepoPick[] };

/** Your own rules for the picking stage (Settings → Todos); "" = the built-in ones. */
export const getPickPrompt = (): string => getPref<string>(PROMPT_KEY, "").trim();
export const setPickPrompt = (text: string): void => setPref(PROMPT_KEY, text.trim());

/** A short fingerprint of a text (it only has to tell two prompts apart). */
const fingerprint = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${s.length}:${h.toString(36)}`;
};

const all = () => getPref<Record<string, RepoSystems>>(KEY, {});

export const getRepoSystems = (repoId: number): RepoSystems | null => all()[String(repoId)] ?? null;

export function setRepoSystems(repoId: number, v: RepoSystems): void {
  setPref(KEY, { ...all(), [String(repoId)]: v });
}

/** What a repo's summary depends on: if it changes (name, GitLab project, boards, tickets, or the other repos — or your rules for the picking stage), it is written again. */
export const basisOf = (r: RepoView, others: RepoView[] = []): string =>
  JSON.stringify([3, fingerprint(getPickPrompt()), r.name, r.gitlabProject, r.boards, r.tickets, others.filter((o) => o.id !== r.id).map((o) => [o.name, o.gitlabProject, o.boards, o.tickets])]);

// toTodo runs for every todo: the repos (a folder check each) and the stored summaries are read once per few seconds.
let cache: { at: number; repos: RepoView[]; systems: Record<string, RepoSystems> } | null = null;
const snapshot = () => {
  if (!cache || Date.now() - cache.at > 5000) cache = { at: Date.now(), repos: listRepos(), systems: all() };
  return cache;
};

/** The summary of the repo a ticket's work goes to (null without a repo or without a summary). */
export function summaryForTicket(ticket: string | null | undefined): RepoSummary | null {
  if (!ticket) return null;
  try {
    const { repos, systems } = snapshot();
    const repo = repoForTicket(ticket, repos)?.repo;
    const summary = repo && systems[String(repo.id)]?.summary?.trim();
    return repo && summary ? { name: repo.name, summary } : null;
  } catch {
    return null;
  }
}
