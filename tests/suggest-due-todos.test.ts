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
  return number;
}
async function todo(ticket: string, text: string, due?: string) {
  const { addFollowUp, setTodoDue } = await import("@/lib/boards/store");
  const t = addFollowUp({ ticket, text, kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  if (due) setTodoDue(t.id, due);
  return t;
}
const today = async () => (await import("@/lib/week")).isoDate(new Date());
const tomorrow = async () => (await import("@/lib/week")).isoDate(new Date(Date.now() + 864e5));

test("todos due today get one booking suggestion per ticket — once, and not for closed or later ones", async () => {
  const { openSuggestions, skipSuggestion } = await import("@/lib/work/suggestions");
  const { setTodoStatus } = await import("@/lib/boards/store");
  const job = await setup("DUE-1");
  const a = await todo("DUE-1", "Answer the customer", await today());
  const b = await todo("DUE-1", "Update the docs", await today());
  const later = await todo("DUE-1", "Not yet", await tomorrow());
  const closed = await todo("DUE-1", "Already done", await today());
  setTodoStatus(closed.id, "done");
  await setup("DUE-2");
  const other = await todo("DUE-2", "Other ticket", await today());

  const open = openSuggestions().filter((s) => s.ticket?.startsWith("DUE-"));
  assert.equal(open.length, 2);
  const one = open.find((s) => s.ticket === "DUE-1")!;
  assert.deepEqual(one.todos.map((t) => t.id).sort(), [a.id, b.id].sort());
  assert.equal(one.job?.number, job);
  assert.equal(one.date, await today());
  assert.equal(one.status, "open");
  assert.ok(!one.todos.some((t) => t.id === later.id || t.id === closed.id));
  assert.deepEqual(open.find((s) => s.ticket === "DUE-2")!.todos.map((t) => t.id), [other.id]);

  // Again: nothing new — and a skipped one stays skipped for the day.
  assert.equal(openSuggestions().filter((s) => s.ticket?.startsWith("DUE-")).length, 2);
  skipSuggestion(one.id);
  assert.equal(openSuggestions().filter((s) => s.ticket === "DUE-1").length, 0);
});

test("\"worked on it\": a suggestion for a todo that isn't done and isn't due — once a day, with its time", async () => {
  const { suggestWorkedOn } = await import("@/lib/work/suggestions");
  const { addTodoTime } = await import("@/lib/work/todo-time");
  const { getTodo } = await import("@/lib/boards/store");
  await setup("DUE-3");
  const t = await todo("DUE-3", "Long running thing");
  addTodoTime({ todoId: t.id, minutes: 40, note: "research", by: "Du", source: "hand" });

  const made = suggestWorkedOn([t.id]);
  assert.equal(made.length, 1);
  assert.equal(made[0].ticket, "DUE-3");
  assert.equal(made[0].hours, 0.75);
  assert.equal(made[0].description, "Long running thing");
  assert.equal(made[0].times.length, 1);
  assert.equal(getTodo(t.id)!.status, "open"); // not marked done

  assert.equal(suggestWorkedOn([t.id]).length, 0); // today's is there already
  const nothing = await todo("DUE-3", "Without time");
  assert.equal(suggestWorkedOn([nothing.id])[0].hours, 0.25);
});
