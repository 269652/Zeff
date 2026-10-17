import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Apps talking to each other: an automation's step can call what a plugin offers (a Workspace row made, a todo added …) — only the
 * methods that are marked safe for automations — and send a named signal that other routines listen to, without knowing each other.
 */
async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const inbox = w.createPage({ kind: "database", title: "Eingang" });
  const archive = w.createPage({ kind: "database", title: "Archiv" });
  const routine = (steps: unknown[], triggers: unknown[] = [{ kind: "manual" }]) => {
    const page = w.createPage({ title: `Routine ${Math.random()}` });
    r.createRoutine(page, "automation", { enabled: true, steps: steps as never, triggers: triggers as never });
    return page;
  };
  return { w, r, inbox, archive, routine };
}
const until = async (fn: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!fn() && Date.now() - t0 < ms) await new Promise((res) => setTimeout(res, 20));
  return fn();
};

test("the configuration: a call needs its method, a signal its name; a signal is an event a routine can listen to", async () => {
  const { normalizeSteps, normalizeRoutine } = await import("@/plugins/workspace/routines");
  const steps = normalizeSteps([
    { kind: "call", method: " workspace.rows.add ", params: { database: "Archiv", title: "{{row.title}}", n: 3, bad: { x: 1 } } },
    { kind: "call" },
    { kind: "signal", name: " invoice.paid ", payload: { who: "{{row.title}}", n: 2 } },
    { kind: "signal", name: "" },
  ]) as { kind: string; method?: string; params?: Record<string, string>; name?: string; payload?: Record<string, string> }[];
  assert.deepEqual(steps.map((s) => s.kind), ["call", "signal"]);
  assert.equal(steps[0].method, "workspace.rows.add");
  assert.deepEqual(steps[0].params, { database: "Archiv", title: "{{row.title}}" }, "text values only");
  assert.equal(steps[1].name, "invoice.paid");
  assert.deepEqual(steps[1].payload, { who: "{{row.title}}" });
  const c = normalizeRoutine({ triggers: [{ kind: "event", event: "signal", name: "invoice.paid" }, { kind: "event", event: "signal" }] });
  assert.deepEqual(c.triggers, [{ kind: "event", event: "signal", name: "invoice.paid" }], "a signal trigger needs its name");
});

test("a call step runs a method marked safe for automations — with the row in hand in its texts", async () => {
  const { w, archive, inbox, routine } = await world();
  const { runAutomation } = await import("@/plugins/workspace/automation");
  const row = w.addRow(inbox, { title: "Rechnung 42" });
  const page = routine([{ kind: "call", method: "workspace.rows.add", params: { database: "Archiv", title: "Kopie: {{row.title}}", fields: "{}" } }]);
  const res = await runAutomation(page, { kind: "manual" }, { row });
  assert.equal(res.status, "done", res.error);
  assert.deepEqual(w.rawRows(archive).map((x) => x.title), ["Kopie: Rechnung 42"]);
  assert.match(res.log[0].note, /workspace\.rows\.add/);
});

test("what is not marked safe is refused — a worker started, a run cancelled — and an unknown method says so", async () => {
  const { routine } = await world();
  const { runAutomation } = await import("@/plugins/workspace/automation");
  const unsafe = await runAutomation(routine([{ kind: "call", method: "work.sessions.start", params: {} }]), { kind: "manual" });
  assert.equal(unsafe.status, "failed");
  assert.match(unsafe.error ?? "", /not allowed|automation/i);
  const unknown = await runAutomation(routine([{ kind: "call", method: "gibt.es.nicht", params: {} }]), { kind: "manual" });
  assert.equal(unknown.status, "failed");
  assert.match(unknown.error ?? "", /no method|not allowed|unknown/i);
  const { automaticMethods } = await import("@/plugins/workspace/routine-methods");
  const names = automaticMethods().map((m) => m.name);
  for (const n of ["workspace.rows.add", "workspace.rows.update", "workspace.pages.create", "workspace.pages.append", "workspace.signals.send", "todos.add"]) assert.ok(names.includes(n), `${n} is offered to automations`);
  for (const n of ["work.sessions.start", "work.runs.cancel", "storage.set"]) assert.ok(!names.includes(n), `${n} is not`);
});

test("signals: one routine sends, the others that listen run — with what was sent; and signals do not go round for ever", async () => {
  const { w, r, archive, routine } = await world();
  const { runAutomation } = await import("@/plugins/workspace/automation");
  const heard = routine([{ kind: "create", db: archive, title: "gehört: {{payload.who}} ({{trigger.kind}})" }], [{ kind: "event", event: "signal", name: "invoice.paid" }]);
  const other = routine([{ kind: "create", db: archive, title: "falsches Signal" }], [{ kind: "event", event: "signal", name: "etwas.anderes" }]);
  const sender = routine([{ kind: "signal", name: "invoice.paid", payload: { who: "Anna" } }]);
  const res = await runAutomation(sender, { kind: "manual" });
  assert.equal(res.status, "done", res.error);
  assert.deepEqual(w.rawRows(archive).map((x) => x.title), ["gehört: Anna (event)"]);
  assert.equal(r.routineRuns(other).length, 0);
  assert.equal(r.routineRuns(heard).length, 1);
  // a loop: A listens to "ping" and sends "ping"
  const loop = routine([{ kind: "signal", name: "ping" }], [{ kind: "event", event: "signal", name: "ping" }]);
  const out = await runAutomation(loop, { kind: "manual" }, { deps: {} });
  assert.ok(["done", "failed"].includes(out.status));
  assert.ok(r.routineRuns(loop).length <= 8, "the loop ends");
  assert.ok(await until(() => r.routineRuns(loop).every((x) => x.status !== "running")));
});

test("workspace.signals.send: the API sends a signal — for an auto action, a plugin or a worker", async () => {
  const { w, archive, routine } = await world();
  const { callBuiltin } = await import("@/lib/plugins/api");
  routine([{ kind: "create", db: archive, title: "von außen: {{payload.what}}" }], [{ kind: "event", event: "signal", name: "extern" }]);
  await callBuiltin("test", "workspace.signals.send", { name: "extern", payload: JSON.stringify({ what: "Hallo" }) });
  assert.ok(await until(() => w.rawRows(archive).some((x) => x.title === "von außen: Hallo")));
});
