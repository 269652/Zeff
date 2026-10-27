import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// A todo's time measured, not guessed: the clock started before the work, stopped after — the difference is the record;
// waiting for the user left out; a lap records the time so far; starting on another todo stops the running one.
setupTempData();

const T0 = Date.parse("2026-10-27T09:00:00Z");
const min = (n: number) => T0 + n * 60000;

test("start, lap, pause while asking, stop: the measured minutes as records — the wait left out", async () => {
  const { addManualTodo } = await import("@/lib/boards/store");
  const { clockIn, clockLap, clockPause, clockResume, clockOut, openClock } = await import("@/lib/work/todo-clock");
  const { listTodoTimes } = await import("@/lib/work/todo-time");
  const t = addManualTodo({ ticket: "PROJ-371", text: "Teaser quer umsetzen" });

  assert.equal(clockIn(t.id, "Claude Code", min(0)).resumed, false);
  assert.equal(clockIn(t.id, "Claude Code", min(5)).resumed, true, "running already: goes on");
  const lap = clockLap(t.id, "Claude Code", "Recherche", min(20))!;
  assert.equal(lap.minutes, 20);
  clockPause(t.id, min(30)); // asking the user
  clockResume(t.id, min(75)); // the answer, 45 minutes later
  const out = clockOut(t.id, "Claude Code", { note: "Umsetzung", now: min(90) })!;
  assert.equal(out.minutes, 25, "20→30 and 75→90: the wait doesn't count");
  assert.equal(openClock(t.id, "Claude Code"), null);
  assert.deepEqual(listTodoTimes([t.id]).map((r) => [r.minutes, r.note, r.by]).sort(), [[20, "Recherche", "Claude Code"], [25, "Umsetzung", "Claude Code"]].sort());
  assert.equal(clockOut(t.id, "Claude Code"), null, "no clock: nothing");
});

test("starting on another todo stops the running one (its time recorded); stop without a name finds the todo's only clock; record:false only measures", async () => {
  const { addManualTodo } = await import("@/lib/boards/store");
  const { clockIn, clockOut } = await import("@/lib/work/todo-clock");
  const { listTodoTimes } = await import("@/lib/work/todo-time");
  const a = addManualTodo({ ticket: "PROJ-372", text: "A" });
  const b = addManualTodo({ ticket: "PROJ-373", text: "B" });
  clockIn(a.id, "W-45", min(0));
  const sw = clockIn(b.id, "W-45", min(40));
  assert.equal(sw.switched?.todoId, a.id);
  assert.equal(sw.switched?.minutes, 40);
  assert.match(sw.switched?.note ?? "", /switched to T-/);
  // Another agent's clock is its own.
  clockIn(a.id, "Copilot", min(40));
  const measured = clockOut(b.id, undefined, { record: false, now: min(70) })!;
  assert.equal(measured.minutes, 30);
  assert.equal(measured.record, null);
  assert.equal(listTodoTimes([b.id]).length, 0, "finish_todo records it itself");
  assert.equal(clockOut(a.id, "Copilot", { now: min(55) })!.minutes, 15);
});
