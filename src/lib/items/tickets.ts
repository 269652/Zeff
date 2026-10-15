import type { Issue } from "@/lib/boards/collect";
import type { TicketCard } from "@/lib/jira/ticket-card-shared";
import { itemsByKeys, listCollections, collectionItems, type Item, type ItemPhase } from "./index";

/**
 * The rows of board databases in the briefing (a Workspace database with a board view by status —
 * moved Kanban boards among them) as tickets of the Lage, like Kanban's cards (kanbanLageTickets,
 * which keeps Kanban's own boards): their key KB-<id> or WS-<id>, their status the ticket's, the
 * other statuses where they can go. Done ones stay a few days (what got done is part of it).
 */

const DONE_DAYS = 3;
const CATEGORY: Record<ItemPhase, string> = { todo: "todo", doing: "inprogress", done: "done" };

export type BoardLageTicket = { issue: Issue; url: string; columns: string[]; done: boolean; board: string };

export function boardLageTickets(): BoardLageTicket[] {
  const since = Date.now() - DONE_DAYS * 864e5;
  const out: BoardLageTicket[] = [];
  for (const col of listCollections({ briefing: true })) {
    if (col.kind !== "board" || col.plugin === "kanban") continue;
    const statuses = col.statuses ?? [];
    for (const it of collectionItems(col.id) ?? []) {
      if (!it.key) continue;
      // A row without a status sits in the first column.
      const status = it.status ?? (statuses[0] ? { name: statuses[0], phase: "todo" as const } : null);
      const done = status?.phase === "done";
      if (done && Date.parse(it.updatedAt ?? "") < since) continue;
      out.push({ board: col.name, done, columns: statuses.filter((s) => s !== status?.name), url: it.href, issue: issueOf(it, col.name, status) });
    }
  }
  return out;
}

/**
 * Hover cards for own ticket keys whose item is a row (a moved card's KB-…, a row's WS-…): its title,
 * status, page and database. Kanban's cards still on Kanban aren't here (kanbanTicketCards).
 */
export function itemTicketCards(keys: string[]): Record<string, TicketCard> {
  const items = itemsByKeys(keys);
  const names = new Map(listCollections().map((c) => [c.id, c.name]));
  const out: Record<string, TicketCard> = {};
  for (const [key, it] of items) {
    if (it.kind !== "row") continue;
    out[key] = {
      key,
      url: it.href,
      synced: true,
      summary: it.title,
      description: it.text || null,
      status: it.status?.name ?? "",
      statusCategory: (it.status ? CATEGORY[it.status.phase] : "todo") as TicketCard["statusCategory"],
      issueType: names.get(it.collectionId) ?? null,
      priority: null,
      assignee: it.assignee,
      openedAt: it.createdAt,
      resolvedAt: it.status?.phase === "done" ? it.updatedAt : null,
      jobNumber: null,
    };
  }
  return out;
}

function issueOf(it: Item, board: string, status: Item["status"]): Issue {
  return {
    key: it.key!,
    summary: it.title,
    description: [`Eigene Karte in der Workspace-Datenbank „${board}“ in Zeff, kein Jira-Ticket.`, it.labels.length ? `Labels: ${it.labels.join(", ")}` : "", it.due ? `Fällig: ${it.due}` : "", it.text]
      .filter(Boolean)
      .join("\n"),
    browse_url: it.href,
    status: status ? { name: status.name, category: CATEGORY[status.phase] } : undefined,
    issue_type: { name: "Workspace-Karte" },
    assignee: it.assignee ? { display_name: it.assignee } : undefined,
    created: it.createdAt ?? undefined,
    updated: it.updatedAt ?? undefined,
    comments: [],
  };
}
