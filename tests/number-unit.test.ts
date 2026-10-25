import assert from "node:assert/strict";
import test from "node:test";

test("a number with a unit of its own: “20 mg”; without a unit just the number", async () => {
  const { formatNumber } = await import("../src/plugins/workspace/model");
  const p = { id: "p1", name: "Dosis", type: "number" as const, format: "unit" as const, unit: "mg" };
  assert.equal(formatNumber(p, 20), "20 mg");
  assert.equal(formatNumber({ ...p, unit: "" }, 2.5), "2.5");
  assert.equal(formatNumber({ ...p, format: "hours" as const }, 3), "3 h");
});
