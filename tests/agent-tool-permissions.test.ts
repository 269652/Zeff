import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** What an agent routine's worker may use beyond pages: groups of Zeff's tools, each on or off in the routine's permissions. */
test("the groups: every tool in one group at most, defaults as they were (merge-request writes are new: off)", async () => {
  const { AGENT_TOOL_GROUPS, toolGroupOf, toolsAllowed } = await import("@/plugins/workspace/agent-tools");
  const names = AGENT_TOOL_GROUPS.flatMap((g) => g.tools);
  assert.equal(new Set(names).size, names.length, "a tool belongs to one group");
  assert.equal(new Set(AGENT_TOOL_GROUPS.map((g) => g.id)).size, AGENT_TOOL_GROUPS.length);
  assert.equal(toolGroupOf("mr_comment")?.id, "merge.write");
  assert.equal(toolGroupOf("workspace_read_page"), undefined, "pages are the scope's business");
  assert.equal(toolsAllowed({}, "list_todos"), true);
  assert.equal(toolsAllowed({}, "mr_comment"), false, "writes to GitLab: off until you switch them on");
  assert.equal(toolsAllowed({ tools: { "merge.write": true } }, "mr_comment"), true);
  assert.equal(toolsAllowed({ tools: { "todos.work": false } }, "start_todo"), false);
  assert.equal(toolsAllowed({}, "some_future_tool"), true, "what no group names is left alone");
});

test("saved with the routine: only known groups, only true/false", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const id = w.createPage({ title: "A" });
  r.createRoutine(id, "agent", { permissions: { scope: "self", tools: { "merge.write": true, "todos.work": false, nonsense: true, web: "yes" } as never } });
  assert.deepEqual(r.getRoutine(id)!.permissions.tools, { "merge.write": true, "todos.work": false });
  r.updateRoutine(id, { permissions: { scope: "self", tools: {} } });
  assert.equal(r.getRoutine(id)!.permissions.tools, undefined);
});

test("the MCP server refuses a tool of a group that is off for the worker of an agent routine — and only for that worker", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const { guardTools } = await import("@/mcp/tool-guard");
  const { withCallerRun } = await import("@/mcp/caller");
  const page = w.createPage({ title: "Agent" });
  r.createRoutine(page, "agent", { permissions: { scope: "self", tools: { "todos.work": false } } });
  r.setWorkRun(r.startRun(page, { kind: "manual" }), 4242);
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const server = { registerTool: (name: string, _def: unknown, h: (...a: unknown[]) => unknown) => void handlers.set(name, h) };
  guardTools(server as never);
  server.registerTool("start_todo", {}, async () => ({ content: [{ type: "text", text: "started" }] }));
  server.registerTool("list_todos", {}, async () => ({ content: [{ type: "text", text: "listed" }] }));
  const call = (name: string, run?: number) => withCallerRun(run ? String(run) : null, () => handlers.get(name)!({}, {})) as Promise<{ isError?: boolean; content: { text: string }[] }>;
  const refused = await call("start_todo", 4242);
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /may not use/i);
  assert.equal((await call("list_todos", 4242)).isError, undefined, "another group, on");
  assert.equal((await call("start_todo")).content[0].text, "started", "a caller that is no routine's worker");
  assert.equal((await call("start_todo", 9999)).content[0].text, "started", "a run of no routine");
});
