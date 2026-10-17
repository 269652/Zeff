import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("the documents are a source; the database holds every document, the inbox view the unread ones, and opening or ticking one takes it out", async () => {
  const st = await import("@/plugins/state");
  st.setInstalled("workspace", true);
  st.setInstalled("documents", true);
  const { getSqlite } = await import("@/db");
  const { addDocument } = await import("@/plugins/documents/store");
  const seen = await import("@/plugins/documents/seen");
  // A document from before (older than a week) counts as seen - one of the last days would be unread.
  const old = addDocument("old.txt", Buffer.from("alt")).doc;
  getSqlite().prepare("update documents set created_at = ? where id = ?").run(new Date(Date.now() - 30 * 864e5).toISOString(), old.id);
  assert.equal(seen.isUnread(old.id), false);
  const store = await import("@/plugins/workspace/store");
  const { ensureDocumentDatabases, documentInbox } = await import("@/plugins/workspace/document-databases");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  await ensureDocumentDatabases();
  const inbox = documentInbox()!;
  assert.ok(inbox, "the database is made");
  const schema = store.getDatabase(inbox)!.schema;
  assert.equal(schema.dataType, "documents");
  assert.deepEqual([schema.views[0].type, schema.views[0].app], ["app", "documents"], "the documents app is its first view");
  assert.deepEqual(schema.views.slice(1, 3).map((v) => v.name), ["Inbox", "All"]);
  const unread = () => store.rowsOf(inbox)!.rows.filter((r) => r.cells.docunread === true).map((r) => r.title).sort();
  const all = () => store.rowsOf(inbox)!.rows.map((r) => r.title).sort();
  assert.deepEqual(all(), ["old.txt"], "every document is a row");
  assert.deepEqual(unread(), [], "the old one is read");
  // New documents come in unread.
  const a = addDocument("contract.txt", Buffer.from("Vertrag mit Kündigungsfrist")).doc;
  const b = addDocument("notes.txt", Buffer.from("Notizen")).doc;
  assert.equal(seen.isUnread(a.id), true);
  await runPipeline(inbox, { ai: false });
  assert.deepEqual(unread(), ["contract.txt", "notes.txt"]);
  assert.equal(all().length, 3);
  // Ticking the Unread box off in the row: seen.
  const row = store.rowsOf(inbox)!.rows.find((r) => r.title === "contract.txt")!;
  store.setCell(row.id, "docunread", false);
  await runPipeline(inbox, { ai: false });
  assert.equal(seen.isUnread(a.id), false);
  assert.deepEqual(unread(), ["notes.txt"]);
  // Marked unread again: back.
  seen.markUnread([a.id]);
  await runPipeline(inbox, { ai: false });
  assert.deepEqual(unread(), ["contract.txt", "notes.txt"]);
  // Opened (its file): seen.
  seen.markSeen([b.id]);
  await runPipeline(inbox, { ai: false });
  assert.deepEqual(unread(), ["contract.txt"]);
  // A first version of the baseline marked everything seen: the recent ones are mended once.
  getSqlite().prepare("insert or replace into document_seen (doc_id, at) values (?, ?)").run(b.id, "2026-01-01T00:00:00.000Z");
  getSqlite().prepare("insert or replace into document_seen (doc_id, at) values (?, ?)").run(a.id, "2026-01-01T00:00:00.000Z");
  getSqlite().prepare("insert or replace into document_seen (doc_id, at) values (?, ?)").run(old.id, "2026-01-01T00:00:00.000Z");
  (await import("@/lib/prefs")).setPref("documents.seenBaseline.recent", false);
  assert.equal(seen.isUnread(a.id), true, "mended: the recent document is unread again");
  assert.equal(seen.isUnread(old.id), false, "the old one stays seen");
  // Once: not made again after it was thrown away.
  store.archivePage(inbox);
  await ensureDocumentDatabases();
  assert.equal(documentInbox(), null);
});

test("the first version of the inbox (one table, a filter step on Unread) becomes the documents app, with an Inbox view", async () => {
  const st = await import("@/plugins/state");
  st.setInstalled("workspace", true);
  st.setInstalled("documents", true);
  const store = await import("@/plugins/workspace/store");
  const { setPref } = await import("@/lib/prefs");
  const { newView, newId } = await import("@/plugins/workspace/model");
  const { ensureDocumentDatabases, documentInbox } = await import("@/plugins/workspace/document-databases");
  const id = store.createPage({
    kind: "database",
    title: "Document inbox",
    schema: { titleName: "Name", properties: [], views: [newView("Table", "table"), newView("Gallery", "gallery")], dataType: "documents", pipeline: { steps: [{ id: newId("s"), kind: "source", from: "ext", ext: "documents" }, { id: newId("s"), kind: "filter", match: "all", rules: [{ field: "Unread", op: "is", value: "yes" }] }] } },
  });
  setPref("workspace.docInboxDb", id);
  setPref("workspace.docInboxDb.v2", false);
  assert.equal(documentInbox(), id);
  await ensureDocumentDatabases();
  const s = store.getDatabase(id)!.schema;
  assert.equal(s.views[0].type, "app");
  assert.ok(s.views.some((v) => v.name === "Inbox" && v.filter.rules.length === 1), "an Inbox view for the unread ones");
  assert.ok(s.views.some((v) => v.name === "All"), "its table is now All");
  assert.equal(s.pipeline!.steps.filter((x) => x.kind === "filter").length, 0, "no filter step: every document is a row");
  const count = s.views.length;
  await ensureDocumentDatabases();
  assert.equal(store.getDatabase(id)!.schema.views.length, count, "mended once");
});

test("a document database turned into a mail inbox (View → Inbox: mail and chats as sources, no type) is put right again", async () => {
  const st = await import("@/plugins/state");
  st.setInstalled("workspace", true);
  st.setInstalled("documents", true);
  const store = await import("@/plugins/workspace/store");
  const { setPref } = await import("@/lib/prefs");
  const { newView, newId, newProperty } = await import("@/plugins/workspace/model");
  const { ensureDocumentDatabases, documentInbox } = await import("@/plugins/workspace/document-databases");
  const comm = { ...newProperty("From", "text"), id: "commfrom" };
  const unread = { ...newProperty("Unread", "checkbox"), id: "docunread" };
  const id = store.createPage({
    kind: "database",
    title: "Document inbox",
    schema: {
      titleName: "Name",
      properties: [comm, unread],
      views: [{ ...newView("Inbox", "table"), hidden: ["commfrom"] }, newView("All", "table")],
      pipeline: { steps: [{ id: newId("s"), kind: "source", from: "mail", mail: { recentDays: 30 } }, { id: newId("s"), kind: "source", from: "messages", messages: { recentDays: 14 } }, { id: newId("s"), kind: "source", from: "ext", ext: "documents" }] },
    },
  });
  setPref("workspace.docInboxDb", id);
  setPref("workspace.docInboxDb.v2", true);
  assert.equal(documentInbox(), id);
  await ensureDocumentDatabases();
  const s = store.getDatabase(id)!.schema;
  assert.equal(s.dataType, "documents");
  assert.deepEqual(s.pipeline!.steps.map((x) => (x.kind === "source" ? (x.from === "ext" ? x.ext : x.from) : x.kind)), ["documents"], "only the documents are its source");
  assert.ok(!s.properties.some((p) => p.id.startsWith("comm")), "the mail fields are gone");
  assert.ok(s.properties.some((p) => p.id === "docunread"), "its own fields stay");
  assert.deepEqual([s.views[0].type, s.views[0].app], ["app", "documents"]);
});
