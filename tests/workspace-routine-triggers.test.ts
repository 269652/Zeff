import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** When routines run by themselves: on a schedule (every N minutes, or at a time on some days) and when something happens in a database. */
async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const tasks = w.createPage({ kind: "database", title: "Aufgaben" });
  w.updateSchema(tasks, { ...w.getDatabase(tasks)!.schema, properties: [{ id: "status", name: "Status", type: "select", options: [{ id: "o1", name: "Offen", color: "gray" }, { id: "o2", name: "Fertig", color: "green" }] }, { id: "prio", name: "Priorität", type: "number" }] });
  const automation = (triggers: unknown[], steps: unknown[] = [], enabled = true) => {
    const page = w.createPage({ title: `Routine ${Math.random()}` });
    r.createRoutine(page, "automation", { enabled, triggers: triggers as never, steps: steps as never });
    return page;
  };
  return { w, r, tasks, automation };
}
const until = async (fn: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!fn() && Date.now() - t0 < ms) await new Promise((res) => setTimeout(res, 20));
  return fn();
};

test("nextRunAfter: every N minutes from a moment; at a time of day (local) on the chosen weekdays", async () => {
  const { nextRunAfter } = await import("@/plugins/workspace/routine-triggers");
  const from = new Date(2026, 9, 17, 10, 30); // Saturday 17 Oct 2026, 10:30 local
  assert.deepEqual(nextRunAfter({ kind: "schedule", everyMinutes: 45 }, from), new Date(2026, 9, 17, 11, 15));
  assert.deepEqual(nextRunAfter({ kind: "schedule", at: "12:00" }, from), new Date(2026, 9, 17, 12, 0), "later today");
  assert.deepEqual(nextRunAfter({ kind: "schedule", at: "09:00" }, from), new Date(2026, 9, 18, 9, 0), "tomorrow when today's time has passed");
  assert.deepEqual(nextRunAfter({ kind: "schedule", at: "09:00", days: [1, 3] }, from), new Date(2026, 9, 19, 9, 0), "Monday (1) after the Saturday (6)");
  assert.deepEqual(nextRunAfter({ kind: "schedule", at: "10:30", days: [6] }, from), new Date(2026, 9, 24, 10, 30), "not the same minute again: next week");
  assert.equal(nextRunAfter({ kind: "manual" }, from), null);
});

test("scheduled routines: due when their time has come — run once, then planned again; disabled ones and others never", async () => {
  const { r, tasks, automation, w } = await world();
  const { runDueRoutines } = await import("@/plugins/workspace/routine-triggers");
  const rows = (n: string) => w.rawRows(tasks).filter((x) => x.title === n).length;
  const step = (title: string) => [{ kind: "create", db: tasks, title }];
  const every = automation([{ kind: "schedule", everyMinutes: 10 }], step("alle zehn"));
  const off = automation([{ kind: "schedule", everyMinutes: 10 }], step("aus"), false);
  const manual = automation([{ kind: "manual" }], step("manuell"));
  const t0 = new Date(2026, 9, 17, 10, 0);
  assert.equal(await runDueRoutines(t0), 0, "the first look only plans: it does not run at once");
  assert.ok(r.getRoutine(every)!.nextRunAt, "a next time is set");
  assert.equal(r.getRoutine(off)!.nextRunAt, null);
  assert.equal(await runDueRoutines(new Date(2026, 9, 17, 10, 5)), 0, "not yet");
  assert.equal(await runDueRoutines(new Date(2026, 9, 17, 10, 11)), 1, "its time");
  assert.equal(rows("alle zehn"), 1);
  assert.equal(rows("aus"), 0);
  assert.equal(rows("manuell"), 0);
  assert.equal(r.routineRuns(every)[0].trigger.kind, "schedule");
  assert.equal(await runDueRoutines(new Date(2026, 9, 17, 10, 12)), 0, "planned again, 10 minutes on");
  assert.equal(await runDueRoutines(new Date(2026, 9, 17, 10, 22)), 1);
  assert.equal(rows("alle zehn"), 2);
  assert.equal(r.routineRuns(manual).length, 0);
});

test("events: a row added or changed in a database runs the routines that listen — with that row in hand", async () => {
  const { w, r, tasks, automation } = await world();
  const { fireRoutineEvent } = await import("@/plugins/workspace/routine-triggers");
  const { quietly } = await import("@/plugins/workspace/events");
  const other = w.createPage({ kind: "database", title: "Andere" });
  const onAdded = automation([{ kind: "event", event: "row.added", db: tasks }], [{ kind: "set", field: "Status", value: "Offen" }, { kind: "create", db: tasks, title: "Neu: {{row.title}} ({{trigger.kind}})" }]);
  const anyDb = automation([{ kind: "event", event: "row.added" }], [{ kind: "notify", text: "{{row.title}}" }]);
  const onStatus = automation([{ kind: "event", event: "row.changed", db: tasks, field: "Status" }], [{ kind: "notify", text: "geändert" }]);
  // (the rows are made quietly: the store would tell the routines itself — here they are told by hand)
  const row = quietly(() => w.addRow(tasks, { title: "Eingang" }));
  await fireRoutineEvent("row.added", { db: tasks, row });
  assert.equal(r.routineRuns(onAdded)[0].status, "done");
  assert.equal(r.routineRuns(anyDb).length, 1, "no database named: any");
  assert.equal(r.routineRuns(onStatus).length, 0);
  assert.ok(w.rawRows(tasks).some((x) => x.title === "Neu: Eingang (event)"), "the row was in hand, and the trigger known");
  const otherRow = quietly(() => w.addRow(other, { title: "Fremd" }));
  await fireRoutineEvent("row.added", { db: other, row: otherRow });
  assert.equal(r.routineRuns(onAdded).length, 1, "another database does not trigger it");
  assert.equal(r.routineRuns(anyDb).length, 2);
  await fireRoutineEvent("row.changed", { db: tasks, row, field: "Priorität" });
  assert.equal(r.routineRuns(onStatus).length, 0, "another field");
  await fireRoutineEvent("row.changed", { db: tasks, row, field: "Status" });
  assert.equal(r.routineRuns(onStatus).length, 1);
});

test("what the store does is an event: addRow and a cell changed — and a routine's own changes do not set routines off again", async () => {
  const { w, r, tasks, automation } = await world();
  const added = automation([{ kind: "event", event: "row.added", db: tasks }], [{ kind: "notify", text: "{{row.title}}" }]);
  const changed = automation([{ kind: "event", event: "row.changed", db: tasks, field: "Priorität" }], [{ kind: "notify", text: "p" }]);
  const row = w.addRow(tasks, { title: "Von Hand" });
  assert.ok(await until(() => r.routineRuns(added).length === 1), "addRow ran it");
  w.setCell(row, "prio", 5);
  assert.ok(await until(() => r.routineRuns(changed).length === 1), "a changed cell ran it");
  // an automation that adds rows to the database it listens to: no loop
  const loopy = automation([{ kind: "event", event: "row.added", db: tasks }], [{ kind: "create", db: tasks, title: "Echo" }]);
  w.addRow(tasks, { title: "Auslöser" });
  assert.ok(await until(() => r.routineRuns(loopy).length >= 1));
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(w.rawRows(tasks).filter((x) => x.title === "Echo").length, 1, "its own row did not start it again");
});

test("a pipeline run is one event: its rows are written quietly, then the routines hear 'pipeline.ran' and — a few new rows — 'row.added' for each", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["outlook-mail", "mail-client"]) setInstalled(id, true);
  const { w, r, automation } = await world();
  const { saveMails } = await import("@/lib/mail/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createSourceDatabase } = await import("@/plugins/workspace/derived");
  const mails = createSourceDatabase("mail");
  const ran = automation([{ kind: "event", event: "pipeline.ran", db: mails }], [{ kind: "notify", text: "gelesen" }]);
  const added = automation([{ kind: "event", event: "row.added", db: mails }], [{ kind: "notify", text: "{{row.title}}" }]);
  const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  saveMails([
    { convId: "E1", folder: "Posteingang", from: "A", fromEmail: "a@x.example", subject: "Erste", preview: "…", receivedAt: ago(1), unread: true },
    { convId: "E2", folder: "Posteingang", from: "B", fromEmail: "b@x.example", subject: "Zweite", preview: "…", receivedAt: ago(2), unread: true },
  ]);
  await runPipeline(mails, { ai: false });
  assert.ok(await until(() => r.routineRuns(ran).length === 1), "pipeline.ran once");
  assert.ok(await until(() => r.routineRuns(added).length >= 2), "row.added for the new rows");
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(r.routineRuns(ran).length, 1);
  assert.equal(w.rawRows(mails).length >= 2, true);
  // a second run with nothing new: pipeline.ran again, no row.added
  const before = r.routineRuns(added).length;
  await runPipeline(mails, { ai: false });
  assert.ok(await until(() => r.routineRuns(ran).length === 2));
  assert.equal(r.routineRuns(added).length, before);
});
