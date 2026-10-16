import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Kanban's API (plugins, agents, the AI's "Kanban card" offer) on boards that moved into the Workspace: they're listed
 * with their columns (the statuses), a card is added to the board's database, and a moved card (KB-…) is changed,
 * moved and archived as its row.
 */
test("kanban API on moved boards: list, get, add (the AI's offer too), update, move, archive", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["kanban", "workspace"]) setInstalled(id, true);
  const s = await import("@/plugins/kanban/store");
  const w = await import("@/plugins/workspace/store");
  const { docToMarkdown } = await import("@/plugins/workspace/doc");
  const { moveBoardToWorkspace, movedCard } = await import("@/plugins/kanban/to-workspace");
  const { KANBAN_API } = await import("@/plugins/kanban/api");
  const call = (m: string, p: Record<string, unknown>) => KANBAN_API.methods[m].run(p, { plugin: "test", source: "builtin", permissions: new Set(), ungranted: [] } as never) as Promise<unknown>;
  const b = s.createBoard({ name: "Haus", columns: ["Offen", "Dran", "Fertig"] });
  const card = s.createCard(s.getBoard(b).columns[0].id, "Fliesen");
  const { dbId } = moveBoardToWorkspace(b);

  const boards = (await call("kanban.boards.list", {})) as { id: number | string; name: string }[];
  const mine = boards.find((x) => x.name === "Haus")!;
  assert.equal(mine.id, `workspace:${dbId}`);
  const got = (await call("kanban.boards.get", { id: mine.id })) as { columns: { id: string; name: string; cards: { ref: string; title: string }[] }[] };
  assert.deepEqual(got.columns.map((c) => c.name), ["Offen", "Dran", "Fertig"]);
  assert.deepEqual(got.columns[0].cards.map((c) => [c.ref, c.title]), [[`KB-${card.id}`, "Fliesen"]]);

  // The AI's offer: by the board's and the column's name.
  const offer = KANBAN_API.methods["kanban.cards.add"].offer!;
  const resolved = (await offer.check({ title: "Maler anrufen", board: "haus", column: "dran", description: "Wegen Termin" })) as Record<string, unknown>;
  assert.equal(resolved.board, "Haus");
  assert.equal(resolved.column, "Dran");
  const added = (await call("kanban.cards.add", resolved)) as { ref: string; title: string };
  assert.match(added.ref, /^WS-\d+$/);
  const row = w.rawRows(dbId).find((r) => r.title === "Maler anrufen")!;
  assert.match(docToMarkdown(w.getPage(row.id)!.content), /Wegen Termin/);
  const status = w.getDatabase(dbId)!.schema.properties.find((p) => p.type === "status")!;
  assert.equal(status.options!.find((o) => o.id === row.cells[status.id])?.name, "Dran");

  // A moved card by its Kanban id.
  await call("kanban.cards.update", { id: card.id, title: "Fliesen kaufen", due: "2026-11-01" });
  assert.equal(w.getPage(movedCard(card.id)!)!.title, "Fliesen kaufen");
  await call("kanban.cards.move", { id: card.id, column: "Fertig" });
  assert.equal(status.options!.find((o) => o.id === w.getPage(movedCard(card.id)!)!.props[status.id])?.name, "Fertig");
  await call("kanban.cards.archive", { id: card.id });
  assert.ok(w.getPage(movedCard(card.id)!)!.archivedAt, "archived: its row in the trash");
});
