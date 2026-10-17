import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("joins: left keeps the rows without a match, inner drops them; exact vs. inside; several matches as the first, all in one field, or a row each", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const { applyJoin } = await import("@/plugins/workspace/pipeline");
  const orders = w.createPage({ kind: "database", title: "Contacts" });
  w.updateSchema(orders, { ...w.getDatabase(orders)!.schema, properties: [{ id: "key", name: "Key", type: "text" }, { id: "role", name: "Role", type: "text" }] });
  for (const [title, key, role] of [["Ann", "ann@x.io", "Lead"], ["Ann Two", "ann@x.io", "Backup"], ["Bob", "bob@x.io", "Dev"]]) {
    const id = w.addRow(orders, { title });
    w.setCell(id, "key", key);
    w.setCell(id, "role", role);
  }
  const rec = (ref: string, who: string) => ({ ref, title: ref, fields: { Who: who }, url: "", updatedAt: "2026-10-17" }) as never;
  const records = [rec("r1", "Ann <ann@x.io>"), rec("r2", "ann@x.io"), rec("r3", "nobody@y.io")];
  const base = { id: "j", kind: "join" as const, dbId: orders, on: "Who", by: "Key", bring: ["Role", "title"] };
  const left = applyJoin(records, base);
  assert.equal(left.records.length, 3, "left: the unmatched stays");
  assert.equal(left.records[0].fields.Role, "Lead", "the first match; the key is inside \"Ann <ann@x.io>\"");
  assert.equal(left.records[0].fields.Title, "Ann");
  assert.equal(left.records[2].fields.Role, undefined);
  assert.equal(applyJoin(records, { ...base, joinType: "inner" }).records.length, 2, "inner drops the record without a row");
  assert.deepEqual([...applyJoin(records, { ...base, exact: true }).matched], ["r2"], "exact: the address inside a name is no match");
  const all = applyJoin(records, { ...base, many: "all" }).records[1];
  assert.equal(all.fields.Role, "Lead, Backup");
  assert.equal(all.fields.Title, "Ann, Ann Two");
  const expand = applyJoin(records, { ...base, many: "expand", joinType: "inner" }).records;
  assert.equal(expand.length, 4, "r1 and r2 twice each");
  assert.deepEqual(expand.map((r) => (r as { ref: string }).ref).filter((x) => x.startsWith("r1")).length, 2);
  assert.equal(new Set(expand.map((r) => (r as { ref: string }).ref)).size, 4, "every record keeps a ref of its own");
  const m = await import("@/plugins/workspace/model");
  const n = m.normalizePipeline({ steps: [{ id: "j", kind: "join", dbId: 5, on: "A", joinType: "inner", exact: true, many: "expand" }, { id: "k", kind: "join", dbId: 5, on: "A", joinType: "weird", many: "x" }] });
  assert.deepEqual([n.steps[0].joinType, n.steps[0].exact, n.steps[0].many], ["inner", true, "expand"]);
  assert.deepEqual([n.steps[1].joinType, n.steps[1].exact, n.steps[1].many], [undefined, undefined, undefined]);
});
