import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

type Tool = (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** Agents ask which sources are stale before they rely on their data: source_health, read-only. */
test("source_health tells agents which sources aren't well, and why", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("jira", true);
  const { noteSyncResult } = await import("@/lib/sync/health");
  const { getDb, schema } = await import("@/db");
  const failed = new Date(Date.now() - 3 * 3600e3).toISOString();
  getDb().insert(schema.syncState).values({ key: "jira", lastAt: failed, lastOk: false, lastMessage: "Jira: 401 unauthorized" }).run();
  noteSyncResult("jira", false, "Jira: 401 unauthorized", failed);
  noteSyncResult("jira", false, "Jira: 401 unauthorized", failed);

  const { registerZeffTools } = await import("@/mcp/server");
  const tools: Record<string, Tool> = {};
  const configs: Record<string, { annotations?: { readOnlyHint?: boolean } }> = {};
  registerZeffTools({ registerTool: (name: string, c: never, fn: never) => void ((tools[name] = fn), (configs[name] = c)) } as never);
  assert.ok(tools.source_health, "registered");
  assert.equal(configs.source_health.annotations?.readOnlyHint, true);

  const all = (await tools.source_health({})).content[0].text;
  assert.match(all, /Jira: failing/);
  assert.match(all, /401 unauthorized/);

  const one = (await tools.source_health({ source: "jira" })).content[0].text;
  assert.match(one, /Jira: failing/);
  assert.equal((await tools.source_health({ source: "nosuch" })).isError, true);
});
