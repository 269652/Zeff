import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Packages that live: an install is remembered (which page is which item), a newer version updates the pages in place — yours stay —,
 * declared migrations change the data, requirements are checked, tests ship with the package, and every step is in a history that rolls back.
 */
const prop = (id: string, name: string, type: string, extra: Record<string, unknown> = {}) => ({ id, name, type, ...extra });
const schemaOf = (properties: unknown[], views: unknown[] = []) => ({ titleName: "Name", properties, views });
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

function v1() {
  return {
    format: 1 as const,
    id: "crm",
    name: "CRM",
    version: "1.0.0",
    items: [
      { id: "i1", kind: "page", title: "CRM", content: doc("Welcome v1") },
      { id: "i2", parent: "i1", kind: "database", title: "Deals", schema: schemaOf([prop("amount", "Amount", "number"), prop("stage", "Stage", "text")], [{ id: "all", name: "All", type: "table", filter: { and: [] }, sorts: [], hidden: [] }]), rows: [{ id: "r1", title: "First", cells: { amount: 10, stage: "new" } }] },
      { id: "i3", parent: "i1", kind: "page", title: "Notes", content: doc("Notes v1") },
    ],
    tests: [
      { name: "deals database has Amount", check: "property", db: "i2", property: "Amount", type: "number" },
      { name: "one sample row", check: "rows", db: "i2", min: 1, max: 1 },
      { name: "notes page there", check: "page", item: "i3" },
    ],
  };
}

function v2() {
  const p = v1();
  return {
    ...p,
    version: "1.1.0",
    items: [
      { id: "i1", kind: "page", title: "CRM", content: doc("Welcome v2") },
      { id: "i2", parent: "i1", kind: "database", title: "Deals", schema: schemaOf([prop("amount", "Amount", "number"), prop("stage", "Phase", "text"), prop("owner", "Owner", "text")], [{ id: "all", name: "All", type: "table", filter: { and: [] }, sorts: [], hidden: [] }, { id: "mine", name: "Mine", type: "table", filter: { and: [] }, sorts: [], hidden: [] }]) },
      { id: "i3", parent: "i1", kind: "page", title: "Notes", content: doc("Notes v2") },
      { id: "i4", parent: "i1", kind: "page", title: "Guide", content: doc("New in 1.1") },
    ],
    migrations: [{ from: "1.0.0", to: "1.1.0", steps: [{ op: "rename_property", db: "i2", from: "Stage", to: "Phase" }, { op: "fill", db: "i2", property: "Owner", value: "unassigned" }, { op: "map", db: "i2", property: "Phase", values: { new: "open" } }] }],
    tests: [...p.tests.slice(0, 1), { name: "guide is there", check: "page", item: "i4" }, { name: "owner filled", check: "property", db: "i2", property: "Owner" }],
  };
}

test("versions: ranges and order", async () => {
  const { satisfies, compareVersions } = await import("@/plugins/workspace/package-life");
  assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
  assert.ok(satisfies("1.2.3", "^1.0.0") && !satisfies("2.0.0", "^1.0.0") && satisfies("0.2.5", "^0.2.0") && !satisfies("0.3.0", "^0.2.0"));
  assert.ok(satisfies("1.2.9", "~1.2.0") && !satisfies("1.3.0", "~1.2.0"));
  assert.ok(satisfies("1.0.0", ">=1.0.0") && satisfies("9.9.9", "*") && satisfies("1.0.0", "") && !satisfies("0.9.0", ">=1.0.0") && satisfies("1.0.0", "1.0.0"));
});

test("install is remembered, tests ship with the package, an update changes what is yours not", async () => {
  const w = await import("@/plugins/workspace/store");
  const life = await import("@/plugins/workspace/package-life");
  const r = await life.installTracked(v1() as never, null);
  assert.ok(r.remembered);
  assert.deepEqual(r.tests.map((t) => t.ok), [true, true, true], JSON.stringify(r.tests));
  const inst = life.getInstalled("crm")!;
  assert.equal(inst.version, "1.0.0");
  assert.equal(Object.keys(inst.map).length, 3);
  // Installing the same package twice: refused (update it).
  await assert.rejects(() => life.installTracked(v1() as never, null), /installed already/);

  // The user changes the notes page, and adds a property to the deals; adds a row of their own.
  const notes = inst.map.i3;
  w.updatePage(notes, { content: doc("My own notes") });
  const dealsId = inst.map.i2;
  const sch = w.getPage(dealsId)!.schema!;
  w.updateSchema(dealsId, { ...sch, properties: [...sch.properties, prop("mine", "My field", "text")] });
  const rows = w.rawRows(dealsId);
  assert.equal(rows.length, 1);

  // Not newer: refused.
  await assert.rejects(() => life.updateTracked("crm", v1() as never), /not newer/);
  const rep = await life.updateTracked("crm", v2() as never);
  assert.equal(rep.from, "1.0.0");
  assert.equal(rep.to, "1.1.0");
  // The page you did not touch is updated, the one you wrote stays.
  assert.match(JSON.stringify(w.getPage(inst.map.i1)!.content), /Welcome v2/);
  assert.match(JSON.stringify(w.getPage(notes)!.content), /My own notes/);
  assert.ok(rep.kept.some((k) => k.includes("Notes")), rep.kept.join("|"));
  // A new page is made.
  const after = life.getInstalled("crm")!;
  assert.ok(after.map.i4);
  assert.equal(w.getPage(after.map.i4)!.title, "Guide");
  // The database you changed keeps your property and gets what is new (a property, a view); migrations ran on your data.
  const schema = w.getPage(dealsId)!.schema!;
  assert.deepEqual(schema.properties.map((p) => p.name).sort(), ["Amount", "My field", "Owner", "Phase"]);
  assert.ok(schema.views.some((v) => v.id === "mine"));
  const row = w.rawRows(dealsId)[0];
  const cell = (name: string) => row.cells[schema.properties.find((p) => p.name === name)!.id];
  assert.equal(cell("Owner"), "unassigned");
  assert.equal(cell("Phase"), "open");
  assert.equal(cell("Amount"), 10);
  // Tests ran with the new package; the history says what happened.
  assert.deepEqual(rep.tests.map((t) => t.ok), [true, true, true], JSON.stringify(rep.tests));
  assert.deepEqual(after.history.map((h) => [h.action, h.to]), [["install", "1.0.0"], ["update", "1.1.0"]]);
  assert.ok(rep.changes.some((c) => c.includes("is now “Phase”")));
});

test("roll back: the structure of an older version comes back over yours", async () => {
  const w = await import("@/plugins/workspace/store");
  const life = await import("@/plugins/workspace/package-life");
  assert.deepEqual(life.versionsKept("crm"), ["1.0.0", "1.1.0"]);
  const inst = life.getInstalled("crm")!;
  const rep = await life.rollbackTracked("crm", "1.0.0");
  assert.equal(rep.to, "1.0.0");
  assert.match(JSON.stringify(w.getPage(inst.map.i1)!.content), /Welcome v1/);
  assert.match(JSON.stringify(w.getPage(inst.map.i3)!.content), /Notes v1/);
  const h = life.getInstalled("crm")!.history;
  assert.equal(h[h.length - 1].action, "rollback");
  await assert.rejects(() => life.rollbackTracked("crm", "9.9.9"), /No snapshot/);
});

test("requirements: other packages in a version, plugins; what a package asks is shown beforehand", async () => {
  const life = await import("@/plugins/workspace/package-life");
  const base = { format: 1 as const, name: "Add-on", version: "1.0.0", items: [{ id: "i1", kind: "page", title: "Add-on", content: doc("x") }] };
  assert.deepEqual(life.checkRequirements({ ...base, requires: [{ package: "crm", version: "^1.0.0" }] } as never), []);
  assert.match(life.checkRequirements({ ...base, requires: [{ package: "crm", version: "^2.0.0" }] } as never).join(" "), /installed in version/);
  assert.match(life.checkRequirements({ ...base, requires: [{ package: "nope" }] } as never).join(" "), /needed first/);
  await assert.rejects(() => life.installTracked({ ...base, requires: [{ package: "nope" }] } as never, null), /needed first/);
  const perms = life.packagePermissions({
    ...base,
    plugins: ["notebook"],
    items: [
      { id: "i1", kind: "page", title: "Page", content: { type: "doc", content: [{ type: "zeffApp", attrs: { title: "Chart", writes: "12", html: "<p/>" } }] } },
      { id: "i2", kind: "page", title: "Flow", flow: { name: "x.y", title: "Sync", requested: { dbs: [3], ai: true } } },
    ],
  } as never);
  assert.ok(perms.widgets[0].includes("may write to databases 12"));
  assert.ok(perms.flows[0].includes("Sync") && perms.flows[0].includes("ai"));
  assert.deepEqual(perms.plugins, ["notebook"]);
});

test("a package without a version is installed as before, not remembered; a failing test is said", async () => {
  const life = await import("@/plugins/workspace/package-life");
  const r = await life.installTracked({ format: 1, name: "Plain", items: [{ id: "i1", kind: "page", title: "Plain", content: doc("x") }] } as never, null);
  assert.equal(r.remembered, false);
  const p = { ...v1(), id: "crm2", name: "CRM2", tests: [{ name: "too many rows", check: "rows", db: "i2", min: 5 }, { name: "no such property", check: "property", db: "i2", property: "Nope" }] };
  const bad = await life.installTracked(p as never, null);
  assert.deepEqual(bad.tests.map((t) => t.ok), [false, false]);
  assert.match(bad.tests[0].detail, /1 rows/);
  const status = await life.packageStatus();
  assert.deepEqual(status.map((s) => s.id).sort(), ["crm", "crm2"]);
});
