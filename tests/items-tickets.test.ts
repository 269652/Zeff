import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Own ticket keys: Kanban's KB-<id> and the Workspace's WS-<id> — never Jira's. */
test("ticket keys: KB- and WS- are your own, not Jira's", async () => {
  const k = await import("@/lib/ticket-keys");
  for (const key of ["KB-12", "ws-7", " WS-1 "]) assert.ok(k.isOwnKey(key) && k.isTicketKey(key) && !k.isJiraKey(key), key);
  for (const key of ["PROJ-12", "WSX-1", "KBB-2"]) assert.ok(!k.isOwnKey(key) && k.isJiraKey(key), key);
});

/** The heavier modules of a ticket's detail view, fetched when it opens: questions, actions, flags, context, chat. */
test("ticketDetail: what the briefing knows beyond the lead — by key", async () => {
  const { getSqlite } = await import("@/db");
  const { ticketDetail } = await import("@/lib/items/tickets");
  const d = getSqlite();
  d.exec("create table if not exists ticket_lage (key text primary key, hash text not null, result text not null, model text, analyzed_at text not null)");
  d.prepare("insert or replace into ticket_lage (key, hash, result, model, analyzed_at) values (?, '', ?, null, ?)").run("PROJ-77", JSON.stringify({ attention: "blocked", lead: "Wartet.", summary: "", happened: [], flags: ["Rückfrage seit 03.10. offen"] }), new Date().toISOString());
  const x = ticketDetail("proj-77");
  assert.deepEqual(x.flags, ["Rückfrage seit 03.10. offen"]);
  assert.deepEqual(x.actions, []);
  assert.deepEqual(x.questions, []);
  assert.ok(Array.isArray(x.context) && Array.isArray(x.chat));
  assert.deepEqual(ticketDetail("NOPE-1").flags, []);
});
