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

test("the first due day is a one-off: pay today, the repeats begin on the 15th — two appointments, the series from its start; regenerated on demand", async () => {
  const { addManualTodo, getTodo, listTodos, setTodoStatus, setTodoDue } = await import("@/lib/boards/store");
  const { setRecurrence, regenerateSeries, nextDue } = await import("@/lib/boards/recurring");
  const { eventsBetween } = await import("@/lib/calendar/ir");
  assert.equal(nextDue({ ...monthly15, start: "2026-11-15" }, "2026-10-20", "2026-10-20"), "2026-11-15", "after the one-off: the first of the repeats");
  const t = addManualTodo({ ticket: "KB-2", text: "300 € Rate (Az. DR II 1121/26) überweisen" });
  setTodoDue(t.id, "2026-10-20");
  setRecurrence(t.id, { ...monthly15, start: "2026-11-15", until: "2027-01-31" });
  assert.equal(getTodo(t.id)!.recurrence!.start, "2026-11-15");
  const mine = () => eventsBetween("2026-10-01", "2027-03-01").filter((e) => e.todoId === t.id).map((e) => e.start.slice(0, 10)).sort();
  assert.deepEqual(mine(), ["2026-10-20", "2026-11-15", "2026-12-15", "2027-01-15"]);
  // Regenerated: the same, not twice.
  regenerateSeries(t.id);
  assert.deepEqual(mine(), ["2026-10-20", "2026-11-15", "2026-12-15", "2027-01-15"]);
  setTodoStatus(t.id, "done");
  const next = listTodos({ status: "open" }).find((x) => x.text === t.text)!;
  assert.equal(next.due, "2026-11-15", "the first of the repeats");
  assert.equal(next.recurrence!.start, "2026-11-15");
});

test("the appointments are the todo's context: its sources list the series and the one-off — the series follows the next todo", async () => {
  const { addManualTodo, setTodoDue, getTodo, setTodoStatus, listTodos } = await import("@/lib/boards/store");
  const { setRecurrence } = await import("@/lib/boards/recurring");
  const { todoSources } = await import("@/lib/boards/sources");
  const t = addManualTodo({ ticket: "KB-2", text: "Eine Rate (Az. DR II 77/26) überweisen" });
  setTodoDue(t.id, "2026-10-20");
  setRecurrence(t.id, { ...monthly15, start: "2026-11-15" });
  const calRefs = (id: number) => getTodo(id)!.refs.filter((r: string) => r.startsWith("cal:"));
  assert.equal(calRefs(t.id).length, 2, "the series and the one-off");
  const found = Object.values(todoSources([getTodo(t.id)!], []));
  const cal = found.flatMap((x) => (x.source === "calendar" ? [x.event] : []));
  assert.equal(cal.length, 2);
  assert.ok(cal.some((e) => e.rule && /month/i.test(e.rule)), "the series says its rule");
  setTodoStatus(t.id, "done");
  const next = listTodos({ status: "open" }).find((x) => x.text === t.text)!;
  assert.equal(calRefs(next.id).length, 1, "the next todo has the series");
});

test("a todo with its series in the calendar needs no appointment actions — they go, and the auto-actions don't propose them", async () => {
  const { addManualTodo, getTodo, setTodoDue, setTodoOps } = await import("@/lib/boards/store");
  const { setRecurrence, withoutAppointments } = await import("@/lib/boards/recurring");
  const t = addManualTodo({ ticket: "KB-2", text: "Rate 300 € überweisen (Az. DR II 9/26)" });
  setTodoDue(t.id, "2026-11-15");
  const entry = { type: "calendar-entry", calendar: "", title: "Rate", start: "2026-11-15T11:00", minutes: 15, body: "" } as const;
  const transfer = { type: "bank-transfer", name: "Dienstkonto", iban: "DE22 6609 0800 0007 7773 02", bic: "", amount: "300.00", purpose: "DR II 9/26" } as const;
  setTodoOps(t.id, [entry, transfer] as never, undefined, true);
  setRecurrence(t.id, monthly15);
  assert.deepEqual(getTodo(t.id)!.ops.map((o) => o.type), ["bank-transfer"], "the series is the appointment");
  assert.deepEqual(withoutAppointments([entry, transfer] as never, true).map((o) => o.type), ["bank-transfer"]);
  assert.equal(withoutAppointments([entry] as never, false).length, 1, "a todo without a rule keeps its appointment");
});
