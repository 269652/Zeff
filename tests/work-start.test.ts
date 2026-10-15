import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { setupTempData } from "./helpers";

setupTempData();

const at = (y: number, mo: number, d: number, h: number, m = 0) => new Date(y, mo - 1, d, h, m).toISOString();
async function todoOn(ticket: string) {
  const { addFollowUp } = await import("@/lib/boards/store");
  return addFollowUp({ ticket, text: `Aufgabe ${Math.random().toString(36).slice(2, 10)} ${Math.random().toString(36).slice(2, 10)}`, kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
}

/** When the work began is what was recorded — never when it is booked. */
test("the start of the work comes from the runs (start_todo) and the records' ends minus their minutes", async () => {
  const { workStart } = await import("@/lib/work/start");
  const { addTodoTime } = await import("@/lib/work/todo-time");
  const { getDb, schema } = await import("@/db");
  const todo = await todoOn("ST-1");
  const day = "2026-12-14";
  // Records made at 11:00 (60 min: the stretch began 10:00) and 12:30 (30 min).
  const a = addTodoTime({ todoId: todo.id, minutes: 60, note: "Phase 1", by: "Claude Code" });
  const b = addTodoTime({ todoId: todo.id, minutes: 30, note: "Phase 2", by: "Claude Code" });
  getDb().update(schema.todoTime).set({ at: at(2026, 12, 14, 11) }).where(eq(schema.todoTime.id, a.id)).run();
  getDb().update(schema.todoTime).set({ at: at(2026, 12, 14, 12, 30) }).where(eq(schema.todoTime.id, b.id)).run();
  assert.equal(workStart(day, { todoIds: [todo.id] }), "10:00", "not 11:00, when the first record was made");
  // The agent's start_todo made a run: its start is the start.
  getDb().insert(schema.workRuns).values({ todoId: todo.id, ticket: "ST-1", mode: "agent", provider: "claude", prompt: "x", status: "done", queuedAt: at(2026, 12, 14, 9, 40), startedAt: at(2026, 12, 14, 9, 40) } as never).run();
  assert.equal(workStart(day, { todoIds: [todo.id] }), "09:40");
  assert.equal(workStart("2026-12-15", { todoIds: [todo.id] }), null, "only what is on record that day");
  assert.equal(workStart(day, {}), null);
});

/** A suggestion taken over carries that start into its entry; so does a todo done today. */
test("suggested entries and done-today entries start when the work began", async () => {
  const { addTodoTime } = await import("@/lib/work/todo-time");
  const { suggestEntry, acceptSuggestion } = await import("@/lib/work/suggestions");
  const { getEntry } = await import("@/lib/entries");
  const { createJob } = await import("@/lib/jobs");
  const { getDb, schema } = await import("@/db");
  createJob({ number: "300001", name: "Relaunch" });
  const todo = await todoOn("ST-2");
  const day = "2026-12-16";
  const rec = addTodoTime({ todoId: todo.id, minutes: 90, note: "Umsetzung", by: "Claude Code" });
  getDb().update(schema.todoTime).set({ at: at(2026, 12, 16, 15, 30) }).where(eq(schema.todoTime.id, rec.id)).run();
  const s = suggestEntry({ date: day, hours: 1.5, description: "Umsetzung", jobNumber: "300001", reportedBy: "Claude", todoIds: [todo.id], timeIds: [rec.id] });
  const r = acceptSuggestion(s.id);
  assert.equal(getEntry(r.entryId)!.start, "14:00", "15:30 minus 90 minutes — not the time it was taken over");
});
