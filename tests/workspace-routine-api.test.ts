import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Routines called from outside: the Workspace API method (an auto action, a plugin, a worker through the MCP) runs one by its name. */
test("workspace.routines.run: offered as an auto action, runs an automation by its title — as the AI (system pages stay closed)", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos", "work"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const { offeredMethods } = await import("@/plugins/actions/server");
  const db = w.createPage({ kind: "database", title: "Berichte" });
  const page = w.createPage({ title: "Berichte vorbereiten" });
  r.createRoutine(page, "automation", { steps: [{ id: "c", kind: "create", db, title: "Bericht von {{trigger.kind}}" }] });
  const method = offeredMethods()["workspace.routines.run"];
  assert.ok(method, "offered");
  const ctx = await method.offer.context!({ ticket: "", text: "Berichte" });
  assert.ok(ctx.some((l) => l.includes("Berichte vorbereiten")), "the routines as context");
  const p = method.offer.check({ routine: "berichte vorbereiten" });
  assert.ok(p, "a routine by its title");
  assert.equal(method.offer.check({ routine: "Gibt es nicht" }), null);
  assert.equal(method.offer.check({ routine: String(db) }), null, "a database is no routine");
  const res = (await method.run(p!, { plugin: "test", has: () => true } as never)) as { status: string };
  assert.equal(res.status, "done");
  assert.ok(w.rawRows(db).some((x) => x.title === "Bericht von called"), "it ran, called");
  assert.equal(r.routineRuns(page)[0].trigger.kind, "called");
});

type Tool = (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

test("MCP tools for routines: a worker lists them and runs one by its name — an agent routine starts a worker of its own", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos", "work"]) setInstalled(id, true);
  const { registerZeffTools } = await import("@/mcp/server");
  const t: Record<string, Tool> = {};
  registerZeffTools({ registerTool: (name: string, _c: unknown, fn: never) => void (t[name] = fn) } as never);
  const text = async (name: string, args: Record<string, unknown>) => {
    const r = await t[name](args);
    return { text: r.content.map((c) => c.text).join("\n"), error: !!r.isError };
  };
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const db = w.createPage({ kind: "database", title: "Ablage" });
  const auto = w.createPage({ title: "Ablage füllen" });
  r.createRoutine(auto, "automation", { steps: [{ id: "c", kind: "create", db, title: "Eintrag {{trigger.kind}}" }] });
  const listed = await text("workspace_routines", {});
  assert.match(listed.text, new RegExp(`\[${auto}\].*Ablage füllen.*automation`, "i"));
  const ran = await text("workspace_run_routine", { routine: "Ablage füllen" });
  assert.equal(ran.error, false);
  assert.match(ran.text, /done/);
  assert.ok(w.rawRows(db).some((x) => x.title === "Eintrag called"));
  assert.equal((await text("workspace_run_routine", { routine: "gibt es nicht" })).error, true);
  const log = await text("workspace_routine_runs", { routine: auto });
  assert.match(log.text, /done/);
});
