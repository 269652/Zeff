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

  assert.equal((await syncNoteToJira(todo.id, note.at, deps)).state, "unchanged");
  assert.equal(calls.length, 1, "not twice");

  updateTodoUserNote(todo.id, note.at, "@Christopher Lorenz bitte jetzt auch die Pipeline prüfen");
  assert.equal((await syncNoteToJira(todo.id, note.at, deps)).state, "updated");
  assert.deepEqual(calls[1], { op: "edit", ticket: "NS-3", id: "10001", body: "[~chrlorenz1] bitte jetzt auch die Pipeline prüfen" });

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
