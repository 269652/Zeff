import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

async function monthlyCosts() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const { createPage, addRow, getDatabase } = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");
  const amount = { ...newProperty("Betrag", "number"), format: "euro" as const };
  const active = newProperty("Aktiv", "checkbox");
  const view = { ...newView("Laufend", "table"), filter: { op: "and" as const, rules: [{ prop: active.id, cond: "checked" }] } } as never;
  const db = createPage({ kind: "database", title: "Monatskosten", schema: { titleName: "Posten", properties: [amount, active], views: [view, newView("Alle", "table")] } });
  addRow(db, { title: "Miete", cells: { [amount.id]: 650, [active.id]: true } });
  addRow(db, { title: "Handy", cells: { [amount.id]: 15, [active.id]: true } });
  addRow(db, { title: "Gekündigtes Abo", cells: { [amount.id]: 9.99, [active.id]: false } });
  return { db, amount, active, view: getDatabase(db)!.schema.views[0] };
}

test("a column's calculation over the rows a view shows: sum, average, min, max, count — its filter applied", async () => {
  const { db, amount, view } = await monthlyCosts();
  const { viewCalc } = await import("@/plugins/workspace/values");
  assert.equal(viewCalc(db, view.id, amount.id, "sum"), 665, "the cancelled one is filtered out");
  assert.equal(viewCalc(db, view.id, amount.id, "average"), 332.5);
  assert.equal(viewCalc(db, view.id, amount.id, "max"), 650);
  assert.equal(viewCalc(db, view.id, amount.id, "count"), 2);
});

test("a calculation published under a name (Fixkosten): read live anywhere in Zeff — changed rows change it; the names to pick from; taken back", async () => {
  const { db, amount, active, view } = await monthlyCosts();
  const { publishValue, namedValue, listNamedValues, valueNameSuggestions, unpublishValue } = await import("@/plugins/workspace/values");
  assert.ok(valueNameSuggestions().some((s) => s.key === "fixkosten" && s.label === "Fixkosten"), "Fixkosten is among the names offered");
  publishValue({ label: "Fixkosten", dbId: db, viewId: view.id, propId: amount.id, fn: "sum" });
  assert.equal(namedValue("fixkosten")?.value, 665);
  assert.equal(namedValue("Fixkosten")?.value, 665, "by its label too");
  const { addRow } = await import("@/plugins/workspace/store");
  addRow(db, { title: "Strom", cells: { [amount.id]: 80, [active.id]: true } });
  assert.equal(namedValue("fixkosten")?.value, 745, "live");
  const listed = listNamedValues();
  assert.deepEqual(listed.map((v) => [v.key, v.label, v.value]), [["fixkosten", "Fixkosten", 745]]);
  assert.match(listed[0].sources[0].text, /Monatskosten/);
  unpublishValue("fixkosten");
  assert.equal(namedValue("fixkosten"), null);
});

test("a value type: several apps' columns make it (sum(Fixkosten) over all their rows); its aggregate sum by default, settable; it keeps only where it comes from", async () => {
  const { db, amount, view } = await monthlyCosts();
  const { createPage, addRow, getDatabase } = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");
  const fee = newProperty("Monatlich", "number");
  const subs = createPage({ kind: "database", title: "Abos", schema: { titleName: "Abo", properties: [fee], views: [newView("Alle", "table")] } });
  addRow(subs, { title: "Claude Max", cells: { [fee.id]: 200 } });
  const subsView = getDatabase(subs)!.schema.views[0].id;
  const { publishValue, namedValue, setValueAggregate, removeValueSource, valueSources } = await import("@/plugins/workspace/values");
  publishValue({ label: "Fixkosten", dbId: db, viewId: view.id, propId: amount.id });
  publishValue({ label: "Fixkosten", dbId: subs, viewId: subsView, propId: fee.id });
  publishValue({ label: "Fixkosten", dbId: subs, viewId: subsView, propId: fee.id });
  assert.deepEqual(valueSources("fixkosten"), [
    { dbId: db, viewId: view.id, propId: amount.id },
    { dbId: subs, viewId: subsView, propId: fee.id },
  ], "only references — each column once");
  const v = namedValue("fixkosten")!;
  assert.equal(v.agg, "sum");
  assert.equal(v.value, 865, "sum over both apps' rows (650 + 15 + 200)");
  assert.deepEqual(v.sources.map((s) => s.value), [665, 200]);
  setValueAggregate("fixkosten", "max");
  assert.equal(namedValue("fixkosten")!.value, 650);
  setValueAggregate("fixkosten", "sum");
  removeValueSource("fixkosten", { dbId: subs, viewId: subsView, propId: fee.id });
  assert.equal(namedValue("fixkosten")!.value, 665);
  const { getPref } = await import("@/lib/prefs");
  assert.doesNotMatch(JSON.stringify(getPref("workspace.valueTypes", {})), /Miete|650/, "no rows or figures kept — only where they come from");
});

test("the old single-source values come along as types with one source", async () => {
  const { db, amount, view } = await monthlyCosts();
  const { setPref } = await import("@/lib/prefs");
  setPref("workspace.values", { sparrate: { label: "Sparrate", dbId: db, viewId: view.id, propId: amount.id, fn: "sum" } });
  const { namedValue } = await import("@/plugins/workspace/values");
  assert.equal(namedValue("sparrate")?.value, 665);
});
