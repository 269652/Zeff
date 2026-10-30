import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("templates: money is the plugins' (Finances, cases) — no finances page, debts, instalment plans or who-owes-whom; contracts know what they cost a year", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "cases"]) setInstalled(p, true);
  setInstalled("finances", false);
  await import("@/plugins/contributions");
  const { templateMetas, fromTemplate } = await import("@/plugins/workspace/templates");
  const { getDatabase } = await import("@/plugins/workspace/store");
  const keys = templateMetas().map((m) => m.key);
  for (const k of ["finances", "who-owes", "authority", "installment-plan"]) assert.ok(!keys.includes(k), k);
  assert.ok(keys.includes("contracts"));

  const { checkFormula } = await import("@/plugins/workspace/formula");
  const contracts = getDatabase(await fromTemplate("contracts", null))!.schema;
  const yearly = contracts.properties.find((p) => p.type === "formula")!;
  assert.equal(checkFormula(yearly.formula!), null, yearly.formula);
});
