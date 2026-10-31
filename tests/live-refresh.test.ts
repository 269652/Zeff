import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** What a sync brought reaches the open pages: one topic "sync" for any step, and the sync host's topics (workspace, sync) are passed on to the web server. */
test("a change of the topic sync is told to the pages that follow", async () => {
  const { emitChange, onChange } = await import("@/lib/events");
  const seen: string[] = [];
  const off = onChange((t) => seen.push(t));
  emitChange("sync");
  emitChange("workspace");
  off();
  assert.deepEqual(seen, ["sync", "workspace"]);
});

test("the sync host tells the web server: workspace and sync get through, what is unknown does not, no token no entry", async () => {
  process.env.ZEFF_SYNC_TOKEN = "t0ken";
  const { onChange } = await import("@/lib/events");
  const { POST } = await import("@/app/api/host-event/route");
  const seen: string[] = [];
  const off = onChange((t) => seen.push(t));
  const call = (topic: string, token = "t0ken") => POST(new Request("http://x/api/host-event", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ topic }) }));
  assert.equal((await call("workspace")).status, 200);
  assert.equal((await call("sync")).status, 200);
  await call("nonsense");
  assert.equal((await call("sync", "wrong")).status, 401);
  off();
  assert.deepEqual(seen, ["workspace", "sync"]);
});

test("the pages follow: every page refreshes on a sync, the live ones on their own topics too", async () => {
  const { topicsFor } = await import("@/components/live-topics");
  assert.ok(topicsFor("/workspace/1317").includes("sync"));
  assert.deepEqual(topicsFor("/settings/mail"), ["sync"]);
  assert.deepEqual(topicsFor("/mail"), ["sync"]);
  assert.deepEqual(topicsFor("/todos"), ["work", "todos", "attention", "sync"]);
  assert.deepEqual(topicsFor("/kanban"), ["sync"], "(Kanban went: its old links lead to the Workspace)");
});
