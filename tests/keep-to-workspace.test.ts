import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Keep → Workspace: a note board becomes a database with a gallery view — its notes rows with their
 * colour, pinned and labels as properties, text and checklists as the page. A moved note keeps its
 * ref (keep:n<id>): todos, the knowledge and the note review go on naming it. The board is archived,
 * not deleted; moving it again changes nothing.
 */
test("a Keep board moves into the Workspace as a gallery database, its notes keeping their refs", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["keep", "workspace"]) setInstalled(id, true);
  const k = await import("@/plugins/keep/boards");
  const w = await import("@/plugins/workspace/store");
  const { docToMarkdown } = await import("@/plugins/workspace/doc");
  const c = await import("@/lib/items");
  const { moveKeepBoardToWorkspace, movedNote } = await import("@/plugins/keep/to-workspace");

  const b = k.createKeepBoard({ name: "Ideen", color: "sky" });
  k.updateKeepBoard(b, { inKnowledge: false });
  const list = k.createOwnNote(b, { title: "Einkauf", text: "- [ ] Milch\n- [x] Brot", color: "yellow", labels: ["Haushalt"] });
  k.updateOwnNote(Number(list.id.slice(1)), { pinned: true });
  const loose = k.createOwnNote(b, { text: "Nur Text ohne Titel\nzweite Zeile" });
  const gone = k.createOwnNote(b, { title: "Alt", text: "weg" });
  k.updateOwnNote(Number(gone.id.slice(1)), { archived: true });

  const { dbId } = moveKeepBoardToWorkspace(b);
  const d = w.getDatabase(dbId)!;
  assert.equal(d.page.title, "Ideen");
  const prop = (name: string) => d.schema.properties.find((p) => p.name === name)!;
  assert.equal(prop("Note").id, "noteref", "the property the Workspace reads a row's own ref from");
  assert.ok(prop("Color").options!.some((o) => o.name === "yellow"));
  assert.equal(prop("Pinned").type, "checkbox");
  assert.equal(d.schema.views[0].type, "gallery", "a gallery first, like Keep");
  assert.deepEqual(d.schema.views[0].sorts[0], { prop: prop("Pinned").id, dir: "desc" }, "pinned on top");

  const rows = w.rawRows(dbId);
  assert.deepEqual(rows.map((r) => r.title).sort(), ["Einkauf", "Nur Text ohne Titel"], "an archived note isn't among the rows; a note without a title: its first line");
  const r = rows.find((x) => x.id === movedNote(Number(list.id.slice(1))))!;
  assert.equal(r.cells.noteref, list.ref);
  assert.equal(r.cells[prop("Pinned").id], true);
  assert.equal(r.cells[prop("Color").id], prop("Color").options!.find((o) => o.name === "yellow")!.id);
  assert.match(docToMarkdown(w.getPage(r.id)!.content), /- \[ \] Milch\n- \[x\] Brot/);
  assert.ok(w.getPage(movedNote(Number(gone.id.slice(1)))!)!.archivedAt, "an archived note: a row in the trash");

  const col = c.listCollections().find((x) => x.id === `workspace:${dbId}`)!;
  assert.equal(col.briefing, true, "in the Lage: in the briefing");
  assert.equal(col.knowledge, false, "out of the knowledge: out");
  assert.ok(!c.listCollections().some((x) => x.id === `keep:board:${b}`), "the Keep board is archived");
  assert.ok(k.listKeepBoards({ archived: true }).some((x) => x.id === b), "but not deleted");

  const byRef = c.itemsByRefs([list.ref]);
  assert.equal(byRef.size, 1, "the moved note is found once — as the row");
  const it = byRef.get(list.ref)!;
  assert.equal(it.collectionId, `workspace:${dbId}`);
  assert.equal(it.href, `/workspace/${r.id}`);
  assert.deepEqual(it.labels, ["Haushalt"]);
  assert.equal(it.pinned, true);
  assert.equal(it.color, "yellow");
  assert.equal(it.key, null, "a note isn't a ticket");
  assert.deepEqual(c.collectionItems(col.id)!.map((i) => i.ref).sort(), [list.ref, loose.ref].sort());

  assert.equal(moveKeepBoardToWorkspace(b).dbId, dbId, "moved again: the same database");
  assert.equal(w.rawRows(dbId).length, 2);
});

/** Keep itself no longer answers for a moved note — not by luck of the order the plugins register in. */
test("keep's provider leaves moved notes to the Workspace", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["keep", "workspace"]) setInstalled(id, true);
  const k = await import("@/plugins/keep/boards");
  const { keepCollections } = await import("@/plugins/keep/collections");
  const { moveKeepBoardToWorkspace } = await import("@/plugins/keep/to-workspace");
  const b = k.createKeepBoard({ name: "Weg" });
  const n = k.createOwnNote(b, { title: "Notiz", text: "x" });
  const stays = k.createOwnNote(k.createKeepBoard({ name: "Bleibt" }), { title: "Bleibt", text: "y" });
  moveKeepBoardToWorkspace(b);
  assert.deepEqual(keepCollections.byRefs([n.ref, stays.ref]).map((i) => i.ref), [stays.ref]);
});

/** At the next start, once: every Keep board (not the archived) moves — after a copy of the database; old links follow. */
test("moveAllKeepBoardsOnce: a backup first, every open Keep board moved — once; /keep/<board> leads to its database", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("keep", true);
  setInstalled("workspace", false);
  const k = await import("@/plugins/keep/boards");
  const { moveAllKeepBoardsOnce, movedKeepBoard, movedKeepHref } = await import("@/plugins/keep/to-workspace");
  const a = k.createKeepBoard({ name: "Eins" });
  k.createOwnNote(a, { title: "N", text: "x" });
  const old = k.createKeepBoard({ name: "Alt" });
  k.updateKeepBoard(old, { archived: true });

  const r = await moveAllKeepBoardsOnce();
  assert.ok(r && r.moved >= 1);
  assert.equal(path.basename(r.backup!), "zeff-before-keep-move.db");
  assert.ok(fs.statSync(r.backup!).size > 0);
  assert.ok(movedKeepBoard(a));
  assert.equal(movedKeepBoard(old), null, "an archived board stays in Keep's archive");
  assert.equal(movedKeepHref(a), `/workspace/${movedKeepBoard(a)}`);
  assert.equal(movedKeepHref(old), null);
  assert.equal(await moveAllKeepBoardsOnce(), null, "once");
});

/** Once Keep's boards have moved, a board made in Keep is made in the Workspace too. */
test("keepBoardCreated: after the move a new Keep board goes straight into the Workspace", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["keep", "workspace"]) setInstalled(id, true);
  const { setPref } = await import("@/lib/prefs");
  const k = await import("@/plugins/keep/boards");
  const { keepBoardCreated, movedKeepHref } = await import("@/plugins/keep/to-workspace");
  setPref("keep.movedToWorkspace", false);
  const before = k.createKeepBoard({ name: "Vorher" });
  keepBoardCreated(before);
  assert.equal(movedKeepHref(before), null);
  setPref("keep.movedToWorkspace", true);
  const after = k.createKeepBoard({ name: "Nachher" });
  keepBoardCreated(after);
  assert.match(movedKeepHref(after) ?? "", /^\/workspace\/\d+$/);
});

/** The auto-action "Create note" writes into the moved board's database (by name), not into an archived Keep board. */
test("runKeepNote after the move: the note is a row of the board's database", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["keep", "workspace"]) setInstalled(id, true);
  const k = await import("@/plugins/keep/boards");
  const w = await import("@/plugins/workspace/store");
  const { docToMarkdown } = await import("@/plugins/workspace/doc");
  const { moveKeepBoardToWorkspace } = await import("@/plugins/keep/to-workspace");
  const { runKeepNote } = await import("@/plugins/keep/run");
  const b = k.createKeepBoard({ name: "Einkaufsliste" });
  const { dbId } = moveKeepBoardToWorkspace(b);
  const before = k.listKeepBoards().length;
  const r = await runKeepNote({ type: "keep-note", board: "einkaufsliste", title: "Baumarkt", text: "- [ ] Schrauben" } as never);
  const rows = w.rawRows(dbId);
  const row = rows.find((x) => x.title === "Baumarkt");
  assert.ok(row, "a row of the moved board's database");
  assert.match(docToMarkdown(w.getPage(row.id)!.content), /- \[ \] Schrauben/);
  assert.equal(r.ref, `page:${row.id}`);
  assert.equal(k.listKeepBoards().length, before, "no new Keep board made");
});
