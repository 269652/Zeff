import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("templates: Finances and Who owes whom are pages of live widgets; an authority page; instalment plans roll their payments up; contracts know what they cost a year", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "cases"]) setInstalled(p, true);
  await import("@/plugins/contributions");
  const { templateMetas, fromTemplate } = await import("@/plugins/workspace/templates");
  const { getPage, getDatabase, rawRows } = await import("@/plugins/workspace/store");
  const keys = templateMetas().map((m) => m.key);
  for (const k of ["finances", "who-owes", "authority", "installment-plan", "contracts"]) assert.ok(keys.includes(k), k);

  const widgetsOf = (id: number) => JSON.stringify(getPage(id)!.content).match(/"widget":"[a-z.]+"/g) ?? [];
  assert.deepEqual(widgetsOf(fromTemplate("finances", null)), ['"widget":"cases.figures"', '"widget":"cases.due"', '"widget":"cases.open"', '"widget":"people.owed"']);
  assert.equal(widgetsOf(fromTemplate("who-owes", null)).length, 2);
  assert.ok(getPage(fromTemplate("authority", null)));

  const { checkFormula } = await import("@/plugins/workspace/formula");
  const plans = fromTemplate("installment-plan", null);
  const plan = getDatabase(plans)!.schema;
  const paid = plan.properties.find((p) => p.type === "rollup")!;
  assert.equal(paid.rollup?.fn, "sum");
  const open = plan.properties.find((p) => p.type === "formula")!;
  assert.equal(checkFormula(open.formula!), null, open.formula);
  assert.ok(rawRows(plans).length >= 1, "an example plan");

  const contracts = getDatabase(fromTemplate("contracts", null))!.schema;
  const yearly = contracts.properties.find((p) => p.type === "formula")!;
  assert.equal(checkFormula(yearly.formula!), null, yearly.formula);
});
