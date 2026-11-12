import { listJiraBoards, listJiraTickets } from "@/lib/jira/store";
import type { WorkspaceSource } from "@/plugins/workspace/source-point";

/**
 * The synced Jira tickets (those of the chosen boards) as the source of Jira's own database in the Workspace — the rows its app view shows
 * (view-template.meta.ts) and the AI reads, filters and changes the view of. Read only: a ticket changes in Jira (the flows jira.comment,
 * jira.transition, jira.assign) or through its job and tags (the app's own parts).
 */
const F = { key: "jkey", type: "jtype", status: "jstatus", category: "jcategory", priority: "jpriority", assignee: "jassignee", mine: "jmine", board: "jboard", job: "jjob", active: "jactive", link: "jlink", updated: "jupdated" };

export function ticketRecords() {
  const boards = new Map(listJiraBoards().map((b) => [b.id, b]));
  return listJiraTickets().map((tk) => {
    const board = tk.boardId != null ? boards.get(tk.boardId) : undefined;
    return {
      ref: `jira:${tk.key.toUpperCase()}`,
      title: tk.summary || tk.key,
      fields: {} as Record<string, string>,
      url: tk.url ?? undefined,
      text: tk.description ?? undefined,
      updatedAt: `${tk.updatedAt ?? ""}|${tk.jobNumber ?? ""}|${tk.active ? 1 : 0}`,
      dataType: "jira" as const,
      typed: [
        { id: F.key, name: "Key", type: "text" as const, value: tk.key },
        { id: F.type, name: "Type", type: "text" as const, value: tk.issueType ?? "" },
        { id: F.status, name: "Status", type: "text" as const, value: tk.status || tk.statusCategory },
        { id: F.category, name: "Category", type: "text" as const, value: tk.statusCategory },
        { id: F.priority, name: "Priority", type: "text" as const, value: tk.priority ?? "" },
        { id: F.assignee, name: "Assignee", type: "text" as const, value: tk.assignee ?? "" },
        { id: F.mine, name: "Mine", type: "checkbox" as const, value: tk.mine || null },
        { id: F.board, name: "Board", type: "text" as const, value: board?.name ?? "" },
        { id: F.job, name: "Job", type: "text" as const, value: tk.jobNumber ?? (board?.enabled ? (board.jobNumber ?? "") : "") },
        { id: F.active, name: "Active", type: "checkbox" as const, value: tk.active || null },
        { id: F.link, name: "Link", type: "url" as const, value: tk.url ?? null },
        { id: F.updated, name: "Updated", type: "date" as const, value: tk.updatedAt ? tk.updatedAt.slice(0, 10) : null },
      ],
    };
  });
}

export const JIRA_TICKETS_SOURCE: WorkspaceSource = {
  id: "jira-tickets",
  label: "Jira",
  icon: "🎫",
  dataType: "jira",
  hint: "Your synced Jira tickets (the chosen boards): key, type, status, assignee, board, job — Jira's app in the Workspace.",
  read: ticketRecords,
  count: () => listJiraTickets().length,
  noNewRows: true,
  lockedFields: Object.values(F),
};
