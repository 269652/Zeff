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

/** A Lage suggestion on a moved card or a row works there: a move sets its status, a note goes on its page; the hover card shows the row. */
test("actions and hover cards: KB-… of a moved card and WS-… act on and show the row", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["kanban", "workspace"]) setInstalled(id, true);
  const s = await import("@/plugins/kanban/store");
  const w = await import("@/plugins/workspace/store");
  const { docText } = await import("@/plugins/workspace/doc");
  const { itemAction, itemsByKeys } = await import("@/lib/items");
  const { moveBoardToWorkspace, movedCard } = await import("@/plugins/kanban/to-workspace");
  const { getTicketCards } = await import("@/lib/jira/store");

  const b = s.createBoard({ name: "Aktionen", columns: ["Offen", "Dran", "Fertig"] });
  const card = s.createCard(s.getBoard(b).columns[0].id, "Wand streichen");
  s.updateCard(card.id, { description: "Weiß" });
  const stays = s.createBoard({ name: "Bleibt" });
  const kb = s.createCard(s.getBoard(stays).columns[0].id, "Bleibt auf Kanban");
  const { dbId } = moveBoardToWorkspace(b);
  const fresh = w.addRow(dbId, { title: "Neue Zeile" });
  const key = `KB-${card.id}`;

  assert.equal(itemAction(key, { type: "transition", to: "dran", label: "→ Dran" }), "→ Dran");
  assert.equal(itemsByKeys([key]).get(key)!.status?.name, "Dran");
  assert.equal(itemAction(key, { type: "comment", comment: "Farbe gekauft", label: "Notiz" }), "Note on the card");
  assert.match(docText(w.getPage(movedCard(card.id)!)!.content), /^Weiß[\s\S]*— .*: Farbe gekauft$/);
  assert.equal(itemAction(`WS-${fresh}`, { type: "transition", to: "Fertig", label: "→ Fertig" }), "→ Fertig");
  assert.throws(() => itemAction(`WS-${fresh}`, { type: "transition", to: "Nirgends", label: "x" }), /No status “Nirgends” — there are: Offen, Dran, Fertig/);
  assert.throws(() => itemAction(`WS-${fresh}`, { type: "assign", label: "x" }), /doesn't work/);
  assert.equal(itemAction(`KB-${kb.id}`, { type: "transition", to: "Done", label: "→ Done" }), "→ Done", "a card still on Kanban: Kanban's way");
  assert.throws(() => itemAction("WS-999999", { type: "comment", comment: "x", label: "x" }), /doesn't exist/);

  const cards = getTicketCards([key, `WS-${fresh}`, `KB-${kb.id}`]);
  assert.equal(cards[key].summary, "Wand streichen");
  assert.equal(cards[key].status, "Dran");
  assert.equal(cards[key].statusCategory, "inprogress");
  assert.equal(cards[key].url, `/workspace/${movedCard(card.id)}`);
  assert.equal(cards[key].issueType, "Aktionen", "where it is: its database");
  assert.equal(cards[`WS-${fresh}`].statusCategory, "done");
  assert.equal(cards[`KB-${kb.id}`].summary, "Bleibt auf Kanban");
});

/** The heavier modules of a ticket's detail view, fetched when it opens: questions, actions, flags, context, chat. */
test("ticketDetail: what the briefing knows beyond the lead — by key", async () => {
  const { getSqlite } = await import("@/db");
  const { ticketDetail } = await import("@/lib/items/tickets");
  const d = getSqlite();
  d.exec("create table if not exists ticket_lage (key text primary key, hash text not null, result text not null, model text, analyzed_at text not null)");
  d.prepare("insert or replace into ticket_lage (key, hash, result, model, analyzed_at) values (?, '', ?, null, ?)").run("PROJ-77", JSON.stringify({ attention: "blocked", lead: "Wartet.", summary: "", happened: [], flags: ["Rückfrage seit 03.10. offen"] }), new Date().toISOString());
  const x = ticketDetail("proj-77");
  assert.deepEqual(x.flags, ["Rückfrage seit 03.10. offen"]);
  assert.deepEqual(x.actions, []);
  assert.deepEqual(x.questions, []);
  assert.ok(Array.isArray(x.context) && Array.isArray(x.chat));
  assert.deepEqual(ticketDetail("NOPE-1").flags, []);
});
