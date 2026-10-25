import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * A button field: a button in each row that runs a routine with that row in hand ("Close the day", "Send to Jira", "Follow up") —
 * nothing stored in the cell; what the routine does is undone as one, and the row's history names it.
 */
async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const page = w.createPage({ title: "Erledigen" });
  r.createRoutine(page, "automation", { steps: [{ id: "s1", kind: "set", field: "Erledigt", value: "yes" }] as never });
  const tasks = w.createPage({ kind: "database", title: "Aufgaben" });
  w.updateSchema(tasks, {
    ...w.getDatabase(tasks)!.schema,
    properties: [
      { id: "done", name: "Erledigt", type: "checkbox" },
      { id: "go", name: "Aktion", type: "button", button: { routine: page, label: "Erledigen" } },
    ],
  });
  return { w, tasks, page };
}

test("a button field runs its routine on the row — nothing stored in it, the routine's change named in the row's history", async () => {
  const { w, tasks } = await world();
  const { isComputed, coerceCellValue } = await import("@/plugins/workspace/model");
  const go = w.getDatabase(tasks)!.schema.properties.find((p) => p.id === "go")!;
  assert.equal(go.button?.label, "Erledigen", "its settings kept");
  assert.equal(isComputed(go), true, "never stored");
  assert.equal(coerceCellValue(go, "x"), null);
  const row = w.addRow(tasks, { title: "Steuer" });
  const { pressButton } = await import("@/plugins/workspace/row-button");
  const res = await pressButton(row, "go");
  assert.equal(res.status, "done");
  assert.equal(w.getPage(row)!.props.done, true, "the routine set it, on this row");
  assert.equal(w.getPage(row)!.props.go, undefined, "the button stores nothing");
  const { activityOf } = await import("@/plugins/workspace/activity");
  assert.equal(activityOf(row).find((l) => l.field === "Erledigt")!.cause, "Erledigen");
});

test("a button without a routine, or one pressed on another database's row: says so, runs nothing", async () => {
  const { w, tasks } = await world();
  const { pressButton } = await import("@/plugins/workspace/row-button");
  const s = w.getDatabase(tasks)!.schema;
  w.updateSchema(tasks, { ...s, properties: s.properties.map((p) => (p.id === "go" ? { ...p, button: undefined } : p)) });
  const row = w.addRow(tasks, { title: "Ohne" });
  await assert.rejects(() => pressButton(row, "go"), /routine/i);
  await assert.rejects(() => pressButton(row, "nope"), /button/i);
  assert.equal(w.getPage(row)!.props.done, undefined);
});
