import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

async function setup(ticket: string) {
  const { createJob } = await import("@/lib/jobs");
  const { getDb, schema } = await import("@/db");
  const { setTicketJob } = await import("@/lib/jira/store");
  const number = String(100000 + Math.floor(Math.random() * 800000));
  createJob({ number, name: `Job ${ticket}` });
  getDb().insert(schema.jiraTickets).values({ key: ticket, summary: `Ticket ${ticket}`, status: "Open", statusCategory: "indeterminate", syncedAt: new Date().toISOString() } as never).run();
  setTicketJob(ticket, number);
}
async function todo(ticket: string, text: string) {
  const { addFollowUp } = await import("@/lib/boards/store");
  return addFollowUp({ ticket, text, kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
}

test("time tracked today on todos that aren't done shows up in Done today, grouped by ticket with the done ones", async () => {
  await setup("DT-1");
  const { setTodoStatus, getTodo } = await import("@/lib/boards/store");
  const { addTodoTime } = await import("@/lib/work/todo-time");
  const { doneToday } = await import("@/lib/work/booking");
  const done = await todo("DT-1", "Done by hand");
  setTodoStatus(done.id, "done");
  const tracked = await todo("DT-1", "Still going");
  addTodoTime({ todoId: tracked.id, minutes: 30, note: "research", by: "Du", source: "hand" });
  const old = await todo("DT-1", "Only yesterday");
  addTodoTime({ todoId: old.id, minutes: 20, note: "old", by: "Du", source: "hand", at: new Date(Date.now() - 36 * 3600000).toISOString() });
  await setup("DT-2");
  const other = await todo("DT-2", "Other ticket, open");
  addTodoTime({ todoId: other.id, minutes: 15, note: "call", by: "Du", source: "hand" });
  const quiet = await todo("DT-2", "Nothing tracked");

  const items = doneToday().filter((i) => i.ticket.startsWith("DT-"));
  assert.deepEqual(items.map((i) => i.ticket).sort(), ["DT-1", "DT-2"]);
  const one = items.find((i) => i.ticket === "DT-1")!;
  assert.deepEqual(one.todoIds.sort(), [done.id, tracked.id].sort());
  assert.deepEqual(one.todos.map((t) => [t.ref, t.done]).sort(), [[`T-${done.id}`, true], [`T-${tracked.id}`, false]].sort());
  // 30 min tracked today + the 20 min of the ticket's other todo (related: its unbooked time flows in) = 50 min → 1 h, + a quarter for the one done by hand
  assert.equal(one.hours, 1.25);
  assert.ok(one.time.some((l) => l.kind === "record" && l.minutes === 30 && !l.related));
  assert.ok(one.time.some((l) => l.kind === "record" && l.minutes === 20 && l.related));
  assert.ok(!items.some((i) => i.todoIds.includes(quiet.id) || i.todoIds.includes(old.id)));
  assert.equal(getTodo(tracked.id)!.status, "open");
});

test("booking it books the tracked time but leaves the open todo open for tomorrow", async () => {
  await setup("DT-3");
  const { getTodo, setTodoStatus } = await import("@/lib/boards/store");
  const { addTodoTime, listTodoTimes } = await import("@/lib/work/todo-time");
  const { doneToday, bookDoneToday } = await import("@/lib/work/booking");
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const done = await todo("DT-3", "Closed");
  setTodoStatus(done.id, "done");
  const open = await todo("DT-3", "Open");
  addTodoTime({ todoId: open.id, minutes: 45, note: "work", by: "Du", source: "hand" });
  const group = doneToday().find((i) => i.ticket === "DT-3")!;
  const r = bookDoneToday({ ticket: "DT-3", todoIds: group.todoIds, hours: group.hours, description: group.description, context: false });
  assert.ok(r.entryId);
  const entryOf = (id: number) => getDb().select({ e: schema.todos.entryId }).from(schema.todos).where(eq(schema.todos.id, id)).get()!.e;
  assert.equal(entryOf(done.id), r.entryId);
  assert.equal(entryOf(open.id), null); // not booked as a todo — more time can come
  assert.equal(listTodoTimes([open.id])[0].entryId, r.entryId); // its time is
  assert.equal(getTodo(open.id)!.status, "open");
  assert.equal(doneToday().filter((i) => i.ticket === "DT-3").length, 0);
  addTodoTime({ todoId: open.id, minutes: 10, note: "more", by: "Du", source: "hand" });
  assert.equal(doneToday().filter((i) => i.ticket === "DT-3").length, 1);
});
