import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("a database's agents are the scheduled ones under it; their catch-up order reaches the prompt; a worker waits long enough for a slow Zeff", async () => {
  const { createPage } = await import("@/plugins/workspace/store");
  const { agentsOfDatabase, createRoutine } = await import("@/plugins/workspace/routines");
  const { buildAgentPrompt } = await import("@/plugins/workspace/routine-agent");
  const { CATCH_UP } = await import("@/plugins/workspace/routines");
  const { workerEnv } = await import("@/lib/work/runner");

  const reviews = createPage({ parentId: null, title: "Rückblicke", kind: "database", schema: { titleName: "Name", properties: [], views: [] } });
  const other = createPage({ parentId: null, title: "Andere", kind: "database", schema: { titleName: "Name", properties: [], views: [] } });
  const weekly = createPage({ parentId: reviews, title: "Wochenrückblick" });
  createRoutine(weekly, "agent", { triggers: [{ kind: "schedule", at: "11:00", days: [0] }] });
  const byHand = createPage({ parentId: reviews, title: "Nur von Hand" });
  createRoutine(byHand, "agent", { triggers: [] });
  const automation = createPage({ parentId: reviews, title: "Ablauf" });
  createRoutine(automation, "automation", { triggers: [{ kind: "schedule", at: "11:00", days: [0] }] });

  assert.deepEqual(agentsOfDatabase(reviews), [{ pageId: weekly, title: "Wochenrückblick" }]);
  assert.deepEqual(agentsOfDatabase(other), []);

  const prompt = buildAgentPrompt(weekly, { kind: "manual" }, { payload: { Auftrag: CATCH_UP } });
  assert.ok(prompt.includes(CATCH_UP));
  assert.ok(!buildAgentPrompt(weekly, { kind: "manual" }).includes(CATCH_UP), "only when asked");

  assert.equal(workerEnv(1).MCP_TIMEOUT, "120000");
});
