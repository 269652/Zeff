import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The data boundaries at the MCP server: what an agent routine's worker (and any other caller) may read of what is
 * labelled personal or secret. Secret: nobody over the MCP. Personal: you (a caller with no Zeff run) and agents whose
 * permissions allow personal data; not other workers.
 */

type Res = { isError?: boolean; content: { text: string }[] };

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos", "gmail"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const r = await import("@/plugins/workspace/routines");
  const { guardTools } = await import("@/mcp/tool-guard");
  const { registerWorkspaceTools } = await import("@/plugins/workspace/mcp");
  const { withCallerRun } = await import("@/mcp/caller");
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const server = { registerTool: (name: string, _def: unknown, h: (...a: unknown[]) => unknown) => void handlers.set(name, h) };
  guardTools(server as never);
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
  const run = async (fn: () => unknown) => {
    try {
      return await fn();
    } catch (e) {
      return fail(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  registerWorkspaceTools(server as never, { run, ok, fail } as never);
  server.registerTool("gmail_find", {}, async () => ok("mails"));
  const call = (name: string, args: unknown, run?: number) => withCallerRun(run ? String(run) : null, () => handlers.get(name)!(args, {})) as Promise<Res>;
  const journal = w.createPage({ kind: "database", title: "Journal", schema: { titleName: "Name", properties: [], views: [m.newView("Table")] } });
  const entry = w.addRow(journal, { title: "Heute war schön" });
  const plain = w.createPage({ title: "Einkaufsliste Baumarkt" });
  const agent = (personal: boolean, workRun: number) => {
    const page = w.createPage({ title: `Agent ${workRun}` });
    r.createRoutine(page, "agent", { permissions: { scope: "self", ...(personal ? { personal: true } : {}) } });
    r.setWorkRun(r.startRun(page, { kind: "manual" }), workRun);
    return page;
  };
  return { call, journal, entry, plain, agent, r };
}

let ctx: Awaited<ReturnType<typeof setup>> | null = null;
const get = async () => (ctx ??= await setup());

test("a routine's permission for personal data: off unless set, kept as true only", async () => {
  const { r, agent } = await get();
  const off = agent(false, 7001);
  const on = agent(true, 7002);
  assert.equal(r.getRoutine(off)!.permissions.personal, undefined);
  assert.equal(r.getRoutine(on)!.permissions.personal, true);
  assert.equal(r.normalizeRoutine({ permissions: { scope: "self", personal: "yes" } }).permissions.personal, undefined);
});

test("workspace reads: a personal database is closed to an agent without the permission, open with it and to you", async () => {
  const { call, journal, entry, plain, agent } = await get();
  agent(false, 7101);
  agent(true, 7102);
  const refused = await call("workspace_read_page", { page: entry }, 7101);
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /personal/i);
  assert.equal((await call("workspace_query_database", { database: journal }, 7101)).isError, true);
  assert.equal((await call("workspace_read_page", { page: plain }, 7101)).isError, undefined, "an open page: read");
  assert.match((await call("workspace_read_page", { page: entry }, 7102)).content[0].text, /Heute war schön/, "the agent allowed personal data");
  assert.match((await call("workspace_read_page", { page: entry })).content[0].text, /Heute war schön/, "you (no Zeff run)");
  assert.equal((await call("workspace_read_page", { page: entry }, 7999)).isError, true, "another worker (a run of no routine): open data only");
  const search = await call("workspace_search", { query: "Heute schön" }, 7101);
  assert.ok(!search.content[0].text.includes("Heute war schön"), "not found by search either");
  const tree = await call("workspace_tree", {}, 7101);
  assert.ok(!tree.content[0].text.includes("Journal"), "nor listed");
  assert.match((await call("workspace_tree", {}, 7102)).content[0].text, /Journal/);
});

test("secret: closed to every caller of the MCP, you too", async () => {
  const { call, journal, entry, agent } = await get();
  const s = await import("@/plugins/workspace/sensitivity");
  agent(true, 7201);
  s.setDatabaseLabel(journal, "secret");
  assert.equal((await call("workspace_read_page", { page: entry }, 7201)).isError, true);
  const mine = await call("workspace_read_page", { page: entry });
  assert.equal(mine.isError, true);
  assert.match(mine.content[0].text, /secret/i);
  s.setDatabaseLabel(journal, null);
});

test("a tool that reads one source (Gmail) follows that source's label", async () => {
  const { call, agent } = await get();
  const { setSourceLabel } = await import("@/lib/boundaries");
  agent(false, 7301);
  agent(true, 7302);
  assert.equal((await call("gmail_find", {}, 7301)).content[0].text, "mails", "Gmail open by default");
  setSourceLabel("gmail", "personal");
  const r = await call("gmail_find", {}, 7301);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /personal/i);
  assert.equal((await call("gmail_find", {}, 7302)).isError, undefined);
  setSourceLabel("gmail", "secret");
  assert.equal((await call("gmail_find", {})).isError, true, "secret: you too");
  setSourceLabel("gmail", null);
});
