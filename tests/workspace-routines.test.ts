import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Routines: Automations (deterministic steps, one after another — with gates, branches and conditions) and Agents (an LLM run on
 * the instructions of a page). Each is a page of the Workspace with a configuration: when it runs (manually, on a schedule, on an
 * event, called by another routine, an auto action or a worker), what it may touch (permissions) and, for an automation, its steps.
 */
async function pageWorkspace() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  return await import("@/plugins/workspace/store");
}

test("normalizeRoutine: a configuration kept to what it can be — unknown triggers, steps and permissions dropped, defaults filled", async () => {
  const { normalizeRoutine } = await import("@/plugins/workspace/routines");
  const c = normalizeRoutine({
    kind: "automation",
    enabled: true,
    triggers: [
      { kind: "manual" },
      { kind: "schedule", everyMinutes: 30.7 },
      { kind: "schedule", at: "7:5", days: [1, 3, 9, "x"] },
      { kind: "schedule" },
      { kind: "event", event: "row.added", db: "12" },
      { kind: "event", event: "nonsense" },
      { kind: "teleport" },
    ],
    permissions: { scope: "galaxy" },
    steps: [
      { id: "a", kind: "set", field: "Status", value: "Fertig" },
      { kind: "set" },
      { kind: "if", when: { match: "any", rules: [{ field: "Status", op: "is", value: "x" }, { field: "", op: "is" }] }, then: [{ kind: "notify", text: "ja" }], else: [{ kind: "nope" }] },
      { kind: "foreach", db: 3, steps: [{ kind: "archive" }] },
      { kind: "foreach", steps: [] },
      { kind: "stop" },
    ],
  });
  assert.equal(c.kind, "automation");
  assert.deepEqual(c.triggers.map((t) => t.kind), ["manual", "schedule", "schedule", "event"], "unknown and empty ones dropped");
  assert.deepEqual(c.triggers[1], { kind: "schedule", everyMinutes: 30 });
  assert.deepEqual(c.triggers[2], { kind: "schedule", at: "07:05", days: [1, 3] });
  assert.deepEqual(c.triggers[3], { kind: "event", event: "row.added", db: 12 });
  assert.equal(c.permissions.scope, "self", "an unknown scope is the narrowest");
  assert.deepEqual(c.steps.map((s) => s.kind), ["set", "if", "foreach", "stop"], "a set without its field, a foreach without its database dropped");
  const iff = c.steps[1] as { when: { rules: unknown[]; match: string }; then: { kind: string }[]; else: unknown[] };
  assert.equal(iff.when.rules.length, 1, "a rule needs its field");
  assert.equal(iff.when.match, "any");
  assert.deepEqual(iff.then.map((s) => s.kind), ["notify"]);
  assert.deepEqual(iff.else, [], "an unknown step inside is dropped too");
  assert.ok(c.steps.every((s) => typeof s.id === "string" && s.id), "each step has an id");
});

test("routines: made for a page, read back, changed, listed, gone with the page's routine — and a page is one routine at most", async () => {
  const w = await pageWorkspace();
  const r = await import("@/plugins/workspace/routines");
  const page = w.createPage({ title: "Tägliche Übersicht" });
  assert.equal(r.getRoutine(page), null);
  const made = r.createRoutine(page, "agent");
  assert.equal(made.kind, "agent");
  assert.equal(made.enabled, false, "a new one is off until you switch it on");
  assert.deepEqual(made.triggers, [{ kind: "manual" }]);
  assert.throws(() => r.createRoutine(page, "agent"), /already/i);
  const changed = r.updateRoutine(page, { enabled: true, triggers: [{ kind: "schedule", everyMinutes: 60 }], permissions: { scope: "workspace" } });
  assert.equal(changed.enabled, true);
  assert.equal(r.getRoutine(page)!.permissions.scope, "workspace");
  assert.deepEqual(r.listRoutines().map((x) => [x.pageId, x.kind, x.title]), [[page, "agent", "Tägliche Übersicht"]]);
  r.deleteRoutine(page);
  assert.equal(r.getRoutine(page), null);
  assert.throws(() => r.createRoutine(999999, "agent"), /page/i, "needs a page");
});

test("routine runs: a log of what ran, why, how it went and what each step did", async () => {
  const w = await pageWorkspace();
  const r = await import("@/plugins/workspace/routines");
  const page = w.createPage({ title: "Protokoll" });
  r.createRoutine(page, "automation");
  const run = r.startRun(page, { kind: "manual" });
  assert.equal(r.routineRuns(page)[0].status, "running");
  r.finishRun(run, { status: "done", log: [{ step: "a", kind: "set", status: "ok", note: "Status = Fertig" }] });
  const got = r.routineRuns(page)[0];
  assert.equal(got.status, "done");
  assert.equal(got.trigger.kind, "manual");
  assert.deepEqual(got.log, [{ step: "a", kind: "set", status: "ok", note: "Status = Fertig" }]);
  assert.ok(got.endedAt);
  assert.equal(r.getRoutine(page)!.lastRunAt, got.startedAt, "the routine knows when it last ran");
  for (let i = 0; i < 30; i++) r.finishRun(r.startRun(page, { kind: "manual" }), { status: "done", log: [] });
  assert.ok(r.routineRuns(page, 10).length === 10, "the newest ones");
});

test("routineView: what the controls block shows — the routine, its newest runs (agents' runs brought up to date), when it runs next, what is missing", async () => {
  const w = await pageWorkspace();
  const r = await import("@/plugins/workspace/routines");
  const { routineView } = await import("@/plugins/workspace/routine-view");
  const { setInstalled } = await import("@/plugins/state");
  const page = w.createPage({ title: "Ansicht" });
  assert.equal(routineView(page), null, "no routine, no view");
  r.createRoutine(page, "agent", { enabled: true, triggers: [{ kind: "manual" }, { kind: "schedule", everyMinutes: 15 }] });
  const v = routineView(page, { workRun: () => undefined })!;
  assert.equal(v.kind, "agent");
  assert.deepEqual(v.triggers.map((t) => t.kind), ["manual", "schedule"]);
  assert.ok(v.nextRunAt, "planned: the schedule is on");
  assert.deepEqual(v.runs, []);
  // an agent needs the Code plugin (workers): without it the view says so
  setInstalled("work", false);
  assert.match(routineView(page, { workRun: () => undefined })!.problem ?? "", /Code/);
  setInstalled("work", true);
  assert.equal(routineView(page, { workRun: () => undefined })!.problem, null);
  // a run of an agent that its worker ended: brought up to date when the view is made
  const run = r.startRun(page, { kind: "manual" });
  r.setWorkRun(run, 77);
  const done = routineView(page, { workRun: (id) => (id === 77 ? { status: "done", summary: "Fertig." } : undefined) })!;
  assert.equal(done.runs[0].status, "done");
  assert.equal(done.runs[0].workRunId, 77, "linked to its worker run (the Code tab)");
  // an automation: its steps
  const auto = w.createPage({ title: "Schritte" });
  r.createRoutine(auto, "automation", { steps: [{ id: "n", kind: "notify", text: "x" }] });
  const a = routineView(auto)!;
  assert.equal(a.steps.length, 1);
  assert.equal(a.problem, null, "an automation needs no worker");
});

test("routineView.live: a run going on — its worker run, how the worker stands and what it did last (the controls show it and hold Run back)", async () => {
  const w = await pageWorkspace();
  const r = await import("@/plugins/workspace/routines");
  const { routineView } = await import("@/plugins/workspace/routine-view");
  const page = w.createPage({ title: "Läuft" });
  r.createRoutine(page, "agent", { triggers: [{ kind: "manual" }] });
  const running = { status: "running" };
  assert.equal(routineView(page, { workRun: () => running })!.live, null, "nothing going on");
  // started, its worker not there yet
  const run = r.startRun(page, { kind: "manual" });
  const early = routineView(page, { workRun: () => undefined, activity: () => null })!.live!;
  assert.equal(early.runId, run);
  assert.equal(early.workRunId, null);
  assert.deepEqual(early.activity, []);
  // its worker works: its status and its last lines (tools, its words — not your prompt), the newest last
  r.setWorkRun(run, 91);
  const lines = [
    { k: "you", text: "Die Anweisungen" },
    ...Array.from({ length: 8 }, (_, i) => ({ k: "tool", tool: "Bash", text: `schritt ${i}` })),
    { k: "say", text: "Ich räume jetzt auf." },
  ];
  const v = routineView(page, { workRun: () => running, activity: (id) => (id === 91 ? { status: "running", lines: lines as never } : null) })!;
  assert.equal(v.live!.workRunId, 91);
  assert.equal(v.live!.workStatus, "running");
  assert.equal(v.live!.activity.length, 5, "the last few");
  assert.equal(v.live!.activity.at(-1), "Ich räume jetzt auf.");
  assert.equal(v.live!.activity[0], "Bash: schritt 4");
  // its worker ended: the run ends, nothing goes on
  assert.equal(routineView(page, { workRun: () => ({ status: "done", summary: "ok" }) })!.live, null);
});

test("an if step being built keeps its place: with no rule yet it is kept — and holds for every row until a rule is added", async () => {
  const { normalizeSteps } = await import("@/plugins/workspace/routines");
  const { conditionHolds } = await import("@/plugins/workspace/routine-conditions");
  const [s] = normalizeSteps([{ kind: "if", when: { rules: [{ field: "", op: "is" }] }, then: [{ kind: "notify", text: "x" }], else: [] }]) as { kind: string; when: { rules: unknown[] }; then: unknown[] }[];
  assert.equal(s.kind, "if");
  assert.deepEqual(s.when.rules, []);
  assert.equal(s.then.length, 1, "its steps stay");
  assert.equal(conditionHolds(s.when as never, { title: "x" }), true);
});

test("an agent can be set to a worker (claude, codex, copilot) — what is not one is dropped", async () => {
  const { normalizeRoutine } = await import("@/plugins/workspace/routines");
  assert.equal(normalizeRoutine({ kind: "agent", provider: "codex" }).provider, "codex");
  assert.equal(normalizeRoutine({ kind: "agent", provider: "skynet" }).provider, undefined);
  assert.equal(normalizeRoutine({ kind: "agent" }).provider, undefined, "unset: the LLM plugin's worker");
});
