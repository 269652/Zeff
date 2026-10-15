import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The knowledge reads what you keep through collections: the items of every collection in the
 * knowledge (archived ones too), a document each, in its collection's space.
 */
test("knowledge: items of the collections in the knowledge are documents, archived ones too", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("keep", true);
  setInstalled("signal", true);
  const k = await import("@/plugins/keep/boards");
  const g = await import("@/plugins/keep/store");
  const { collectionProviders } = await import("@/lib/items/point");
  const { knowledgeDocs } = await import("@/plugins/knowledge/export");

  const b = k.createKeepBoard({ name: "Ideen" });
  const off = k.createKeepBoard({ name: "Geheim" });
  k.updateKeepBoard(off, { inKnowledge: false });
  const n = k.createOwnNote(b, { title: "Garten", text: "Beet anlegen", labels: ["draußen"] });
  k.updateOwnNote(Number(n.id.slice(1)), { pinned: true, archived: true });
  k.createOwnNote(off, { title: "Pin", text: "1234" });
  g.saveKeepNotes([{ id: "g1", kind: "list", title: "", text: "☐ Milch", labels: [], color: null, pinned: false, archived: false, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", url: "https://keep.google.com/#LIST/g1" }], true);

  const row = { ref: "page:5", collectionId: "db", kind: "row" as const, title: "Entscheidung", text: "Wir nehmen Postgres", labels: [], status: { name: "Decided", phase: "done" as const }, due: null, assignee: null, color: null, pinned: false, archived: false, parentRef: null, href: "/workspace/5", createdAt: null, updatedAt: "2026-10-03T00:00:00Z" };
  collectionProviders.contribute("signal", {
    collections: () => [{ id: "db", plugin: "signal", kind: "database", name: "Entscheidungen", description: "", color: null, href: "/x", readOnly: false, briefing: false, knowledge: true, items: 1 }],
    items: (id) => (id === "db" ? [row] : null),
    byRefs: () => [],
  });

  const docs = knowledgeDocs("http://zeff").docs;
  const byId = new Map(docs.map((d) => [d.id, d]));
  const own = byId.get(n.ref);
  assert.ok(own, "an archived note of a board in the knowledge is in");
  assert.equal(own.space, "Keep · Ideen");
  assert.equal(own.title, "Garten");
  assert.equal(own.body, "Notiz in „Ideen“ · Labels: draußen · angeheftet · archiviert\n\nBeet anlegen");
  assert.equal(own.url, "", "a note of yours has no outside link");

  const google = byId.get("keep:g1");
  assert.ok(google);
  assert.equal(google.space, "Google Keep");
  assert.equal(google.title, "☐ Milch");
  assert.equal(google.url, "https://keep.google.com/#LIST/g1");

  const r = byId.get("page:5");
  assert.ok(r, "any collection in the knowledge brings its items");
  assert.equal(r.space, "Entscheidungen");
  assert.equal(r.body, "Eintrag in „Entscheidungen“ · Status: Decided\n\nWir nehmen Postgres");

  assert.ok(!docs.some((d) => d.body.includes("1234")), "a board out of the knowledge stays out");

  const keepOnly = knowledgeDocs("http://zeff", "keep").docs.map((d) => d.id).sort();
  assert.deepEqual(keepOnly, ["keep:g1", n.ref].sort(), "the knowledge server's Google Keep source: Keep's only");
  setInstalled("signal", false);
});
