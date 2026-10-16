import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The automation engine: a routine's steps run one after another on a row in hand (the one that triggered it, or each row of a
 * foreach) — set a field, create a row, archive it, refresh a database, run another routine, notify — steered by gates (stop),
 * branches (if / else) and loops (foreach), on conditions as a filter's rules. Deterministic: no AI. Every step is logged.
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
      { id: "status", name: "Status", type: "select", options: [{ id: "o1", name: "Offen", color: "gray" }, { id: "o2", name: "Fertig", color: "green" }] },
      { id: "prio", name: "Priorität", type: "number" },
      { id: "dringend", name: "Dringend", type: "checkbox" },
    ],
  });
  const cell = (rowId: number, prop: string) => w.rawRows(tasks).find((x) => x.id === rowId)!.cells[prop];
  const label = (rowId: number) => w.getDatabase(tasks)!.schema.properties.find((p) => p.id === "status")!.options!.find((o) => o.id === cell(rowId, "status"))?.name;
  const automation = (steps: unknown[]) => {
    const page = w.createPage({ title: `Automation ${Math.random()}` });
    r.createRoutine(page, "automation", { steps: steps as never });
    return page;
  };
  return { w, r, tasks, cell, label, automation };
}

test("conditions: a filter's rules on a record — all or any, case-insensitive field names, yes/no for checkboxes", async () => {
  const { conditionHolds } = await import("@/plugins/workspace/routine-conditions");
  const rec = { title: "Rechnung prüfen", status: "Offen", priorität: 3, dringend: true, notiz: "" };
  assert.equal(conditionHolds({ rules: [{ field: "Status", op: "is", value: "offen" }] }, rec), true);
  assert.equal(conditionHolds({ rules: [{ field: "Status", op: "is_not", value: "Offen" }] }, rec), false);
  assert.equal(conditionHolds({ rules: [{ field: "title", op: "contains", value: "rechn" }] }, rec), true);
  assert.equal(conditionHolds({ rules: [{ field: "Dringend", op: "is", value: "yes" }] }, rec), true);
  assert.equal(conditionHolds({ rules: [{ field: "Notiz", op: "empty" }] }, rec), true);
  assert.equal(conditionHolds({ rules: [{ field: "Status", op: "not_empty" }, { field: "Priorität", op: "is", value: "3" }] }, rec), true, "all");
  assert.equal(conditionHolds({ match: "any", rules: [{ field: "Status", op: "is", value: "Fertig" }, { field: "title", op: "contains", value: "prüfen" }] }, rec), true, "any");
  assert.equal(conditionHolds({ rules: [{ field: "Gibt es nicht", op: "is", value: "x" }] }, rec), false, "a field the record lacks is empty");
  assert.equal(conditionHolds({ rules: [{ field: "Gibt es nicht", op: "empty" }] }, rec), true);
});

test("templates: {{row.Field}}, {{trigger.kind}}, {{payload.x}}, {{today}} filled in — what is unknown stays empty", async () => {
  const { fillTemplate } = await import("@/plugins/workspace/routine-conditions");
  const ctx = { row: { title: "A", status: "Offen" }, trigger: { kind: "event" }, payload: { who: "Anna" }, now: new Date("2026-10-17T10:00:00Z") };
  assert.equal(fillTemplate("{{row.title}} ist {{row.Status}} ({{trigger.kind}}, {{payload.who}}, {{today}})", ctx), "A ist Offen (event, Anna, 2026-10-17)");
  assert.equal(fillTemplate("{{row.nope}}|{{payload.nope}}|{{what}}", ctx), "||");
  assert.equal(fillTemplate("ohne Platzhalter", ctx), "ohne Platzhalter");
});

test("steps run in order on the row in hand: set (with a template), create, archive — each logged", async () => {
  const { w, r, tasks, cell, label, automation } = await world();
  const { runAutomation } = await import("@/plugins/workspace/automation");
  const row = w.addRow(tasks, { title: "Rechnung" });
  const page = automation([
    { kind: "set", field: "Status", value: "Fertig" },
    { kind: "set", field: "Priorität", value: "2" },
    { kind: "create", db: tasks, title: "Folge: {{row.title}}", fields: { Status: "Offen" } },
  ]);
  const res = await runAutomation(page, { kind: "manual" }, { row });
  assert.equal(res.status, "done");
  assert.equal(label(row), "Fertig");
  assert.equal(cell(row, "prio"), 2);
  const followUp = w.rawRows(tasks).find((x) => x.title === "Folge: Rechnung");
  assert.ok(followUp, "a row made, its title from the template");
  assert.equal(label(followUp!.id), "Offen");
  assert.deepEqual(res.log.map((l) => [l.kind, l.status]), [["set", "ok"], ["set", "ok"], ["create", "ok"]]);
  assert.equal(r.routineRuns(page)[0].status, "done", "the run is kept in the log");
  // archive
  const p2 = automation([{ kind: "archive" }]);
  await runAutomation(p2, { kind: "manual" }, { row });
  assert.ok(w.getPage(row)!.archivedAt, "in the trash");
});

test("gates and branches: stop (when), if / else — the run says how it ended", async () => {
  const { w, tasks, label, automation } = await world();
  const { runAutomation } = await import("@/plugins/workspace/automation");
  const open = w.addRow(tasks, { title: "Offen-Aufgabe" });
  const done = w.addRow(tasks, { title: "Fertig-Aufgabe" });
  const { setFields } = await import("@/plugins/workspace/api");
  setFields(tasks, open, { Status: "Offen" });
  setFields(tasks, done, { Status: "Fertig" });
  // a gate: stops the run when the row is done already — nothing after it happens
  const gate = automation([{ kind: "stop", when: { rules: [{ field: "Status", op: "is", value: "Fertig" }] } }, { kind: "set", field: "Priorität", value: "9" }]);
  const stopped = await runAutomation(gate, { kind: "manual" }, { row: done });
  assert.equal(stopped.status, "stopped");
  assert.deepEqual(stopped.log.map((l) => [l.kind, l.status]), [["stop", "ok"]]);
  const passes = await runAutomation(gate, { kind: "manual" }, { row: open });
  assert.equal(passes.status, "done", "the condition does not hold: the gate lets it through");
  assert.deepEqual(passes.log.map((l) => [l.kind, l.status]), [["stop", "skipped"], ["set", "ok"]]);
  // a branch
  const branch = automation([{ kind: "if", when: { rules: [{ field: "Status", op: "is", value: "Offen" }] }, then: [{ kind: "set", field: "Status", value: "Fertig" }], else: [{ kind: "notify", text: "schon fertig" }] }]);
  await runAutomation(branch, { kind: "manual" }, { row: open });
  assert.equal(label(open), "Fertig", "then");
  const els = await runAutomation(branch, { kind: "manual" }, { row: done, deps: { notify: () => undefined } });
  assert.deepEqual(els.log.map((l) => [l.kind, l.depth ?? 0]), [["if", 0], ["notify", 1]], "else, one level in");
});

test("foreach: the rows of a database that match, one after another — the row in hand is each", async () => {
  const { w, tasks, label, automation } = await world();
  const { runAutomation } = await import("@/plugins/workspace/automation");
  const { setFields } = await import("@/plugins/workspace/api");
  const ids = ["a", "b", "c"].map((t) => w.addRow(tasks, { title: t }));
  setFields(tasks, ids[0], { Status: "Offen" });
  setFields(tasks, ids[1], { Status: "Fertig" });
  setFields(tasks, ids[2], { Status: "Offen" });
  const page = automation([{ kind: "foreach", db: tasks, where: { rules: [{ field: "Status", op: "is", value: "Offen" }] }, steps: [{ kind: "set", field: "Dringend", value: "yes" }, { kind: "set", field: "Status", value: "Fertig" }] }]);
  const res = await runAutomation(page, { kind: "manual" });
  assert.equal(res.status, "done");
  assert.deepEqual(ids.map(label), ["Fertig", "Fertig", "Fertig"]);
  assert.equal(w.rawRows(tasks).find((x) => x.id === ids[0])!.cells.dringend, true);
  assert.notEqual(w.rawRows(tasks).find((x) => x.id === ids[1])!.cells.dringend, true, "the done one was not matched");
  assert.equal(res.log.filter((l) => l.kind === "set").length, 4, "two rows, two steps each");
});

test("a failing step ends the run — logged, with why; a step that needs a row says so", async () => {
  const { w, tasks, automation } = await world();
  const { runAutomation } = await import("@/plugins/workspace/automation");
  const row = w.addRow(tasks, { title: "x" });
  const noRow = await runAutomation(automation([{ kind: "set", field: "Status", value: "Fertig" }, { kind: "notify", text: "nie" }]), { kind: "manual" });
  assert.equal(noRow.status, "failed");
  assert.match(noRow.error ?? "", /row/i);
  assert.deepEqual(noRow.log.map((l) => l.status), ["failed"], "nothing after it ran");
  const bad = await runAutomation(automation([{ kind: "pipeline", db: 424242 }]), { kind: "manual" }, { row, deps: { refresh: async () => { throw new Error("no such database"); } } });
  assert.equal(bad.status, "failed");
  assert.match(bad.error ?? "", /no such database/);
});

test("pipeline, run and notify go through what the engine is given — a routine can call another, but not forever", async () => {
  const { w, tasks, automation } = await world();
  const { runAutomation } = await import("@/plugins/workspace/automation");
  const row = w.addRow(tasks, { title: "x" });
  const seen: string[] = [];
  const deps = {
    refresh: async (db: number) => void seen.push(`refresh ${db}`),
    notify: (text: string) => void seen.push(`notify ${text}`),
    runRoutine: async (page: number) => (seen.push(`run ${page}`), { status: "done" as const }),
  };
  const other = automation([]);
  const page = automation([{ kind: "pipeline", db: tasks }, { kind: "run", page: other }, { kind: "notify", text: "Fertig: {{row.title}}" }]);
  const res = await runAutomation(page, { kind: "manual" }, { row, deps });
  assert.equal(res.status, "done");
  assert.deepEqual(seen, [`refresh ${tasks}`, `run ${other}`, "notify Fertig: x"]);
  // loops of calls: a depth limit
  const a = automation([]);
  const { updateRoutine } = await import("@/plugins/workspace/routines");
  updateRoutine(a, { steps: [{ id: "s", kind: "run", page: a }] });
  const loop = await runAutomation(a, { kind: "manual" });
  assert.equal(loop.status, "failed");
  assert.match(loop.error ?? "", /deep|loop|itself/i);
});

test("too many steps: a run is stopped — a foreach over a big database does not run away", async () => {
  const { w, tasks, automation } = await world();
  const { runAutomation } = await import("@/plugins/workspace/automation");
  for (let i = 0; i < 30; i++) w.addRow(tasks, { title: `r${i}` });
  const page = automation([{ kind: "foreach", db: tasks, steps: [{ kind: "set", field: "Priorität", value: "1" }] }]);
  const res = await runAutomation(page, { kind: "manual" }, { limits: { steps: 10 } });
  assert.equal(res.status, "failed");
  assert.match(res.error ?? "", /steps/i);
});
