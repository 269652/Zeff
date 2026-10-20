import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * A todo that comes back (a rate to pay on the 15th of every month): its rule is kept on it, the calendar shows the series, and when it is
 * done the next one is there — the same text and actions, due on the next day the rule names.
 */
const monthly15 = { freq: "monthly" as const, interval: 1 };

test("the next day a rule names after a due day — never one that has passed already", async () => {
  const { nextDue } = await import("@/lib/boards/recurring");
  assert.equal(nextDue(monthly15, "2026-10-15", "2026-10-15"), "2026-11-15");
  assert.equal(nextDue(monthly15, "2026-10-15", "2026-10-20"), "2026-11-15");
  assert.equal(nextDue(monthly15, "2026-10-15", "2027-01-03"), "2027-01-15", "done late: the next one still to come");
  assert.equal(nextDue({ ...monthly15, count: 1 }, "2026-11-15", "2026-11-15"), null, "the last of its count");
  assert.equal(nextDue({ ...monthly15, until: "2026-12-31" }, "2026-12-15", "2026-12-15"), null);
});

test("a todo with a rule: done, the next is made on the next day; the calendar has the series; the rule can be taken away", async () => {
  const { addManualTodo, getTodo, listTodos, setTodoStatus, setTodoDue } = await import("@/lib/boards/store");
  const { setRecurrence } = await import("@/lib/boards/recurring");
  const { listCalendars, eventsBetween } = await import("@/lib/calendar/ir");
  const t = addManualTodo({ ticket: "KB-2", text: "300 € auf das Dienstkonto überweisen (Az. DR II 1121/26)" });
  setTodoDue(t.id, "2026-11-15");
  setRecurrence(t.id, monthly15);
  assert.deepEqual(getTodo(t.id)!.recurrence, monthly15);
  // The calendar: one series, all day, from the due day, on the todo.
  assert.ok(listCalendars().length >= 1);
  const inCal = eventsBetween("2026-11-01", "2027-02-01").filter((e) => e.todoId === t.id);
  assert.deepEqual(inCal.map((e) => e.start.slice(0, 10)), ["2026-11-15", "2026-12-15", "2027-01-15"]);
  assert.match(inCal[0].title, /300 €/);
  // Done: the next one pops up.
  setTodoStatus(t.id, "done");
  const next = listTodos({ status: "open" }).find((x) => x.text === t.text);
  assert.ok(next, "the next one is open");
  assert.notEqual(next!.id, t.id);
  assert.equal(next!.due, "2026-12-15");
  assert.deepEqual(next!.recurrence, monthly15);
  assert.equal(getTodo(t.id)!.status, "done");
  // Still one series in the calendar, now on the next todo.
  const after = eventsBetween("2026-11-01", "2027-02-01").filter((e) => e.title.includes("300 €"));
  assert.equal(after.length, 3);
  // Without a rule it stays done.
  setRecurrence(next!.id, null);
  assert.equal(eventsBetween("2026-11-01", "2027-02-01").filter((e) => e.title.includes("300 €")).length, 0, "the series is gone");
  setTodoStatus(next!.id, "done");
  assert.equal(listTodos({ status: "open" }).filter((x) => x.text === t.text).length, 0);
});

test("a todo dropped (not done) does not come back", async () => {
  const { addManualTodo, listTodos, setTodoStatus, setTodoDue } = await import("@/lib/boards/store");
  const { setRecurrence } = await import("@/lib/boards/recurring");
  const t = addManualTodo({ ticket: "KB-2", text: "Etwas anderes monatlich erledigen" });
  setTodoDue(t.id, "2026-11-01");
  setRecurrence(t.id, monthly15);
  setTodoStatus(t.id, "dismissed");
  assert.equal(listTodos({ status: "open" }).filter((x) => x.text === t.text).length, 0);
});
