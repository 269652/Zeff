import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** The reports of an agent: one per session (its todo), drafted by the agent, final when you tick the todo off. */
let n = 0;
async function world() {
  const title = ["Posteingang sortieren", "Rechnungen ablegen und prüfen", "Kalenderwoche vorbereiten", "Newsletter zusammenfassen"][n++ % 4];
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  await import("@/plugins/workspace/server");
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const { addManualTodo } = await import("@/lib/boards/store");
  const { createRun } = await import("@/lib/work/store");
  const page = w.createPage({ title });
  r.createRoutine(page, "agent");
  const todo = addManualTodo({ ticket: "", text: `Agent: ${title}` });
  const run = createRun({ ticket: "", todoId: todo.id, mode: "code", provider: "claude", model: null, permissionMode: null, repo: null, prompt: "x" });
  r.setWorkRun(r.startRun(page, { kind: "manual" }), run.id);
  return { page, todo, run, r };
}

const call = async (server: { handlers: Map<string, (...a: unknown[]) => unknown> }, name: string, args: unknown, runId?: number) => {
  const { withCallerRun } = await import("@/mcp/caller");
  return withCallerRun(runId ? String(runId) : null, () => server.handlers.get(name)!(args, {})) as Promise<{ isError?: boolean; content: { text: string }[] }>;
};
const fakeServer = async () => {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const server = { handlers, registerTool: (name: string, _d: unknown, h: (...a: unknown[]) => unknown) => void handlers.set(name, h) };
  const { registerReportTool } = await import("@/plugins/workspace/mcp-report");
  registerReportTool(server as never, { run: (fn: () => unknown) => Promise.resolve(fn()), ok: (text: string) => ({ content: [{ type: "text", text }] }), fail: (text: string) => ({ content: [{ type: "text", text }], isError: true }) } as never);
  return server;
};

test("the agent reports: a draft per session — a follow-up changes it, it does not make another", async () => {
  const { page, todo, run } = await world();
  const reports = await import("@/plugins/workspace/routine-reports");
  const s = await fakeServer();
  const first = await call(s, "agent_report", { title: "Posteingang aufgeräumt", body: "## Erledigt\n- 120 Mails einsortiert" }, run.id);
  assert.equal(first.isError, undefined);
  let list = reports.listReports(page);
  assert.equal(list.length, 1);
  assert.equal(list[0].status, "draft");
  assert.equal(list[0].todoId, todo.id);
  assert.match(list[0].body, /120 Mails/);
  // A follow-up: a new worker run on the same todo.
  const { createRun } = await import("@/lib/work/store");
  const follow = createRun({ ticket: "", todoId: todo.id, mode: "code", provider: "claude", model: null, permissionMode: null, repo: null, prompt: "y", afterRun: run.id });
  await call(s, "agent_report", { title: "Posteingang aufgeräumt", body: "## Erledigt\n- 120 Mails einsortiert\n- Filter für Flink" }, follow.id);
  list = reports.listReports(page);
  assert.equal(list.length, 1, "one report per session");
  assert.match(list[0].body, /Filter für Flink/);
});

test("only an agent routine's worker reports — others are told so", async () => {
  const { run } = await world();
  const s = await fakeServer();
  const none = await call(s, "agent_report", { title: "x", body: "y" });
  assert.equal(none.isError, true);
  assert.match(none.content[0].text, /agent routine/i);
  const stranger = await call(s, "agent_report", { title: "x", body: "y" }, run.id + 999);
  assert.equal(stranger.isError, true);
});

test("your OK — ticking the todo off — makes the report final; the button does the same", async () => {
  const { page, todo, run } = await world();
  const reports = await import("@/plugins/workspace/routine-reports");
  const { setTodoStatus } = await import("@/lib/boards/store");
  const s = await fakeServer();
  await call(s, "agent_report", { title: "Bericht", body: "Text" }, run.id);
  assert.equal(reports.listReports(page)[0].finalAt, null);
  setTodoStatus(todo.id, "done");
  const [rep] = reports.listReports(page);
  assert.equal(rep.status, "final");
  assert.ok(rep.finalAt);
  // The button: approving a draft closes its todo (and so makes it final).
  const b = await world();
  await call(s, "agent_report", { title: "Zweiter", body: "Text 2" }, b.run.id);
  const id = reports.listReports(b.page)[0].id;
  reports.approveReport(id);
  assert.equal(reports.listReports(b.page)[0].status, "final");
  const { getTodo } = await import("@/lib/boards/store");
  assert.equal(getTodo(b.todo.id)!.status, "done");
});
