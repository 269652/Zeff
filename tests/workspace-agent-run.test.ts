import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// An agent routine through the real worker path (a fake CLI): it becomes a run on a todo of its own — in the Code tab — and its
// routine run follows it to the end.
setupTempData();
process.env.CODEX_CLI = path.join(ROOT, "tests", "fake-codex-app-server.mjs");
delete process.env.ZEFF_WORK_HOST;

const until = async (what: string, ok: () => boolean, ms = 20000) => {
  for (const end = Date.now() + ms; !ok(); ) {
    if (Date.now() > end) throw new Error(`Timed out waiting: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

test("an agent run is a worker run: on its own todo, with its instructions, and the routine's run ends with it", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos", "llm", "codex-cli"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const { runRoutine } = await import("@/plugins/workspace/routine-run");
  const { syncAgentRuns } = await import("@/plugins/workspace/routine-agent");
  const { getRun } = await import("@/lib/work/store");
  const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const project = w.createPage({ title: "Projekt" });
  const agent = w.createPage({ parentId: project, title: "Beobachter", content: { type: "doc", content: [{ type: "zeffRoutine" }, para("Beobachte das Projekt und melde, was dir auffällt.")] } });
  r.createRoutine(agent, "agent", { enabled: true, provider: "codex" });
  const out = await runRoutine(agent, { kind: "manual" });
  assert.equal(out.status, "started", out.error);
  const run = r.routineRuns(agent)[0];
  assert.ok(run.workRunId, "its worker run");
  const work = getRun(run.workRunId!)!;
  assert.equal(work.provider, "codex", "the worker the agent is set to use");
  assert.match(work.prompt, /Beobachte das Projekt/, "its instructions");
  assert.match(work.prompt, /Projekt/, "where it is");
  // …and the routine's run ends when the worker's does: the worker is ended here, as the Code tab's stop would
  await until("the worker run to start", () => getRun(run.workRunId!)?.status === "running");
  assert.equal(r.routineRuns(agent)[0].status, "running", "still going while its worker is");
  const { cancelRun } = await import("@/lib/work/runner");
  cancelRun(run.workRunId!);
  await until("the worker run to end", () => !["queued", "running"].includes(getRun(run.workRunId!)?.status ?? ""));
  syncAgentRuns();
  assert.equal(r.routineRuns(agent)[0].status, "failed", "a stopped worker run is no success");
  const { liveDriverFor } = await import("@/lib/work/live-driver");
  await liveDriverFor("codex")?.finish(run.workRunId!).catch(() => undefined);
});
