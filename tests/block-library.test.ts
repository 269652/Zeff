import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** The block library: every ready-made block is a valid block, draws on a database with the usual fields and without errors. */
test("every library block checks out on a database with the usual fields", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const { LIBRARY, CATEGORIES } = await import("@/plugins/workspace/block-library");
  const { checkBlock } = await import("@/plugins/workspace/block-check");
  const { renderView } = await import("@/plugins/workspace/view-template");
  const bs = await import("@/plugins/workspace/block-store");
  const db = w.createPage({ kind: "database", title: "Deals" });
  w.updateSchema(db, {
    ...w.getDatabase(db)!.schema,
    properties: [
      { id: "st", name: "Status", type: "status", options: [{ id: "o", name: "Open", color: "blue" }, { id: "d", name: "Done", color: "green" }] },
      { id: "ow", name: "Owner", type: "select", options: [{ id: "a", name: "Anna", color: "gray" }] },
      { id: "am", name: "Amount", type: "number" },
      { id: "du", name: "Due", type: "date" },
      { id: "sr", name: "Stars", type: "number" },
    ] as never,
  });
  w.addRow(db, { title: "Alpha", cells: { st: "o", ow: "a", am: 100, du: "2026-11-12", sr: 4 } });
  w.addRow(db, { title: "Beta", cells: { st: "d", ow: "a", am: 250, du: "2026-11-20", sr: 2 } });

  assert.ok(LIBRARY.length >= 20, "a real library");
  assert.equal(new Set(LIBRARY.map((b) => b.name)).size, LIBRARY.length, "names are unique");
  for (const c of CATEGORIES) assert.ok(LIBRARY.some((b) => b.category === c), `a block in ${c}`);

  const bad: string[] = [];
  for (const { category: _c, ...def } of LIBRARY) {
    void _c;
    const r = checkBlock(def, { dbId: db });
    if (r.errors.length) bad.push(`${def.name}: ${JSON.stringify(r.errors)}`);
    // Installed as an ordinary block, and used as its example says: no error where it is used either.
    const saved = bs.saveBlock(r.block, { source: "package", note: "library" });
    const d = w.getDatabase(db)!;
    const rows = w.rowsOf(db)!.rows;
    const out = renderView(def.example ?? "", { rows, props: d.schema.properties, titleName: d.schema.titleName, state: {}, app: {}, data: {}, db: { id: db, title: "Deals" } }, { blocks: bs.listBlocks() });
    if (out.errors.length) bad.push(`${saved.name} as used: ${JSON.stringify(out.errors)}`);
    else if (!out.nodes.length) bad.push(`${saved.name} draws nothing`);
  }
  assert.deepEqual(bad, []);
});
