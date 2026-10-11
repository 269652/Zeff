import { aiChoice, aiProviders, getAppSettings } from "@/lib/ai";
import { withAlternatives } from "@/lib/boards/alternatives";
import { CLAUDE_MODELS, copilotModelName } from "@/lib/ai/shared";
import { todoSources } from "@/lib/boards/sources";
import type { BoardRunView, TodoSource, TodoView } from "@/lib/boards/shared";
import { lastGoodRun, listTodos } from "@/lib/boards/store";
import { gitlabItemsByKeys } from "@/lib/gitlab/store";
import type { TicketCard } from "@/lib/jira/ticket-card-shared";
import { getTicketCards } from "@/lib/jira/store";
import { teamsMessagesByKeys } from "@/lib/teams/store";
import { cachedLocalBranches, listRepos, repoForTicket, type RepoMatch } from "@/lib/repos";
import type { WorkRunView, WorkSettingsView } from "./shared";
import { getWorkSettings, recentRuns, runsByStatus, runsForTodos, toRunView } from "./store";

const KEY = /^[A-Z][A-Z0-9]+-\d+$/i;

export type WorkPageData = {
  settings: WorkSettingsView;
  board: BoardRunView | null;
  /** Tickets in the Ticket-Lage's order (most urgent first), then the others with todos. */
  tickets: string[];
  todos: TodoView[];
  runs: Record<number, WorkRunView[]>;
  sources: Record<string, TodoSource>;
  cards: Record<string, TicketCard>;
  /** Where each todo's message goes, to open it there (by todo). */
  targets: Record<number, string | null>;
  /** The follow-ups each run left (by run). */
  created: Record<number, { id: number; text: string; done: boolean }[]>;
  active: WorkRunView[];
  history: WorkRunView[];
  providers: { id: "claude" | "copilot"; label: string; found: boolean }[];
  preferred: "claude" | "copilot";
  /** The repos (Repos page), and where each ticket's work goes. */
  repos: { name: string; ok: boolean }[];
  repoOf: Record<string, { id: number; name: string; via: RepoMatch["via"]; path: string; branch: string | null; branches: string[] } | null>;
  /** The Settings provider's model (what workers get unless the Work tab picks another), and the models to pick from. */
  defaultModel: string;
  models: { value: string; label: string }[];
};

/**
 * Everything the Work tab shows: the open todos — and those done this week that a worker had or
 * that a worker left — by ticket (the Ticket-Lage's order), their runs, where they come from,
 * where their messages go; what's running; the latest runs; the workers' settings.
 */
export function workPageData(copilot: string[] = []): WorkPageData {
  const settings = getWorkSettings();
  const board = lastGoodRun();
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const recent = listTodos({ status: "all" }).filter((t) => t.status === "open" || (t.doneAt ?? "") >= since);
  const runMap = runsForTodos(recent.map((t) => t.id));
  // Flagged by you first, then those a worker reports done, put down by you last (a stable sort — otherwise as they were).
  const rank = (t: TodoView) => (t.flaggedAt ? -2 : t.workerDone && t.status === "open" ? -1 : t.deferred ? 1 : 0);
  const todos = withAlternatives(recent).sort((a, b) => rank(a) - rank(b));

  const order = [...(board?.result?.tickets ?? []).map((t) => t.key), ...(board?.tickets ?? []).filter((t) => t.analyzed).map((t) => t.key)];
  const tickets = [...new Set([...order, ...todos.map((t) => t.ticket).sort()])].filter((k) => todos.some((t) => t.ticket === k));

  const sources = todoSources(todos, board?.tickets ?? []);
  const teams = teamsMessagesByKeys(todos.flatMap((t) => (t.target?.startsWith("teams:") ? [t.target.slice(6)] : [])));
  const gitlab = gitlabItemsByKeys(todos.flatMap((t) => (t.target?.startsWith("gitlab:") ? [t.target.slice(7)] : [])));
  const jiraKey = (t: TodoView) => (t.target && KEY.test(t.target) ? t.target.toUpperCase() : t.ticket);
  const cards = getTicketCards([...tickets, ...todos.filter((t) => t.channel === "jira").map(jiraKey)]);
  const sourceLink = (ref: string | null) => {
    const s = ref ? sources[ref] : undefined;
    return s?.source === "teams" ? s.teams.link : s?.source === "gitlab" ? s.gitlab.url : null;
  };
  const targets: Record<number, string | null> = {};
  for (const t of todos) {
    const ref = t.target ?? t.refs.find((r) => r.startsWith(`${t.channel}:`)) ?? null;
    targets[t.id] =
      t.channel === "teams"
        ? (teams.get(ref?.slice(6) ?? "")?.link ?? sourceLink(ref))
        : t.channel === "gitlab"
          ? (gitlab.get(ref?.slice(7) ?? "")?.url ?? sourceLink(ref))
          : t.channel === "jira"
            ? (cards[jiraKey(t)]?.url ?? null)
            : null;
  }

  const created: WorkPageData["created"] = {};
  for (const t of todos) if (t.workRunId && t.parentId) (created[t.workRunId] ??= []).push({ id: t.id, text: t.text, done: t.status !== "open" });

  const app = getAppSettings();
  const preferred = aiChoice().provider;
  const repos = listRepos();
  const branchesOf = new Map(repos.filter((r) => r.ok).map((r) => [r.id, cachedLocalBranches(r.path)]));
  const repoOf = Object.fromEntries(
    tickets.map((k) => {
      const m = repoForTicket(k, repos);
      return [k, m ? { id: m.repo.id, name: m.repo.name, via: m.via, path: m.repo.path, branch: m.repo.branch, branches: branchesOf.get(m.repo.id) ?? [] } : null];
    }),
  );
  return {
    settings,
    board,
    tickets,
    todos,
    runs: Object.fromEntries(runMap),
    sources,
    cards,
    targets,
    created,
    active: runsByStatus(["queued", "running"]).map(toRunView),
    history: recentRuns(30),
    providers: aiProviders().map((p) => ({ id: p.id, label: p.id === "copilot" ? "Copilot" : "Claude", found: !!p.found })),
    preferred,
    repos: repos.map((r) => ({ name: r.name, ok: r.ok })),
    repoOf,
    defaultModel: preferred === "copilot" ? app.copilotModel : app.claudeModel,
    models:
      preferred === "copilot"
        ? [{ value: "auto", label: "Auto — Copilot picks" }, ...copilot.map((m) => ({ value: m, label: copilotModelName(m) }))]
        : CLAUDE_MODELS.filter((m) => m.value).map((m) => ({ value: m.value, label: m.label })),
  };
}
