import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Why a value is there: every change in a row's history says what made it — you, a routine, a rule, a field filled by itself — and
 * what that was started by ("Routine „Morgens“ › Auto: Erledigt am"). And a routine tried without changing anything: what it would do.
 */
async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const tasks = w.createPage({ kind: "database", title: "Aufgaben" });
  w.updateSchema(tasks, {
    ...w.getDatabase(tasks)!.schema,
    properties: [
      { id: "done", name: "Erledigt", type: "checkbox" },
      { id: "at", name: "Erledigt am", type: "date", auto: { on: ["done"], formula: 'if(prop("Erledigt"), "2026-10-25", "")' } },
      { id: "note", name: "Notiz", type: "text" },
    ],
  });
  const automation = (title: string, steps: unknown[]) => {
    const page = w.createPage({ title });
    r.createRoutine(page, "automation", { steps: steps as never });
    return page;
  };
  return { w, r, tasks, automation };
}

test("a change by hand has no cause; one inside an action names it, and what follows from it names both", async () => {
  const { w, tasks } = await world();
  const { activityOf } = await import("@/plugins/workspace/activity");
  const { journaled } = await import("@/plugins/workspace/undo");
  const row = w.addRow(tasks, { title: "Steuer" });
  w.setCell(row, "note", "selbst");
  assert.equal(activityOf(row).find((l) => l.field === "Notiz")!.cause, null, "you: no cause");
  journaled("Routine „Morgens“", () => w.setCell(row, "done", true), "source");
  const lines = activityOf(row);
  assert.equal(lines.find((l) => l.field === "Erledigt")!.cause, "Routine „Morgens“");
  assert.equal(lines.find((l) => l.field === "Erledigt am")!.cause, "Routine „Morgens“ › Auto: Erledigt am", "the field filled by itself, and what set it off");
});

test("a routine tried: what it would change, make and do — and nothing changed, no run, no undo entry", async () => {
  const { w, r, tasks, automation } = await world();
  const { dryRunRoutine } = await import("@/plugins/workspace/automation");
  const { undoEntries } = await import("@/plugins/workspace/undo");
  const row = w.addRow(tasks, { title: "Steuer" });
  const page = automation("Abschluss", [
    { id: "s1", kind: "set", field: "Notiz", value: "fertig: {{row.title}}" },
    { id: "s2", kind: "create", db: tasks, title: "Nachfassen {{row.title}}" },
    { id: "s3", kind: "notify", text: "Erledigt" },
  ]);
  const before = { rows: w.rawRows(tasks).length, runs: r.routineRuns(page).length, undo: undoEntries().length };
  const plan = await dryRunRoutine(page, { row });
  assert.equal(plan.status, "done");
  assert.deepEqual(
    plan.changes.map((c) => [c.title, c.field, c.to]),
    [["Steuer", "Notiz", "fertig: Steuer"]],
  );
  assert.deepEqual(plan.made.map((m) => m.title), ["Nachfassen Steuer"]);
  assert.ok(plan.log.some((l) => l.kind === "notify" && /would/i.test(l.note)), "a note it would send, not sent");
  assert.equal(w.rawRows(tasks).find((x) => x.id === row)!.cells.note, undefined, "the row as it was");
  assert.deepEqual({ rows: w.rawRows(tasks).length, runs: r.routineRuns(page).length, undo: undoEntries().length }, before, "nothing kept");
});
