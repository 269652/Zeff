import { aiChoice, aiProviders, getAppSettings } from "@/lib/ai";
import { withAlternatives } from "@/lib/boards/alternatives";
import { claudeModels, copilotModelName } from "@/lib/ai/shared";
import { todoSources } from "@/lib/boards/sources";
import type { BoardRunView, TodoSource, TodoView } from "@/lib/boards/shared";
import { lastGoodRun, listTodos } from "@/lib/boards/store";
import { gitlabItemsByKeys } from "@/lib/gitlab/store";
import { t } from "@/lib/i18n/server";
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
  const recent = listTodos({ status: "all" }).filter((todo) => todo.status === "open" || (todo.doneAt ?? "") >= since);
  const runMap = runsForTodos(recent.map((todo) => todo.id));
  // Flagged by you first, then those a worker reports done, put down by you last (a stable sort — otherwise as they were).
  const rank = (todo: TodoView) => (todo.flaggedAt ? -2 : todo.workerDone && todo.status === "open" ? -1 : todo.deferred ? 1 : 0);
  const todos = withAlternatives(recent).sort((a, b) => rank(a) - rank(b));

  const order = [...(board?.result?.tickets ?? []).map((x) => x.key), ...(board?.tickets ?? []).filter((x) => x.analyzed).map((x) => x.key)];
  const tickets = [...new Set([...order, ...todos.map((todo) => todo.ticket).sort()])].filter((k) => todos.some((todo) => todo.ticket === k));

  const sources = todoSources(todos, board?.tickets ?? []);
  const teams = teamsMessagesByKeys(todos.flatMap((todo) => (todo.target?.startsWith("teams:") ? [todo.target.slice(6)] : [])));
  const gitlab = gitlabItemsByKeys(todos.flatMap((todo) => (todo.target?.startsWith("gitlab:") ? [todo.target.slice(7)] : [])));
  const jiraKey = (todo: TodoView) => (todo.target && KEY.test(todo.target) ? todo.target.toUpperCase() : todo.ticket);
  const cards = getTicketCards([...tickets, ...todos.filter((todo) => todo.channel === "jira").map(jiraKey)]);
  const sourceLink = (ref: string | null) => {
    const s = ref ? sources[ref] : undefined;
    return s?.source === "teams" ? s.teams.link : s?.source === "gitlab" ? s.gitlab.url : null;
  };
  const targets: Record<number, string | null> = {};
  for (const todo of todos) {
    const ref = todo.target ?? todo.refs.find((r) => r.startsWith(`${todo.channel}:`)) ?? null;
    targets[todo.id] =
      todo.channel === "teams"
        ? (teams.get(ref?.slice(6) ?? "")?.link ?? sourceLink(ref))
        : todo.channel === "gitlab"
          ? (gitlab.get(ref?.slice(7) ?? "")?.url ?? sourceLink(ref))
          : todo.channel === "jira"
            ? (cards[jiraKey(todo)]?.url ?? null)
            : null;
  }

  const created: WorkPageData["created"] = {};
  for (const todo of todos) if (todo.workRunId && todo.parentId) (created[todo.workRunId] ??= []).push({ id: todo.id, text: todo.text, done: todo.status !== "open" });

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
        ? [{ value: "auto", label: t("Auto — Copilot picks") }, ...copilot.map((m) => ({ value: m, label: copilotModelName(m) }))]
        : claudeModels(t).filter((m) => m.value).map((m) => ({ value: m.value, label: m.label })),
  };
}
