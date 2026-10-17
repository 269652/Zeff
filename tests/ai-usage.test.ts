import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("AI usage: tokens are written down, the cost is the reported one or worked out from your prices (marked), else unknown", async () => {
  const { costOf, parsePrices, recordUsage, setPricesText, usageSummary } = await import("@/lib/ai/usage");
  const u = { input: 2_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0 };
  assert.deepEqual(costOf("claude-x", u, 0.5, []), { cost: 0.5, estimated: false }, "the reported cost wins");
  assert.deepEqual(costOf("gpt-5.5", u, null, []), { cost: null, estimated: false }, "no price, no cost");
  const prices = parsePrices("gpt-5 1,25 10\nnonsense\nclaude 3 15");
  assert.equal(prices.length, 2);
  assert.deepEqual(costOf("gpt-5.5", u, null, prices), { cost: 2 * 1.25 + 0.5 * 10, estimated: true }, "a price for the start of the name");
  recordUsage("mail", "claude", "claude-x", { output: {}, model: "claude-x", costUsd: 0.25, durationMs: 10, usage: u });
  setPricesText("gpt-5 1 2");
  recordUsage("briefing", "codex", "gpt-5.5", { output: {}, model: "gpt-5.5", costUsd: null, durationMs: 10, usage: u });
  recordUsage("briefing", "copilot", "x", { output: {}, model: null, costUsd: null, durationMs: 10 });
  const s = usageSummary(7);
  assert.equal(s.total.calls, 3);
  assert.equal(s.total.input, 4_000_000);
  assert.equal(s.estimated, true);
  assert.equal(s.total.unknownCost, 1, "the answer with no tokens and no price");
  assert.equal(Math.round(s.total.cost * 100) / 100, 0.25 + (2 * 1 + 0.5 * 2));
  assert.equal(s.byTask.find((g) => g.key === "briefing")!.calls, 2);
});
