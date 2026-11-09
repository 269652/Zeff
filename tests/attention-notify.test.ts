import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("a source not well pings the desktop only once it has lasted a while — not on its first failure", async () => {
  const { sourceNotifies, SOURCE_NOTIFY_HOURS } = await import("@/lib/attention");
  const now = Date.parse("2026-11-09T12:00:00Z");
  assert.equal(sourceNotifies(new Date(now - 10 * 60e3).toISOString(), now), false, "10 minutes: not yet");
  assert.equal(sourceNotifies(new Date(now - (SOURCE_NOTIFY_HOURS * 3600e3 - 1)).toISOString(), now), false);
  assert.equal(sourceNotifies(new Date(now - SOURCE_NOTIFY_HOURS * 3600e3).toISOString(), now), true, "lasted: told");
});
