import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A stopped sync ends what it started: a driver process (runStdioSession) at once, not at its timeout. */
test("stopping a sync ends its driver at once", async () => {
  const { withAbort } = await import("@/lib/abort");
  const { runStdioSession } = await import("@/lib/jira/mcp-client");
  const c = new AbortController();
  const t0 = Date.now();
  setTimeout(() => c.abort(), 300);
  await assert.rejects(
    withAbort(c, () => runStdioSession({ command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], label: "Test" }, () => new Promise(() => {}), 60000)),
    /Abgebrochen/,
  );
  assert.ok(Date.now() - t0 < 5000);
});

test("a step already stopped doesn't start", async () => {
  const { withAbort, throwIfAborted } = await import("@/lib/abort");
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    withAbort(c, async () => throwIfAborted()),
    /Abgebrochen/,
  );
});
