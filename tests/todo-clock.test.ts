import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// A todo's time measured, not guessed: the clock started before the work, stopped after — the difference is the record;
// waiting for the user left out; a lap records the time so far; starting on another todo stops the running one; a clock
// that hears nothing for 10 minutes pauses as of the last sign of life.
setupTempData();

const T0 = Date.parse("2026-10-27T09:00:00Z");
const min = (n: number) => T0 + n * 60000;

test("start, pings, lap, pause while asking, stop: the measured minutes as records — the wait left out", async () => {
  const { addManualTodo } = await import("@/lib/boards/store");
  const { clockIn, clockPing, clockLap, clockPause, clockResume, clockOut, openClock } = await import("@/lib/work/todo-clock");
  const { listTodoTimes } = await import("@/lib/work/todo-time");
  const t = addManualTodo({ ticket: "PROJ-371", text: "Teaser quer umsetzen" });

  assert.equal(clockIn(t.id, "Claude Code", min(0)).resumed, false);
  assert.equal(clockIn(t.id, "Claude Code", min(5)).resumed, true, "running already: goes on (a sign of life)");
  assert.equal(clockPing(t.id, "Claude Code", min(14))?.resumedAfter, null);
  const lap = clockLap(t.id, "Claude Code", "Recherche", min(20))!;
  assert.equal(lap.minutes, 20);
  clockPause(t.id, min(30)); // asking the user
  assert.equal(openClock(t.id, "Claude Code", min(60))?.state, "waiting", "a question to the user isn't silence");
  clockResume(t.id, min(75)); // the answer, 45 minutes later
  clockPing(t.id, "Claude Code", min(84));
  const out = clockOut(t.id, "Claude Code", { note: "Umsetzung", now: min(90) })!;
  assert.equal(out.minutes, 25, "20→30 and 75→90: the wait doesn't count");
  assert.equal(openClock(t.id, "Claude Code"), null);
  assert.deepEqual(listTodoTimes([t.id]).map((r) => [r.minutes, r.note, r.by]).sort(), [[20, "Recherche", "Claude Code"], [25, "Umsetzung", "Claude Code"]].sort());
  assert.equal(clockOut(t.id, "Claude Code"), null, "no clock: nothing");
});

test("silent for more than 10 minutes: paused as of the last ping — the silence lost; the next ping goes on from then", async () => {
  const { addManualTodo } = await import("@/lib/boards/store");
  const { clockIn, clockPing, clockOut, openClock } = await import("@/lib/work/todo-clock");
  const t = addManualTodo({ ticket: "PROJ-372", text: "Silent" });
  clockIn(t.id, "Copilot", min(0));
  clockPing(t.id, "Copilot", min(8));
  // Nothing for 30 minutes: paused at 8.
  const seen = openClock(t.id, "Copilot", min(38))!;
  assert.equal(seen.state, "silent");
  assert.equal(Math.round(seen.minutes), 8);
  const back = clockPing(t.id, "Copilot", min(38))!;
  assert.equal(back.resumedAfter, 30, "30 minutes not counted, said so");
  assert.equal(openClock(t.id, "Copilot", min(40))?.state, "running");
  // Stopped later, silent again since 45: counted to 45.
  clockPing(t.id, "Copilot", min(45));
  assert.equal(clockOut(t.id, "Copilot", { now: min(70) })!.minutes, 8 + 7, "0→8 and 38→45");
});

test("starting on another todo stops the running one (its time recorded); stop without a name finds the todo's only clock; record:false only measures", async () => {
  const { addManualTodo } = await import("@/lib/boards/store");
  const { clockIn, clockPing, clockOut } = await import("@/lib/work/todo-clock");
  const { listTodoTimes } = await import("@/lib/work/todo-time");
  const a = addManualTodo({ ticket: "PROJ-373", text: "A" });
  const b = addManualTodo({ ticket: "PROJ-374", text: "B" });
  clockIn(a.id, "W-45", min(0));
  for (const m of [9, 18, 27, 36]) clockPing(a.id, "W-45", min(m));
  const sw = clockIn(b.id, "W-45", min(40));
  assert.equal(sw.switched?.todoId, a.id);
  assert.equal(sw.switched?.minutes, 40);
  assert.match(sw.switched?.note ?? "", /switched to T-/);
  // Another agent's clock is its own.
  clockIn(a.id, "Copilot", min(40));
  for (const m of [49, 58, 67]) clockPing(b.id, "W-45", min(m));
  const measured = clockOut(b.id, undefined, { record: false, now: min(70) })!;
  assert.equal(measured.minutes, 30);
  assert.equal(measured.record, null);
  assert.equal(listTodoTimes([b.id]).length, 0, "finish_todo records it itself");
  clockPing(a.id, "Copilot", min(49));
  assert.equal(clockOut(a.id, "Copilot", { now: min(55) })!.minutes, 15);
});
