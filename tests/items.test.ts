import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Collections: one way to read what you keep in Zeff — Kanban boards, Keep boards (and Google Keep),
 * Workspace databases — as collections of items with the refs they already have (KB-<id>,
 * keep:n<id>, page:<id>). The data stays where it is; each plugin brings a provider.
 */

const install = async (...ids: string[]) => {
  const { setInstalled } = await import("@/plugins/state");
  // (Google Keep is a part of the Workspace: on only with it)
  setInstalled("workspace", ids.includes("workspace") || ids.includes("keep"));
  setInstalled("keep", ids.includes("keep"));
};

test("keep: your boards and Google Keep are collections of notes", async () => {
  await install("keep");
  const k = await import("@/plugins/keep/boards");
  const g = await import("@/plugins/keep/store");
  const c = await import("@/lib/items");
  const b = k.createKeepBoard({ name: "Ideen", description: "Alles mögliche", color: "sky" });
  const n = k.createOwnNote(b, { title: "Garten", text: "- [ ] Beet\n- [x] Zaun", color: "green", labels: ["draußen"] });
  k.updateOwnNote(Number(n.id.slice(1)), { pinned: true });
  k.updateKeepBoard(b, { inKnowledge: false });

  let cols = c.listCollections();
  const own = cols.find((x) => x.id === `keep:board:${b}`);
  assert.ok(own);
  assert.equal(own.kind, "notes");
  assert.equal(own.plugin, "workspace", "your notes are the Workspace's");
  assert.equal(own.color, "sky");
  assert.equal(own.href, "/workspace", "a board not moved (none is left): the Workspace");
  assert.equal(own.briefing, true);
  assert.equal(own.knowledge, false);
  assert.equal(own.items, 1);
  assert.ok(!cols.some((x) => x.id === "keep:google"), "no Google Keep notes synced: not listed");

  const [it] = c.collectionItems(`keep:board:${b}`)!;
  assert.equal(it.ref, n.ref);
  assert.equal(it.kind, "note");
  assert.equal(it.title, "Garten");
  assert.equal(it.text, "- [ ] Beet\n- [x] Zaun");
  assert.equal(it.color, "green");
  assert.equal(it.pinned, true);
  assert.deepEqual(it.labels, ["draußen"]);
  assert.equal(it.status, null, "a note has no status");

  g.saveKeepNotes([{ id: "abc", kind: "note", title: "Von Google", text: "Hallo", labels: [], color: null, pinned: false, archived: false, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", url: "https://keep.google.com/#NOTE/abc" }], true);
  cols = c.listCollections();
  const google = cols.find((x) => x.id === "keep:google");
  assert.ok(google, "Google Keep is a collection once notes are synced");
  assert.equal(google.readOnly, true, "read-only: nothing changes in Google Keep");

  const byRef = c.itemsByRefs(["keep:abc", n.ref, "keep:n999999"]);
  assert.deepEqual([...byRef.keys()].sort(), ["keep:abc", n.ref].sort());
  assert.equal(byRef.get("keep:abc")!.collectionId, "keep:google");
  assert.equal(byRef.get("keep:abc")!.href, "https://keep.google.com/#NOTE/abc");

  k.updateOwnNote(Number(n.id.slice(1)), { archived: true });
  assert.equal(c.collectionItems(`keep:board:${b}`)!.length, 0, "archived: not among the board's items");
  assert.equal(c.itemsByRefs([n.ref]).get(n.ref)?.archived, true, "but still found by its ref (a todo's source)");
});

test("workspace: a database is a collection, its rows items — status, date, labels from their properties", async () => {
  await install("workspace");
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const c = await import("@/lib/items");
  const status = m.newProperty("Status", "status");
  const due = m.newProperty("Due", "date");
  const owner = m.newProperty("Owner", "person");
  const anna = (await import("@/plugins/people/store")).createPerson({ name: "Anna Berg" });
  const tags = { ...m.newProperty("Tags", "multi_select"), options: [{ id: "o1", name: "Bad", color: "blue" }, { id: "o2", name: "Küche", color: "red" }] };
  const dbId = w.createPage({ kind: "database", title: "Aufgaben", icon: "✅", schema: { titleName: "Task", properties: [status, due, owner, tags], views: [m.newView("Board", "board")] } });
  const row = w.addRow(dbId, { title: "Spiegel", cells: { [status.id]: status.options![1].id, [due.id]: { start: "2026-11-02", end: "2026-11-04" }, [owner.id]: [anna], [tags.id]: ["o1"] } });
  w.updatePage(row, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Rund, 60 cm" }] }] } });
  w.createPage({ title: "Nur eine Seite" });

  const cols = c.listCollections({ plugin: "workspace" }).filter((x) => x.kind === "database");
  assert.deepEqual(cols.map((x) => x.id), [`workspace:${dbId}`], "databases, not plain pages");
  assert.equal(cols[0].kind, "database");
  assert.equal(cols[0].name, "✅ Aufgaben");
  assert.equal(cols[0].href, `/workspace/${dbId}`);
  assert.equal(cols[0].items, 1);

  const [it] = c.collectionItems(`workspace:${dbId}`)!;
  assert.equal(it.ref, `page:${row}`);
  assert.equal(it.kind, "row");
  assert.equal(it.title, "Spiegel");
  assert.equal(it.text, "Rund, 60 cm");
  assert.deepEqual(it.status, { name: "In progress", phase: "doing" });
  assert.equal(it.due, "2026-11-02", "a range: its start");
  assert.equal(it.assignee, "Anna Berg");
  assert.deepEqual(it.labels, ["Bad"]);
  assert.equal(it.href, `/workspace/${row}`);
  assert.equal(c.itemsByRefs([`page:${row}`]).get(`page:${row}`)?.title, "Spiegel");
  assert.equal(c.itemsByRefs([`page:${dbId}`]).size, 0, "a database itself isn't an item");

  assert.equal(cols[0].readOnly, false);
  w.updatePage(dbId, { locked: true });
  assert.equal(c.listCollections({ plugin: "workspace" }).find((x) => x.id === `workspace:${dbId}`)!.readOnly, true, "a locked database is read-only");
});

test("an uninstalled plugin's collections aren't there", async () => {
  await install("keep", "workspace");
  const c = await import("@/lib/items");
  const plugins = () => new Set(c.listCollections().map((x) => x.plugin));
  assert.ok(plugins().has("workspace"));
  assert.ok(!plugins().has("kanban"), "Kanban went: no collections of its own");
  assert.equal(c.collectionItems("kanban:1"), null);
  assert.equal(c.itemsByRefs(["KB-1"]).size, 0);
});
