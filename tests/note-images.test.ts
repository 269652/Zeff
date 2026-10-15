import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function todoOn(ticket: string) {
  const { addFollowUp } = await import("@/lib/boards/store");
  // (each todo its own words: todos that only repeat each other aren't made twice)
  return addFollowUp({ ticket, text: `Aufgabe ${Math.random().toString(36).slice(2, 10)} ${Math.random().toString(36).slice(2, 10)}`, kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
}
async function picture(name: string, described: string) {
  const { addDocument, setExtracted, setStatus } = await import("@/plugins/documents/store");
  const { doc } = addDocument(name, Buffer.concat([PNG, Buffer.from(name)]), "image/png");
  // What the Documents plugin makes of a picture: what it shows and the text in it.
  setExtracted(doc.id, described);
  setStatus(doc.id, "ready");
  return doc;
}

/** A picture in a note is a file of the todo, known to the AI that works on it and reviews it. */
test("pictures in a note become files of the todo; the brief, the AI review and the search know them", async () => {
  const { addTodoUserNote, getTodo } = await import("@/lib/boards/store");
  const { linkNoteImages, todoAttachments, parseDocQuery } = await import("@/plugins/documents/attachments");
  const { briefFor } = await import("@/lib/work/brief");
  const { SEARCHERS } = await import("@/lib/rag");
  const { searchDocumentsAction } = await import("@/plugins/documents/server-actions");
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("documents", true);

  const doc = await picture("Fehlerdialog.png", "Screenshot: Dialog „Speichern fehlgeschlagen“ mit rotem Rahmen im Formular Kontakt");
  const todo = await todoOn("IMG-1");
  const withNote = addTodoUserNote(todo.id, `Das passiert beim Speichern:\n![Fehlerdialog](doc:${doc.id})\nBitte prüfen.`);
  assert.equal(withNote.refs.includes(doc.ref), false, "not attached yet");
  assert.equal(await linkNoteImages(todo.id, withNote.userNotes[0].text), 1);
  assert.equal(await linkNoteImages(todo.id, withNote.userNotes[0].text), 0, "once");
  const t = getTodo(todo.id)!;
  assert.deepEqual(todoAttachments(t.refs).map((d) => d.name), ["Fehlerdialog.png"]);

  // The brief of whoever works on it (todo_context): the attachment, what it shows — and to look at it with todo_attachment.
  const brief = briefFor(t);
  assert.match(brief, /## Anhänge/);
  assert.match(brief, /\[doc:\d+\] Bild „Fehlerdialog\.png“/);
  assert.match(brief, /Speichern fehlgeschlagen/);
  assert.match(brief, /todo_attachment/);
  assert.match(brief, new RegExp(`!\\[Fehlerdialog\\]\\(doc:${doc.id}\\)`)); // (the note keeps its inline reference)

  // The AI review of the todo after a note (prompt) and the briefing's todo lines name it.
  const { attachmentLine } = await import("@/plugins/documents/attachments");
  assert.match(attachmentLine(todoAttachments(t.refs)[0], 240), /^\[doc:\d+\] Bild „Fehlerdialog\.png“ \(.*\): Screenshot: Dialog/);

  // RAG: what the picture shows is searchable (the review may look it up when its description isn't enough).
  const hits = await SEARCHERS.documents(["speichern", "fehlgeschlagen"], "speichern fehlgeschlagen");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].ref, doc.ref);
  assert.equal(hits[0].source, "documents");

  // The editor's search (typing ![title]( ): pictures first, matched by what they show.
  const other = await picture("Anderes.png", "Logo der Firma");
  const found = await searchDocumentsAction("dialog");
  assert.deepEqual(found.map((f) => f.id), [doc.id]);
  assert.deepEqual((await searchDocumentsAction("")).map((f) => f.id).sort(), [doc.id, other.id].sort());
  assert.equal(parseDocQuery("doc:12"), 12);
  assert.equal(parseDocQuery("D-12"), 12);
  assert.equal(parseDocQuery("x"), null);
});

/** The note on Jira: the pictures go up as attachments first, then the comment names them. */
test("syncing a note with pictures uploads them to the ticket first, then references them in the comment", async () => {
  const { getDb, schema } = await import("@/db");
  const { addTodoUserNote, getTodo } = await import("@/lib/boards/store");
  const { syncNoteToJira, noteBodyForJira, noteImageFiles } = await import("@/lib/jira/note-sync");
  const { documentFile } = await import("@/plugins/documents/store");
  getDb().insert(schema.jiraTickets).values({ key: "IMG-2", summary: "Ticket", status: "Open", statusCategory: "inprogress", url: "https://jira.example/browse/IMG-2", boardId: 3359, syncedAt: new Date().toISOString() } as never).run();
  const doc = await picture("Mock-up.png", "Entwurf der Startseite");
  const todo = await todoOn("IMG-2");
  const at = addTodoUserNote(todo.id, `So soll es aussehen: ![Entwurf](doc:${doc.id}) und das war's.`).userNotes[0].at;
  const calls: string[] = [];
  const deps = {
    post: async (_t: string, body: string) => (calls.push(`post:${body}`), "9001"),
    edit: async (_t: string, _c: string, body: string) => void calls.push(`edit:${body}`),
    attach: async (t: string, paths: string[]) => void calls.push(`attach:${t}:${paths.map((p) => fs.existsSync(p)).join(",")}`),
  };
  const r = await syncNoteToJira(todo.id, at, deps);
  assert.equal(r.state, "posted");
  const stored = documentFile(doc.id)!;
  const name = stored.path.split(/[\\/]/).pop()!;
  assert.deepEqual(calls, ["attach:IMG-2:true", `post:So soll es aussehen: ![](${name}) und das war's.`], "the file first, then the comment that names it");
  assert.deepEqual(getTodo(todo.id)!.userNotes[0].jiraFiles, [doc.id]);

  // Synced again (the note edited): the picture is not uploaded twice.
  calls.length = 0;
  const { updateTodoUserNote } = await import("@/lib/boards/store");
  updateTodoUserNote(todo.id, at, `Neu: ![Entwurf](doc:${doc.id})`);
  const again = await syncNoteToJira(todo.id, at, deps);
  assert.equal(again.state, "updated");
  assert.deepEqual(calls, [`edit:Neu: ![](${name})`]);

  // A picture whose file is gone is only its title; the helpers on their own.
  assert.equal(noteBodyForJira("a ![Titel](doc:99) b ![](doc:5)", [{ id: 5, name: "x.png" }]), "a Titel b ![](x.png)");
  assert.equal(noteImageFiles("![x](doc:999999)").length, 0);
});

/** The page is told after the data is written — a refresh on the announcement finds the closed todo and the next one. */
test("closing a todo and making a follow-up announce the change only once it is written", async () => {
  const { onChange } = await import("@/lib/events");
  const { addFollowUp, setTodoStatus, listTodos, getTodo } = await import("@/lib/boards/store");
  const todo = await todoOn("EV-1");
  // A planned step: closing the todo makes it the next todo (afterDone).
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  getDb().update(schema.todos).set({ planned: JSON.stringify([{ path: null, steps: [{ text: `Nächster Schritt ${Math.random().toString(36).slice(2, 8)} xyzzy`, kind: "other", owner: "me", ops: [] }] }]) }).where(eq(schema.todos.id, todo.id)).run();
  const seen: { status: string; open: number }[] = [];
  const off = onChange((topic) => {
    if (topic === "todos") seen.push({ status: getTodo(todo.id)!.status, open: listTodos({ ticket: "EV-1", status: "open" }).length });
  });
  try {
    setTodoStatus(todo.id, "done", "fertig");
    assert.ok(seen.length >= 1);
    // At every announcement the todo is closed AND its follow-up is there: nothing a page could see half done.
    assert.ok(seen.every((s) => s.status === "done" && s.open === 1), JSON.stringify(seen));
    seen.length = 0;
    addFollowUp({ ticket: "EV-1", text: `Noch etwas ${Math.random().toString(36).slice(2, 8)} qwertz`, kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
    assert.ok(seen.length >= 1 && seen.every((s) => s.open === 2), JSON.stringify(seen));
  } finally {
    off();
  }
});

/** What a paste does with the Documents plugin still off (as on your system): it installs it, uploads the picture, attaches it. */
test("pasting a picture into a note works with the Documents plugin off: it installs it, uploads, attaches", async () => {
  const { setInstalled, isInstalled } = await import("@/plugins/state");
  const { ensureDocumentsAction, attachDocumentAction } = await import("@/plugins/documents/server-actions");
  const { POST } = await import("@/app/api/documents/route");
  const { getTodo } = await import("@/lib/boards/store");
  setInstalled("documents", false);
  assert.equal(isInstalled("documents"), false);
  // Off: the upload route is not there.
  const form = () => {
    const fd = new FormData();
    fd.append("files", new File([PNG], "Bild 2026-10-14 13-30-00.png", { type: "image/png" }));
    return fd;
  };
  assert.equal((await POST(new Request("http://localhost:9333/api/documents", { method: "POST", body: form(), headers: { origin: "http://localhost:9333" } }))).status, 404);
  // The first picture installs it …
  const ready = await ensureDocumentsAction();
  assert.equal(ready?.ok, true);
  assert.match(ready?.message ?? "", /installed/);
  assert.equal(isInstalled("documents"), true);
  assert.equal((await ensureDocumentsAction())?.message, undefined, "once");
  // … and the upload goes through, from Zeff's own page; the picture is attached to the todo.
  const res = await POST(new Request("http://localhost:9333/api/documents", { method: "POST", body: form(), headers: { origin: "http://localhost:9333" } }));
  const body = (await res.json()) as { ok: boolean; documents: { id: number; ref: string; name: string }[] };
  assert.equal(body.ok, true);
  const todo = await todoOn("IMG-9");
  assert.equal((await attachDocumentAction(todo.id, body.documents[0].id))?.ok, true);
  assert.deepEqual(getTodo(todo.id)!.refs.includes(body.documents[0].ref), true);
});
