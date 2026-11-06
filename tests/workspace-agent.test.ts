import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Agents: a page whose blocks are the instructions of an LLM run. It runs as a worker (it shows in the Code tab), knows where it is
 * placed — its parent and sibling pages — and reaches the Workspace through the same MCP tools as any agent, within what its
 * permissions allow. Here the worker is a stand-in: what is asked of it is what is checked.
 */
async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const project = w.createPage({ title: "Projekt Relaunch", content: { type: "doc", content: [para("Ziel: Launch im November.")] } });
  const notes = w.createPage({ parentId: project, title: "Notizen", content: { type: "doc", content: [para("Kunde will mehr Tempo.")] } });
  const agent = w.createPage({ parentId: project, title: "Wochenbericht", content: { type: "doc", content: [para("Fasse die Notizen der Woche zusammen."), { type: "bulletList", content: [{ type: "listItem", content: [para("Schreibe das Ergebnis unter Notizen.")] }] }] } });
  const child = w.createPage({ parentId: agent, title: "Entwurf" });
  r.createRoutine(agent, "agent", { enabled: true });
  return { w, r, project, notes, agent, child, para };
}

test("the prompt: the instructions of the page, where it is placed (parent, siblings, children), what started it, what it may do", async () => {
  const { project, notes, agent, child } = await world();
  const { buildAgentPrompt } = await import("@/plugins/workspace/routine-agent");
  const p = buildAgentPrompt(agent, { kind: "manual" });
  assert.match(p, /Wochenbericht/, "its name");
  assert.match(p, /Fasse die Notizen der Woche zusammen/, "its instructions, as written");
  assert.match(p, /Schreibe das Ergebnis unter Notizen/, "a list's items too");
  assert.match(p, new RegExp(`Projekt Relaunch[^\\n]*${project}`), "the parent, with its id");
  assert.match(p, /Ziel: Launch im November/, "what the parent says");
  assert.match(p, new RegExp(`Notizen[^\\n]*${notes}`), "a sibling, with its id");
  assert.match(p, /Kunde will mehr Tempo/, "what the sibling says");
  assert.match(p, new RegExp(`Entwurf[^\\n]*${child}`), "a child");
  assert.match(p, /workspace_/, "the tools it has");
  assert.match(p, /von Hand|manual/i, "what started it");
  assert.ok(!p.includes("zeffRoutine"), "the routine's own controls are no instruction");
});

test("the prompt names the trigger and the row in hand; the permissions say what may be changed", async () => {
  const { w, r, agent } = await world();
  const { buildAgentPrompt } = await import("@/plugins/workspace/routine-agent");
  const db = w.createPage({ kind: "database", title: "Eingang" });
  const row = w.addRow(db, { title: "Neue Anfrage" });
  const withRow = buildAgentPrompt(agent, { kind: "event", event: "row.added", db }, { row, payload: { title: "Neue Anfrage" } });
  assert.match(withRow, /row\.added|Zeile hinzugefügt|row added/i);
  assert.match(withRow, /Neue Anfrage/);
  const self = buildAgentPrompt(agent, { kind: "manual" });
  assert.match(self, /nur .*eigene|only .*own/i, "self: its own page and what is below");
  r.updateRoutine(agent, { permissions: { scope: "none" } });
  assert.match(buildAgentPrompt(agent, { kind: "manual" }), /nichts ändern|read-only|only read/i);
  r.updateRoutine(agent, { permissions: { scope: "workspace" } });
  assert.match(buildAgentPrompt(agent, { kind: "manual" }), /ganzen Workspace|whole workspace/i);
});

test("starting an agent: a todo for it, handed to a worker with the prompt — the run is logged with its worker run", async () => {
  const { r, agent } = await world();
  const a = await import("@/plugins/workspace/routine-agent");
  const calls: { todoId: number; instruction: string }[] = [];
  const out = await a.startAgent(agent, { kind: "manual" }, {}, { dispatch: (todoId, o) => (calls.push({ todoId, instruction: o.instruction }), { id: 4711 }) });
  assert.equal(out.status, "started");
  assert.equal(calls.length, 1);
  assert.match(calls[0].instruction, /Fasse die Notizen/);
  const run = r.routineRuns(agent)[0];
  assert.equal(run.status, "running");
  assert.equal(run.workRunId, 4711, "its worker run (the Code tab shows it)");
  const { getTodo } = await import("@/lib/todos/store");
  assert.match(getTodo(calls[0].todoId)!.text, /Wochenbericht/, "a todo named for the agent");
  // a second run reuses the agent's todo
  await a.startAgent(agent, { kind: "manual" }, {}, { dispatch: (todoId) => (calls.push({ todoId, instruction: "" }), { id: 4712 }) });
  assert.equal(calls[1].todoId, calls[0].todoId);
});

test("a worker that cannot start is the run's failure — said in words", async () => {
  const { r, agent } = await world();
  const a = await import("@/plugins/workspace/routine-agent");
  const out = await a.startAgent(agent, { kind: "manual" }, {}, { dispatch: () => { throw new Error("Claude CLI: not installed"); } });
  assert.equal(out.status, "failed");
  assert.match(out.error ?? "", /not installed/);
  assert.equal(r.routineRuns(agent)[0].status, "failed");
});

test("runs follow their worker: when the worker run ends, the routine's run ends — done or failed, with the summary", async () => {
  const { r, agent } = await world();
  const a = await import("@/plugins/workspace/routine-agent");
  await a.startAgent(agent, { kind: "manual" }, {}, { dispatch: () => ({ id: 91 }) });
  await a.startAgent(agent, { kind: "manual" }, {}, { dispatch: () => ({ id: 92 }) });
  const state: Record<number, { status: string; summary?: string | null; error?: string | null }> = { 91: { status: "running" }, 92: { status: "running" } };
  assert.equal(a.syncAgentRuns((id) => state[id]), 0, "still running: nothing ends");
  state[91] = { status: "done", summary: "Bericht geschrieben." };
  state[92] = { status: "failed", error: "Out of budget" };
  assert.equal(a.syncAgentRuns((id) => state[id]), 2);
  const [second, first] = r.routineRuns(agent);
  assert.equal(first.status, "done");
  assert.deepEqual(first.log.map((l) => l.note), ["Bericht geschrieben."]);
  assert.equal(second.status, "failed");
  assert.match(second.error ?? "", /budget/);
});

test("permissions: what an agent's MCP tools may change — its own page and below, its parent's, everything, nothing", async () => {
  const { w, r, project, notes, agent, child } = await world();
  const a = await import("@/plugins/workspace/routine-agent");
  const { asAgent } = await import("@/plugins/workspace/agent-scope");
  const { withCallerRun } = await import("@/mcp/caller");
  await a.startAgent(agent, { kind: "manual" }, {}, { dispatch: () => ({ id: 555 }) });
  const other = w.createPage({ title: "Ganz woanders" });
  // as the MCP tool would: a caller's run header, in the agent scope
  const edit = (page: number) => withCallerRun("555", () => asAgent(() => w.updatePage(page, { title: "geändert" }))());
  const create = (parent: number | null) => withCallerRun("555", () => asAgent(() => w.createPage({ parentId: parent, title: "neu" }))());
  r.updateRoutine(agent, { permissions: { scope: "self" } });
  assert.doesNotThrow(() => edit(agent));
  assert.doesNotThrow(() => edit(child), "what is below it");
  assert.doesNotThrow(() => create(agent));
  assert.throws(() => edit(notes), /may not|nicht/i, "a sibling: no");
  assert.throws(() => edit(other), /may not|nicht/i);
  assert.throws(() => create(null), /may not|nicht/i, "nothing at the top");
  r.updateRoutine(agent, { permissions: { scope: "parent" } });
  assert.doesNotThrow(() => edit(notes), "the parent's subtree: siblings too");
  assert.doesNotThrow(() => edit(project));
  assert.throws(() => edit(other), /may not|nicht/i);
  r.updateRoutine(agent, { permissions: { scope: "workspace" } });
  assert.doesNotThrow(() => edit(other));
  r.updateRoutine(agent, { permissions: { scope: "none" } });
  assert.throws(() => edit(agent), /may not|nicht/i);
  // a request that is no agent run of a routine: untouched
  assert.doesNotThrow(() => asAgent(() => w.updatePage(other, { title: "von einem fremden Agenten" }))());
  // a row's cell: by its database
  r.updateRoutine(agent, { permissions: { scope: "self" } });
  const db = w.createPage({ kind: "database", title: "Fremde Datenbank" });
  const row = w.addRow(db, { title: "x" });
  assert.throws(() => withCallerRun("555", () => asAgent(() => w.setCell(row, "title", "y"))()), /may not|nicht/i);
});

test("runRoutine: an automation runs through; an agent starts and goes on — one entry point for triggers, calls and the API", async () => {
  const { w, r, agent } = await world();
  const { runRoutine } = await import("@/plugins/workspace/routine-run");
  const a = await runRoutine(agent, { kind: "manual" }, {}, { dispatch: () => ({ id: 31 }) });
  assert.equal(a.status, "started");
  const auto = w.createPage({ title: "Auto" });
  r.createRoutine(auto, "automation", { steps: [{ id: "n", kind: "notify", text: "hi" }] });
  const b = await runRoutine(auto, { kind: "called" });
  assert.equal(b.status, "done");
  await assert.rejects(() => runRoutine(w.createPage({ title: "Keine Routine" }), { kind: "manual" }), /no routine/i);
});

test("a view of its own: the assistant adds it from a template (a bad one is refused with its line), it joins the others and goes again; out of rounds it says so", async () => {
  const { createPage } = await import("@/plugins/workspace/store");
  const { getDatabase } = await import("@/plugins/workspace/store");
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const { workspaceChat } = await import("@/plugins/workspace/agent");
  const id = createPage({ parentId: null, title: "Filme", kind: "database", schema: { titleName: "Name", properties: [], views: [{ id: "v1", name: "Liste", type: "table", filter: { op: "and", rules: [] }, sorts: [], hidden: [] }] } });
  const schema = getDatabase(id)!.schema;

  const good = '<cards source="rows" cols=3><b>{{ title }}</b></cards>';
  const made = applyOps(schema, [{ op: "add_view", name: "Karten", template: good }], { related: () => null });
  const view = made.schema.views.find((v) => v.name === "Karten")!;
  assert.equal(view.type, "app");
  assert.equal(view.app, "template");
  assert.equal(view.template, good);
  assert.equal(made.schema.views.length, 2, "the others stay");

  assert.throws(() => applyOps(schema, [{ op: "add_view", name: "Kaputt", template: "<nosuchtag/>" }], { related: () => null }), /view template has errors/);
  assert.equal(applyOps(made.schema, [{ op: "remove_view", view: "Karten" }], { related: () => null }).schema.views.length, 1, "and it can go again");

  let asked = 0;
  const steps: number[] = [];
  const r = await workspaceChat([{ role: "user", text: "mach" }], undefined, async () => (asked++, { calls: [{ tool: "workspace_view_template_docs", args: {} }], reply: "" }), (s) => steps.push(s.length));
  assert.equal(asked, 12);
  assert.match(r.reply, /nicht fertig/);
  assert.deepEqual(steps.slice(0, 2), [1, 2], "each step is reported");
});

