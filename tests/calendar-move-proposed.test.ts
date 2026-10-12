import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

async function withOps(ops: unknown[], why = "weil der Termin sonst fehlt") {
  const { addFollowUp, setTodoOps, getDb } = await import("@/lib/boards/store").then(async (m) => ({ ...m, getDb: (await import("@/db")).getDb }));
  const t = addFollowUp({ ticket: `CM-${Math.random().toString(36).slice(2, 6)}`, text: `Termin ${Math.random().toString(36).slice(2, 10)} vereinbaren`, kind: "other", parentId: null as unknown as number, workRunId: null, source: "test", ops });
  void setTodoOps;
  const { schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  getDb().update(schema.todos).set({ autoOpsWhy: why }).where(eq(schema.todos.id, t.id)).run();
  return t;
}

test("an appointment a todo proposes can be moved: its action gets the new start and length, the rest of the todo stays as it is", async () => {
  const { moveCalendarOp, getTodo } = await import("@/lib/boards/store");
  const t = await withOps([
    { type: "jira-transition", ticket: "CM-1", to: "In Progress" },
    { type: "calendar-event", subject: "PROJ-415 gemeinsam prüfen", start: "2026-10-13T14:00", minutes: 30, attendees: "", body: "Prüfen" },
  ]);
  assert.equal(getTodo(t.id)!.ops.length, 2);
  const moved = moveCalendarOp(t.id, 1, "2026-10-14T09:15", 45);
  const op = moved.ops[1] as { start: string; minutes: number; subject: string; body: string };
  assert.deepEqual([op.start, op.minutes, op.subject, op.body], ["2026-10-14T09:15", 45, "PROJ-415 gemeinsam prüfen", "Prüfen"]);
  assert.equal(moved.ops[0].type, "jira-transition");
  assert.equal(moved.autoOpsWhy, "weil der Termin sonst fehlt", "still the AI's suggestion, only moved");
  // Google's and Zeff's own calendar entries move the same way.
  const g = await withOps([{ type: "gcal-event", title: "Review", start: "2026-10-13T10:00", minutes: 60 }]);
  assert.equal((moveCalendarOp(g.id, 0, "2026-10-13T11:00", 60).ops[0] as { start: string }).start, "2026-10-13T11:00");
});

test("only appointments move, to a real time, on an open todo", async () => {
  const { moveCalendarOp, setTodoStatus } = await import("@/lib/boards/store");
  const t = await withOps([{ type: "jira-transition", ticket: "CM-1", to: "Done" }, { type: "calendar-event", subject: "Termin", start: "2026-10-13T14:00", minutes: 30, attendees: "", body: "" }]);
  assert.throws(() => moveCalendarOp(t.id, 0, "2026-10-14T09:00", 30), /isn't an appointment/i);
  assert.throws(() => moveCalendarOp(t.id, 5, "2026-10-14T09:00", 30), /isn't an appointment|no such/i);
  assert.throws(() => moveCalendarOp(t.id, 1, "morgen früh", 30), /time/i);
  assert.throws(() => moveCalendarOp(t.id, 1, "2026-10-14T09:00", 0), /length|minutes/i);
  assert.throws(() => moveCalendarOp(t.id, 1, "2026-10-14T09:00", 3000), /length|minutes/i);
  setTodoStatus(t.id, "done");
  assert.throws(() => moveCalendarOp(t.id, 1, "2026-10-14T09:00", 30), /open/i);
});

test("the drag's end becomes the action's length: start and end → start and minutes", async () => {
  const { moveProposedEventAction } = await import("@/plugins/calendar/server-actions");
  const { getTodo } = await import("@/lib/boards/store");
  const t = await withOps([{ type: "calendar-event", subject: "Termin", start: "2026-10-13T14:00", minutes: 30, attendees: "", body: "" }]);
  const r = await moveProposedEventAction(t.id, 0, "2026-10-15T10:30", "2026-10-15T11:45");
  // (Outside a request Next's revalidation can't run — the move itself is done before it.)
  assert.ok(r?.ok || /static generation store/.test(r?.error ?? ""), JSON.stringify(r));
  const op = getTodo(t.id)!.ops[0] as { start: string; minutes: number };
  assert.deepEqual([op.start, op.minutes], ["2026-10-15T10:30", 75]);
  const bad = await moveProposedEventAction(t.id, 0, "2026-10-15T12:00", "2026-10-15T11:00");
  assert.equal(bad?.ok, false);
  assert.match(bad?.error ?? "", /after the start/);
  assert.equal((getTodo(t.id)!.ops[0] as { minutes: number }).minutes, 75, "a bad drag changes nothing");
});
