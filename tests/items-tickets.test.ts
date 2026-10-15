import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Own ticket keys: Kanban's KB-<id> and the Workspace's WS-<id> — never Jira's. */
test("ticket keys: KB- and WS- are your own, not Jira's", async () => {
  const k = await import("@/lib/ticket-keys");
  for (const key of ["KB-12", "ws-7", " WS-1 "]) assert.ok(k.isOwnKey(key) && k.isTicketKey(key) && !k.isJiraKey(key), key);
  for (const key of ["PROJ-12", "WSX-1", "KBB-2"]) assert.ok(!k.isOwnKey(key) && k.isJiraKey(key), key);
});

/**
 * The rows of a board database in the briefing are tickets of the Lage, like Kanban's cards were:
 * their status the ticket's, the other statuses where they can go; done ones for a few days.
 */
test("lage: rows of a board database in the briefing are tickets — a moved card keeps KB-<id>", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["kanban", "workspace"]) setInstalled(id, true);
  const s = await import("@/plugins/kanban/store");
  const w = await import("@/plugins/workspace/store");
  const { setCollection } = await import("@/lib/items");
  const { moveBoardToWorkspace, movedCard } = await import("@/plugins/kanban/to-workspace");
  const { boardLageTickets } = await import("@/lib/items/tickets");
  const { ticketBlock } = await import("@/lib/boards/collect");

  const b = s.createBoard({ name: "Haus", columns: ["Offen", "Dran", "Fertig"] });
  const [open, , done] = s.getBoard(b).columns;
  s.updateColumn(done.id, { done: true });
  const card = s.createCard(open.id, "Fliesen kaufen");
  s.updateCard(card.id, { description: "Für das Bad", labels: ["Bad"], due: "2026-11-01", assignee: "Anna" });
  const fin = s.createCard(open.id, "Maler");
  s.moveCard(fin.id, done.id, null);
  const other = s.createBoard({ name: "Bleibt Kanban" });
  s.createCard(s.getBoard(other).columns[0].id, "Kanban-Karte");
  const { dbId } = moveBoardToWorkspace(b);
  const fresh = w.addRow(dbId, { title: "Neu im Workspace" });

  const tickets = boardLageTickets();
  assert.deepEqual(tickets.map((t) => t.issue.key).sort(), [`KB-${card.id}`, `KB-${fin.id}`, `WS-${fresh}`].sort(), "Kanban's own boards stay Kanban's (kanbanLageTickets)");
  const t = tickets.find((x) => x.issue.key === `KB-${card.id}`)!;
  assert.equal(t.board, "Haus");
  assert.equal(t.done, false);
  assert.equal(t.url, `/workspace/${movedCard(card.id)}`);
  assert.deepEqual(t.columns, ["Dran", "Fertig"]);
  assert.equal(t.issue.summary, "Fliesen kaufen");
  assert.deepEqual(t.issue.status, { name: "Offen", category: "todo" });
  assert.equal(t.issue.assignee, undefined, "a text assignee isn't a person");
  assert.match(t.issue.description!, /^Eigene Karte in der Workspace-Datenbank „Haus“ in Zeff, kein Jira-Ticket\.\nLabels: Bad\nFällig: 2026-11-01\nFür das Bad$/);
  assert.equal(tickets.find((x) => x.issue.key === `KB-${fin.id}`)!.done, true, "done lately: still in, as done");
  assert.deepEqual(tickets.find((x) => x.issue.key === `WS-${fresh}`)!.issue.status, { name: "Offen", category: "todo" }, "a new row starts in the first status");

  assert.match(ticketBlock(t.issue, null), /Eigene Kanban-Karte in Zeff, kein Jira-Ticket/, "a moved card: the same note as before");
  assert.match(ticketBlock(tickets.find((x) => x.issue.key === `WS-${fresh}`)!.issue, null), /Eigene Zeile einer Workspace-Datenbank in Zeff, kein Jira-Ticket/);

  setCollection(`workspace:${dbId}`, { briefing: false });
  assert.deepEqual(boardLageTickets(), [], "out of the briefing: no tickets");
});
