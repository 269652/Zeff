import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// A reply todo is done once you answered in its thread — right after the sync that brought the answer, no AI; a vague or
// late answer only proposed; opened again (or the proposal turned down), that answer never closes it again.
setupTempData();

const CHAT = "19:a_b@unq.gbl.spaces";
let n = 0;
async function teams(kind: "pm" | "chat", sender: string, senderId: string, at: string, text: string) {
  const { getSqlite } = await import("@/db");
  const id = String(++n);
  getSqlite()
    .prepare("insert into teams_messages (key, kind, conversation_id, message_id, sender_name, sender_id, sent_at, html, text, link, synced_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(`${CHAT}|${id}`, kind, CHAT, id, sender, senderId, at, "", text, "https://teams/x", at);
  return `teams:${CHAT}|${id}`;
}
async function replyTodo(text: string, ref: string, kind = "reply", created = "2026-10-26 09:00:00") {
  const { getSqlite } = await import("@/db");
  const r = getSqlite()
    .prepare("insert into todos (ticket, text, kind, owner, status, refs, created_at, updated_at) values ('', ?, ?, 'me', 'open', ?, ?, ?) returning id")
    .get(text, kind, JSON.stringify([ref]), created, created) as { id: number };
  return r.id;
}

test("answered promptly in your 1:1 chat: done, saying when and what; opened again: that answer doesn't close it again", async () => {
  const { closeTodosByEvidence } = await import("@/lib/boards/evidence-close");
  const { getTodo, setTodoStatus } = await import("@/lib/boards/store");
  const ask = await teams("pm", "Christopher Lorenz", "chris", "2026-10-26T08:55:00Z", "Hast du zu PROJ-339 schon was gepusht?");
  const id = await replyTodo("Christopher Lorenz in Teams antworten: Branch gepusht", ask);
  assert.deepEqual(await closeTodosByEvidence(), { closed: 0, proposed: 0 }, "no answer yet");

  await teams("chat", "Moritz", "me", "2026-10-26T10:37:00Z", "Achje, gar nicht gesehen. Ist gepusht, aber noch ungetestet.");
  assert.deepEqual(await closeTodosByEvidence(), { closed: 1, proposed: 0 });
  const t = getTodo(id)!;
  assert.equal(t.status, "done");
  assert.match(t.note ?? "", /You replied in Teams at \d\d:\d\d: “Achje, gar nicht gesehen/);

  setTodoStatus(id, "open"); // you: not done after all
  assert.deepEqual(await closeTodosByEvidence(), { closed: 0, proposed: 0 }, "the same answer doesn't close it again");
  assert.equal(getTodo(id)!.status, "open");
  // A later answer may.
  await teams("chat", "Moritz", "me", "2026-10-26T11:00:00Z", "Jetzt getestet, PROJ-339 ist ready.");
  assert.equal((await closeTodosByEvidence()).closed, 1);
});

test("a deferral or a clarify todo: only proposed — turned down, not proposed again; an answer before the todo or days later in a chat: nothing", async () => {
  const { closeTodosByEvidence } = await import("@/lib/boards/evidence-close");
  const { getTodo, clearWorkerDone } = await import("@/lib/boards/store");
  const { getSqlite } = await import("@/db");
  getSqlite().prepare("delete from teams_messages").run();
  getSqlite().prepare("delete from todos").run();

  const ask = await teams("pm", "Christopher Lorenz", "chris", "2026-10-27T08:00:00Z", "Kannst du dir PROJ-371 ansehen?");
  const put = await replyTodo("Christopher zu PROJ-371 antworten", ask, "reply", "2026-10-27 08:05:00");
  const clarify = await replyTodo("Mit Christopher klären, ob PROJ-371 Mobile braucht", ask, "clarify", "2026-10-27 08:05:00");
  await teams("chat", "Moritz", "me", "2026-10-27T08:30:00Z", "Schau ich mir später an, melde mich.");
  assert.deepEqual(await closeTodosByEvidence(), { closed: 0, proposed: 2 });
  assert.equal(getTodo(put)!.status, "open");
  assert.equal(getTodo(put)!.workerDone?.suggested, true);
  assert.match(getTodo(clarify)!.workerDone?.note ?? "", /Answered\? You replied in Teams/);

  clearWorkerDone(put); // you: no, not answered
  assert.deepEqual(await closeTodosByEvidence(), { closed: 0, proposed: 0 }, "the turned-down proposal stays turned down");
  assert.equal(getTodo(put)!.workerDone, null);

  // Made after your answer (from what came after it): that answer isn't its answer.
  const late = await replyTodo("Christopher zu PROJ-371 antworten (neu)", ask, "reply", "2026-10-27 09:00:00");
  assert.equal((await closeTodosByEvidence()).closed, 0);
  assert.equal(getTodo(late)!.status, "open");
  // Days later, about something else, in the chat: nothing at all.
  await teams("chat", "Moritz", "me", "2026-10-30T09:00:00Z", "Hast du kurz Zeit für einen Call?");
  assert.deepEqual(await closeTodosByEvidence(), { closed: 0, proposed: 0 });
});
