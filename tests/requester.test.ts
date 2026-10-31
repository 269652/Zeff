import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// Delivered, the one who asked hears of it: a todo made from their message hands its work on (a follow-up, the push, the MR) —
// they're found up the chain, and get a reply todo in their chat with the link (a button in a chat of the two of you).
setupTempData();

async function message(conv: string, id: string, kind: string, sender: string, text: string) {
  const { getSqlite } = await import("@/db");
  getSqlite()
    .prepare("insert into teams_messages (key, kind, conversation_id, message_id, sender_name, sender_id, sent_at, html, text, link, synced_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(`${conv}|${id}`, kind, conv, id, sender, sender, "2026-10-27T08:00:00Z", "", text, "https://teams/x", "x");
  return `teams:${conv}|${id}`;
}
async function todo(ticket: string, text: string, refs: string[], parentId: number | null = null) {
  const { getSqlite } = await import("@/db");
  return (getSqlite()
    .prepare("insert into todos (ticket, text, kind, owner, status, refs, parent_id, created_at, updated_at) values (?, ?, 'implement', 'me', 'open', ?, ?, '2026-10-27 08:01:00', '2026-10-27 08:01:00') returning id")
    .get(ticket, text, JSON.stringify(refs), parentId) as { id: number }).id;
}

test("the asker is found up the chain; delivered, a reply todo in their 1:1 chat — the MR's link in its draft and button, the next delivery updating it", async () => {
  const { requesterOf, tellRequester } = await import("@/lib/todos/requester");
  const { getTodo, listTodos } = await import("@/lib/todos/store");
  const ask = await message("19:a_b@unq.gbl.spaces", "1", "pm", "Christopher Lorenz", "Kannst du PROJ-371 umsetzen?");
  const root = await todo("PROJ-371", "Horizontale Variante umsetzen", [ask]);
  const followUp = await todo("PROJ-371", "Branch testen und abnehmen", [], root);
  const push = await todo("PROJ-371", "Push und MR öffnen", [], followUp);

  assert.deepEqual(await requesterOf(getTodo(push)!), { ref: ask, who: "Christopher Lorenz", channel: "teams", oneOnOne: true });

  const told = await tellRequester(getTodo(push)!, { what: "MR opened: https://git.example.com/p/-/merge_requests/163", link: "https://git.example.com/p/-/merge_requests/163" });
  assert.ok(told);
  assert.equal(told.kind, "reply");
  assert.deepEqual(told.refs, [ask]);
  assert.equal(told.parentId, push);
  assert.equal(told.draft, "Hi Christopher, PROJ-371 ist bereit zum Review: https://git.example.com/p/-/merge_requests/163");
  assert.deepEqual(told.ops, [{ type: "teams-message", to: "Christopher Lorenz", body: told.draft }]);

  // Merged later: the same todo, the newest words.
  const again = await tellRequester(getTodo(push)!, { what: "!163 merged: https://git.example.com/p/-/merge_requests/163", link: "https://git.example.com/p/-/merge_requests/163" });
  assert.equal(again?.id, told.id);
  assert.equal(listTodos({ status: "open" }).filter((t) => t.source?.startsWith("Delivered:")).length, 1);
});

test("a group chat: the reply todo, no button (Zeff posts only in a chat of the two of you); your own message or none: nobody to tell", async () => {
  const { tellRequester } = await import("@/lib/todos/requester");
  const { getTodo } = await import("@/lib/todos/store");
  const group = await message("19:group@thread.v2", "9", "mention", "Jochen Vogt", "@Moritz kannst du PROJ-306 fixen?");
  const t = await todo("PROJ-306", "Newsteaser fixen", [group]);
  const told = await tellRequester(getTodo(t)!, { what: "Pushed feature/PROJ-306", link: null });
  assert.equal(told?.draft, "Hi Jochen, PROJ-306: Pushed feature/PROJ-306");
  assert.deepEqual(told?.ops, []);

  const mine = await message("19:c_d@unq.gbl.spaces", "5", "chat", "Moritz", "Ich mach PROJ-400");
  const own = await todo("PROJ-400", "PROJ-400 umsetzen", [mine]);
  assert.equal(await tellRequester(getTodo(own)!, { what: "Pushed", link: null }), null);
  const none = await todo("PROJ-401", "PROJ-401 umsetzen", []);
  assert.equal(await tellRequester(getTodo(none)!, { what: "Pushed", link: null }), null);
});

test("a worker's Teams reply to the asker: a button when it goes to them in a 1:1 chat (by their message or their name)", async () => {
  const { messageOp } = await import("@/lib/work/outcome");
  const ask = await message("19:e_f@unq.gbl.spaces", "7", "pm", "Anna Berg", "Wann ist das fertig?");
  assert.deepEqual(messageOp({ channel: "teams", target: ask, draft: "Ist gepusht." }, "X-1"), { type: "teams-message", to: "Anna Berg", body: "Ist gepusht." });
  assert.deepEqual(messageOp({ channel: "teams", target: "Anna Berg", draft: "Ist gepusht." }, "X-1"), { type: "teams-message", to: "Anna Berg", body: "Ist gepusht." });
  assert.equal(messageOp({ channel: "teams", target: "teams:19:group@thread.v2|9", draft: "Ist gepusht." }, "X-1"), null);
});
