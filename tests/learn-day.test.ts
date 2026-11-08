import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

import { studyEvents, cleanSlots } from "@/plugins/learn/schedule-shared";

setupTempData();

test("study slots: checked (a weekday 1–7, HH:MM, 10–240 minutes)", () => {
  assert.deepEqual(cleanSlots([{ day: 1, time: "19:00", minutes: 45 }, { day: 8, time: "19:00", minutes: 45 }, { day: 3, time: "25:00", minutes: 45 }, { day: 5, time: "7:30", minutes: 500 }]), [
    { day: 1, time: "19:00", minutes: 45 },
    { day: 5, time: "07:30", minutes: 240 },
  ]);
});

test("study events: each slot on its weekday for the next weeks, the course's name, local times", () => {
  // 2026-11-09 is a Monday.
  const events = studyEvents([{ id: 3, title: "Französisch", slots: [{ day: 1, time: "19:00", minutes: 45 }, { day: 3, time: "07:30", minutes: 30 }] }], new Date(2026, 10, 9, 8, 0), 14);
  assert.equal(events.length, 4, "two Mondays, two Wednesdays");
  assert.deepEqual(events[0], { key: "learn:3:2026-11-09T19:00", title: "Lernen: Französisch", start: "2026-11-09T19:00", end: "2026-11-09T19:45", description: "/learn/3" });
  assert.equal(events[1].start, "2026-11-11T07:30");
  assert.equal(events[1].end, "2026-11-11T08:00");
});

test("the learning calendar: the study events of all courses; changed slots replace them", async () => {
  const store = await import("@/plugins/learn/store");
  const { setStudySlots } = await import("@/plugins/learn/schedule");
  const ir = await import("@/lib/calendar/ir");
  const id = store.createCourse({ topic: "Französisch", goal: "B2", level: "A2" });
  store.savePlan(id, { title: "Französisch", summary: "", years: 1, sources: [], nodes: [{ key: "s", kind: "step", parent: null, title: "Begrüßung" }] });
  const now = new Date(2026, 10, 9, 8, 0);
  await setStudySlots(id, [{ day: 1, time: "19:00", minutes: 45 }], now);
  let evs = ir.eventsBetween("2026-11-09", "2026-11-16").filter((e) => e.title.startsWith("Lernen"));
  assert.equal(evs.length, 1);
  await setStudySlots(id, [{ day: 2, time: "18:00", minutes: 30 }, { day: 4, time: "18:00", minutes: 30 }], now);
  evs = ir.eventsBetween("2026-11-09", "2026-11-16").filter((e) => e.title.startsWith("Lernen"));
  assert.deepEqual(evs.map((e) => e.start).sort(), ["2026-11-10T18:00", "2026-11-12T18:00"]);
  assert.deepEqual(store.getCourse(id)?.slots, [{ day: 2, time: "18:00", minutes: 30 }, { day: 4, time: "18:00", minutes: 30 }]);
});

test("reviews due become one todo per course, kept up to date, done when all are reviewed", async () => {
  const store = await import("@/plugins/learn/store");
  const { syncReviewTodos } = await import("@/plugins/learn/schedule");
  const { getTodo } = await import("@/lib/todos/store");
  const id = store.createCourse({ topic: "Differentialgeometrie", goal: "", level: "" });
  store.savePlan(id, { title: "Differentialgeometrie", summary: "", years: 1, sources: [], nodes: [{ key: "s", kind: "step", parent: null, title: "Bogenlänge" }] });
  const now = new Date("2026-11-08T10:00:00Z");
  syncReviewTodos(now);
  assert.equal(store.getCourse(id)?.reviewTodoId, null, "nothing due: no todo");
  store.addCards(id, "s", [{ front: "a", back: "b" }, { front: "c", back: "d" }], now);
  syncReviewTodos(now);
  const todoId = store.getCourse(id)!.reviewTodoId!;
  let todo = getTodo(todoId)!;
  assert.equal(todo.status, "open");
  assert.match(todo.text, /2/);
  assert.match(todo.text, /Differentialgeometrie/);
  assert.equal(todo.byWorker, false, "yours: in your list");
  store.addCards(id, "s", [{ front: "e", back: "f" }], now);
  syncReviewTodos(now);
  assert.equal(store.getCourse(id)!.reviewTodoId, todoId, "the same todo");
  assert.match(getTodo(todoId)!.text, /3/);
  for (const c of store.dueCards(id, now)) store.reviewCard(c.id, "good", now);
  syncReviewTodos(now);
  todo = getTodo(todoId)!;
  assert.equal(todo.status, "done");
});
