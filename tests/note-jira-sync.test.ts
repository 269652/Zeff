import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

async function board(ticket: string) {
  const { getDb, schema } = await import("@/db");
  getDb().insert(schema.jiraTickets).values({ key: ticket, summary: `Ticket ${ticket}`, status: "Open", statusCategory: "inprogress", url: `https://jira.example/browse/${ticket}`, boardId: 3359, syncedAt: new Date().toISOString() } as never).run();
}
async function todoWithNote(ticket: string, text: string) {
  const { addFollowUp, addTodoUserNote } = await import("@/lib/boards/store");
  const t = addFollowUp({ ticket, text: "Todo", kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  return { todo: t, note: addTodoUserNote(t.id, text).userNotes[0] };
}
/** The Jira users as the briefing run lists them ("Name (username)") on a ticket's facts. */
async function jiraRun(people: string[]) {
  const { getDb, schema } = await import("@/db");
  getDb().insert(schema.boardRuns).values({ status: "ok", jql: "x", tickets: JSON.stringify([{ key: "NS-1", analyzed: true, people }]), result: "{}" } as never).run();
}

test("a person has linked accounts: Jira usernames are tied to people by the names Jira lists them with", async () => {
  const { createPerson, getPerson, listPeople } = await import("@/plugins/people/store");
  const { jiraDirectory, linkJiraAccounts } = await import("@/plugins/people/accounts");
  await jiraRun(["Christopher Lorenz (chrlorenz1)", "Moritz Roessler (morrossl)", "Rico Clemen (riccleme)", "Karl Meier (kmeier)", "Karl Meier (kmeier2)"]);
  assert.equal(jiraDirectory().get("christopher lorenz"), "chrlorenz1");
  const chris = createPerson({ name: "Christopher Lorenz" });
  const rico = createPerson({ name: "Rico", aliases: ["Rico Clemen"] }); // by an alias
  const karl = createPerson({ name: "Karl Meier" }); // two Jira users of that name: not guessed
  const nobody = createPerson({ name: "Lisa Unbekannt" });
  assert.equal(linkJiraAccounts(), 2);
  assert.deepEqual(getPerson(chris)!.accounts, [{ kind: "jira", value: "chrlorenz1" }]);
  assert.deepEqual(getPerson(rico)!.accounts, [{ kind: "jira", value: "riccleme" }]);
  assert.deepEqual(getPerson(karl)!.accounts, []);
  assert.deepEqual(getPerson(nobody)!.accounts, []);
  assert.equal(linkJiraAccounts(), 0, "once");
  assert.ok(listPeople().length >= 4);
});

test("an account can be added and taken away by hand, and finds the person", async () => {
  const { createPerson, getPerson, addAccount, removeAccount, personByAccount } = await import("@/plugins/people/store");
  const id = createPerson({ name: "Jenny Lehrl" });
  assert.equal(addAccount(id, "jira", "jenlehrl1"), true);
  assert.equal(addAccount(id, "jira", "jenlehrl1"), false);
  assert.equal(personByAccount("jira", "JENLEHRL1")?.id, id);
  removeAccount(id, "jira", "jenlehrl1");
  assert.deepEqual(getPerson(id)!.accounts, []);
});

test("@-tagged people become Jira mentions: by name, alias or username; people without an account stay plain and are reported", async () => {
  const { createPerson, addAccount } = await import("@/plugins/people/store");
  const { mentionsToJira } = await import("@/plugins/people/accounts");
  const hannes = createPerson({ name: "Hannes Beispiel", aliases: ["Hanni"] });
  addAccount(hannes, "jira", "hbeispiel");
  const dora = createPerson({ name: "Dora Muster" });
  addAccount(dora, "jira", "dmuster");
  createPerson({ name: "Lotte Ohne" });
  const r = mentionsToJira("@Hannes Beispiel bitte prüfen, @Hanni auch; @dmuster und @Lotte Ohne wissen Bescheid. Hannes Beispiel ohne @ bleibt. mail@example.com bleibt.");
  assert.equal(r.text, "[~hbeispiel] bitte prüfen, [~hbeispiel] auch; [~dmuster] und Lotte Ohne wissen Bescheid. Hannes Beispiel ohne @ bleibt. mail@example.com bleibt.");
  assert.deepEqual(r.mentioned.sort(), ["dmuster", "hbeispiel"]);
  assert.deepEqual(r.noAccount, ["Lotte Ohne"]);
});

test("your note on a todo can be edited", async () => {
  const { updateTodoUserNote, getTodo } = await import("@/lib/boards/store");
  const { todo, note } = await todoWithNote("NS-2", "Erster Text");
  const t = updateTodoUserNote(todo.id, note.at, "  Zweiter Text  ");
  assert.equal(t.userNotes[0].text, "Zweiter Text");
  assert.equal(t.userNotes[0].at, note.at, "it stays where it was");
  assert.throws(() => updateTodoUserNote(todo.id, note.at, "   "), /empty/i);
  assert.throws(() => updateTodoUserNote(todo.id, "2000-01-01T00:00:00.000Z", "x"), /isn't there|not found/i);
  assert.equal(getTodo(todo.id)!.userNotes.length, 1);
});

test("a note is synced to the todo's Jira ticket as a comment — mentions translated; edited, the comment is edited; a run's report isn't a note to sync", async () => {
  await board("NS-3");
  const { createPerson, addAccount } = await import("@/plugins/people/store");
  const { syncNoteToJira } = await import("@/lib/jira/note-sync");
  const { updateTodoUserNote, getTodo, addTodoAiNote } = await import("@/lib/boards/store");
  const chris = createPerson({ name: "Christopher Lorenz" });
  addAccount(chris, "jira", "chrlorenz1");
  const { todo, note } = await todoWithNote("NS-3", "@Christopher Lorenz bitte die Navigation-Story prüfen");
  const calls: { op: string; ticket: string; body: string; id?: string }[] = [];
  const deps = {
    post: async (ticket: string, body: string) => (calls.push({ op: "add", ticket, body }), "10001"),
    edit: async (ticket: string, id: string, body: string) => void calls.push({ op: "edit", ticket, body, id }),
  };
  const r = await syncNoteToJira(todo.id, note.at, deps);
  assert.deepEqual(calls, [{ op: "add", ticket: "NS-3", body: "[~chrlorenz1] bitte die Navigation-Story prüfen" }]);
  assert.equal(r.state, "posted");
  const synced = getTodo(todo.id)!.userNotes[0];
  assert.equal(synced.jiraCommentId, "10001");
  assert.equal(synced.url, "https://jira.example/browse/NS-3?focusedCommentId=10001&page=com.atlassian.jira.plugin.system.issuetabpanels%3Acomment-tabpanel#comment-10001");

  // Again (nothing changed): the comment is written again as it should be — idempotent, it repairs whatever is on Jira.
  assert.equal((await syncNoteToJira(todo.id, note.at, deps)).state, "synced");
  assert.deepEqual(calls[1], { op: "edit", ticket: "NS-3", id: "10001", body: "[~chrlorenz1] bitte die Navigation-Story prüfen" });
  assert.equal(calls.length, 2, "one edit, no second comment");

  updateTodoUserNote(todo.id, note.at, "@Christopher Lorenz bitte jetzt auch die Pipeline prüfen");
  assert.equal((await syncNoteToJira(todo.id, note.at, deps)).state, "updated");
  assert.deepEqual(calls[2], { op: "edit", ticket: "NS-3", id: "10001", body: "[~chrlorenz1] bitte jetzt auch die Pipeline prüfen" });

  addTodoAiNote(todo.id, { text: "Report", by: "W-1 · Claude" });
  const report = getTodo(todo.id)!.userNotes.find((n) => n.by)!;
  await assert.rejects(syncNoteToJira(todo.id, report.at, deps), /your own notes/i);
});

test("only a ticket Zeff knows from a Jira board can be synced to", async () => {
  const { syncNoteToJira } = await import("@/lib/jira/note-sync");
  const { todo, note } = await todoWithNote("KB-9", "Eine Notiz");
  await assert.rejects(syncNoteToJira(todo.id, note.at, { post: async () => "1", edit: async () => {} }), /Jira board/i);
  const none = await todoWithNote("", "Ohne Ticket");
  await assert.rejects(syncNoteToJira(none.todo.id, none.note.at, { post: async () => "1", edit: async () => {} }), /ticket/i);
});

test("a tagged person whose Jira user Zeff knows by name but hasn't linked yet is linked when the note is synced — and a comment already posted as plain text is edited to the mention", async () => {
  await board("NS-4");
  await jiraRun(["Anna Verlinkt (averlinkt)"]);
  const { createPerson, getPerson } = await import("@/plugins/people/store");
  const { syncNoteToJira } = await import("@/lib/jira/note-sync");
  const { getTodo } = await import("@/lib/boards/store");
  const anna = createPerson({ name: "Anna Verlinkt" });
  assert.deepEqual(getPerson(anna)!.accounts, []);
  const { todo, note } = await todoWithNote("NS-4", "@Anna Verlinkt bitte testen");
  const calls: { op: string; body: string }[] = [];
  const deps = { post: async (_t: string, body: string) => (calls.push({ op: "add", body }), "20001"), edit: async (_t: string, _id: string, body: string) => void calls.push({ op: "edit", body }) };
  const r = await syncNoteToJira(todo.id, note.at, deps);
  assert.deepEqual(calls, [{ op: "add", body: "[~averlinkt] bitte testen" }]);
  assert.deepEqual(r.noAccount, []);
  assert.deepEqual(getPerson(anna)!.accounts, [{ kind: "jira", value: "averlinkt" }]);
  assert.equal(getTodo(todo.id)!.userNotes[0].jiraCommentId, "20001");

  // Posted earlier as plain words (no account was known then): syncing again edits the comment.
  const { updateTodoUserNote, markNoteSynced } = await import("@/lib/boards/store");
  const old = await todoWithNote("NS-4", "@Anna Verlinkt noch eine Notiz");
  markNoteSynced(old.todo.id, old.note.at, { commentId: "20002", hash: "plain-words-hash", url: null });
  assert.equal((await syncNoteToJira(old.todo.id, old.note.at, deps)).state, "updated");
  assert.deepEqual(calls[1], { op: "edit", body: "[~averlinkt] noch eine Notiz" });
  void updateTodoUserNote;
});

test("a comment that is gone from Jira is made again; any other failure is reported and nothing is marked", async () => {
  await board("NS-5");
  const { syncNoteToJira } = await import("@/lib/jira/note-sync");
  const { getTodo } = await import("@/lib/boards/store");
  const { todo, note } = await todoWithNote("NS-5", "Eine Notiz für Jira");
  let next = 30000;
  const base = { post: async () => String(++next) };
  await syncNoteToJira(todo.id, note.at, { ...base, edit: async () => {} });
  const first = getTodo(todo.id)!.userNotes[0].jiraCommentId;
  assert.equal(first, "30001");
  // Someone deleted the comment on Jira: the edit finds nothing — the note is posted again, its new id kept.
  const r = await syncNoteToJira(todo.id, note.at, { ...base, edit: async () => { throw new Error("Comment 30001 does not exist (404 Not Found)"); } });
  assert.equal(r.state, "reposted");
  assert.equal(getTodo(todo.id)!.userNotes[0].jiraCommentId, "30002");
  // Another failure (Jira down): reported, the note keeps what it had.
  await assert.rejects(syncNoteToJira(todo.id, note.at, { ...base, edit: async () => { throw new Error("connection refused"); } }), /connection refused/);
  assert.equal(getTodo(todo.id)!.userNotes[0].jiraCommentId, "30002");
});

test("a note tells whether it still matches its comment on Jira: not synced, in sync, or changed since the last sync", async () => {
  await board("NS-6");
  const { noteSyncState } = await import("@/lib/boards/shared");
  const { syncNoteToJira } = await import("@/lib/jira/note-sync");
  const { updateTodoUserNote, getTodo } = await import("@/lib/boards/store");
  const { todo, note } = await todoWithNote("NS-6", "Erster Stand");
  assert.equal(noteSyncState(getTodo(todo.id)!.userNotes[0]), "none");
  await syncNoteToJira(todo.id, note.at, { post: async () => "40001", edit: async () => {} });
  assert.equal(getTodo(todo.id)!.userNotes[0].jiraText, "Erster Stand");
  assert.equal(noteSyncState(getTodo(todo.id)!.userNotes[0]), "synced");
  updateTodoUserNote(todo.id, note.at, "Zweiter Stand");
  assert.equal(noteSyncState(getTodo(todo.id)!.userNotes[0]), "changed");
  await syncNoteToJira(todo.id, note.at, { post: async () => "x", edit: async () => {} });
  assert.equal(noteSyncState(getTodo(todo.id)!.userNotes[0]), "synced");
  // Posted before Zeff kept what was synced: not known to match — offered again.
  assert.equal(noteSyncState({ text: "alt", jiraCommentId: "1" }), "changed");
  assert.equal(noteSyncState({ text: "alt", by: "W-1" }), "none");
});
