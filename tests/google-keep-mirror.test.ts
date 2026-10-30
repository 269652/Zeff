import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Google Keep as a data source of the Workspace: its notes (as the Keep sync reads them) kept in a gallery database
 * "Google Keep" — colour, pinned, labels, text and checklists; read-only, in the briefing and the knowledge as Google
 * Keep was. A note keeps its ref (keep:<Google's id>): todos, the knowledge, the note review go on naming it.
 */
test("syncGoogleKeepDatabase: Google Keep's notes kept in a gallery database, each sync only what changed", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["keep", "workspace"]) setInstalled(id, true);
  const g = await import("@/plugins/keep/store");
  const w = await import("@/plugins/workspace/store");
  const { docToMarkdown } = await import("@/plugins/workspace/doc");
  const c = await import("@/lib/items");
  const { keepCollections } = await import("@/plugins/keep/collections");
  const { syncGoogleKeepDatabase, googleKeepDatabase, googleKeepHref } = await import("@/plugins/keep/google-workspace");
  const note = (id: string, extra: Partial<import("@/plugins/keep/store").KeepNote> = {}) => ({ id, kind: "note" as const, title: `Note ${id}`, text: `Text ${id}`, labels: [], color: null, pinned: false, archived: false, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", url: `https://keep.google.com/#NOTE/${id}`, ...extra });
  g.saveKeepNotes([note("g1", { color: "yellow", pinned: true, labels: ["Haushalt"], kind: "list", text: "- [ ] Milch\n- [x] Brot" }), note("g2"), note("g3", { archived: true })], true);

  const r = syncGoogleKeepDatabase();
  assert.equal(r.created, 2, "the archived one isn't among the notes");
  const dbId = googleKeepDatabase()!;
  const d = w.getDatabase(dbId)!;
  assert.equal(d.page.title, "Google Keep");
  assert.equal(d.page.locked, true, "read-only: Google Keep is where they change");
  assert.equal(d.schema.views[0].type, "gallery");
  assert.equal(googleKeepHref(), `/workspace/${dbId}`);
  const row = (id: string) => w.rawRows(dbId).find((x) => x.cells.noteref === `keep:${id}`)!;
  assert.equal(row("g1").title, "Note g1");
  assert.equal(row("g1").cells.pinned, true);
  assert.equal(d.schema.properties.find((p) => p.id === "color")!.options!.find((o) => o.id === row("g1").cells.color)?.name, "yellow");
  assert.match(docToMarkdown(w.getPage(row("g1").id)!.content), /- \[ \] Milch\n- \[x\] Brot/);

  const col = c.listCollections().find((x) => x.id === `workspace:${dbId}`)!;
  assert.equal(col.source, "google-keep");
  assert.equal(col.briefing, true);
  assert.equal(col.knowledge, true);
  assert.ok(!keepCollections.collections().some((x) => x.id === "keep:google"), "Keep's own Google collection gives way");
  assert.deepEqual(keepCollections.byRefs(["keep:g1"]), [], "the Workspace answers for its notes");
  assert.equal(c.itemsByRefs(["keep:g1"]).get("keep:g1")?.collectionId, `workspace:${dbId}`);

  // The next sync: one changed, one gone, one new; then nothing.
  g.saveKeepNotes([note("g1", { color: "yellow", pinned: false, labels: ["Haushalt"], kind: "list", text: "- [x] Milch\n- [x] Brot", updatedAt: "2026-10-05T00:00:00Z" }), note("g4")], true);
  const again = syncGoogleKeepDatabase();
  assert.deepEqual([again.created, again.updated, again.archived], [1, 1, 1]);
  assert.equal(row("g1").cells.pinned, undefined, "unpinned");
  assert.match(docToMarkdown(w.getPage(row("g1").id)!.content), /- \[x\] Milch/);
  assert.ok(!w.rawRows(dbId).some((x) => x.cells.noteref === "keep:g2"), "gone from Keep: in the trash");
  const quiet = syncGoogleKeepDatabase();
  assert.equal(quiet.created + quiet.updated + quiet.archived, 0, "nothing changed: nothing written");
});
