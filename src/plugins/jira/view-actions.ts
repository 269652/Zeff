"use server";

import { t } from "@/lib/i18n/server";

/**
 * What Jira's app view in the Workspace shows besides its rows (view-template.meta.ts): how the sync is set up and when it last ran, the
 * stats of all synced tickets, and what the job and tags pickers of a ticket need — as Jira's own page had them.
 */
export async function jiraScreenAction() {
  const { getJiraSyncConfig } = await import("@/lib/jira/sync");
  const { jiraStats, listJiraBoards, listJiraTickets } = await import("@/lib/jira/store");
  const { listJobs } = await import("@/lib/jobs");
  const { listTags } = await import("@/lib/tags");
  const { listDefaultTagMaps } = await import("@/lib/default-tags");
  const cfg = getJiraSyncConfig();
  const stats = jiraStats();
  const jobRows = listJobs();
  const jobName = new Map(jobRows.map((j) => [j.number, j.name]));
  const boards = new Map(listJiraBoards().map((b) => [b.id, b]));
  const ticketTags = listDefaultTagMaps().tickets;
  // Per ticket: its own job and the one its (enabled) board gives; its default tags.
  const tickets = Object.fromEntries(
    listJiraTickets().map((tk) => {
      const board = tk.boardId != null ? boards.get(tk.boardId) : undefined;
      const boardJob = board?.enabled && board.jobNumber ? { number: board.jobNumber, name: jobName.get(board.jobNumber) ?? board.jobNumber } : null;
      return [tk.key, { job: tk.jobNumber, boardJob, tags: ticketTags[tk.key.toUpperCase()] ?? [] }];
    }),
  );
  return {
    configured: cfg.configured,
    syncLine: [
      cfg.configured ? t("via {source}: {command} · {tool}", { source: cfg.source === "mcp.json" ? ".mcp.json" : "env", command: `${cfg.command} ${cfg.args.join(" ")}`, tool: cfg.tool }) : t("no Jira MCP server configured"),
      stats.lastSyncedAt ? t("last synced {at}", { at: stats.lastSyncedAt.replace("T", " ").slice(0, 16) }) : "",
    ]
      .filter(Boolean)
      .join(" · "),
    jql: cfg.configured ? cfg.jql : "",
    base: cfg.baseUrl ?? "",
    total: stats.total,
    todo: stats.byCategory.todo,
    inprogress: stats.byCategory.inprogress,
    done: stats.byCategory.done,
    withJob: stats.withJob,
    jobs: jobRows.map((j) => ({ number: j.number, name: j.name })),
    allTags: listTags().map((x) => x.name),
    tickets,
  };
}

export type JiraScreen = Awaited<ReturnType<typeof jiraScreenAction>>;
