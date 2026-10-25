import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

// An entry closed: locked (its cells too), in the tree under its database, and the next one made — every tick unticked, the day after;
// opened again, the lock goes and the next one with it, while nothing was put in it.

async function journal() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const db = w.createPage({
    kind: "database",
    title: "Tagebuch",
    schema: {
      titleName: "Name",
      properties: [
        { id: "d", name: "Datum", type: "date" },
        { id: "m", name: "Medikament genommen", type: "checkbox" },
        { id: "s", name: "Sport", type: "checkbox" },
        { id: "e", name: "Energie", type: "number" },
      ],
      views: [{ id: "v1", name: "Tabelle", type: "table", filter: { op: "and", rules: [] }, sorts: [], hidden: [] }],
    },
  });
  const row = w.addRow(db, { title: "Guter Tag", cells: { d: "2030-01-10", m: true, s: true, e: 4 } });
  return { w, db, row };
}

test("closed: locked (no cell changes), the next entry made — ticks unticked, the day after, nothing else; in the tree", async () => {
  const { w, db, row } = await journal();
  const { closeRow } = await import("@/plugins/workspace/close-row");
  const next = closeRow(row);
  assert.equal(w.getPage(row)!.locked, true);
  assert.throws(() => w.setCell(row, "e", 1), /closed/);
  const n = w.getPage(next)!;
  assert.equal(n.dbId, db);
  assert.deepEqual(n.props, { m: false, s: false, d: "2030-01-11" });
  assert.throws(() => closeRow(row), /closed already/);
  const { appNavs } = await import("@/plugins/workspace/app-nav");
  const nav = (await appNavs())[db];
  assert.deepEqual(nav.entries.map((e) => [e.label, e.group, e.href]), [["10.01. · Guter Tag", "Closed entries", `/workspace/${row}`]]);
});

test("opened again: unlocked, the untouched next entry in the trash — one already written in stays", async () => {
  const { w, row } = await journal();
  const { closeRow, reopenRow } = await import("@/plugins/workspace/close-row");
  const next = closeRow(row);
  assert.deepEqual(reopenRow(row), { discarded: true });
  assert.equal(w.getPage(row)!.locked, false);
  assert.ok(w.getPage(next)!.archivedAt, "the untouched next one is gone");
  w.setCell(row, "e", 5);
  const again = closeRow(row);
  w.setCell(again, "e", 3);
  assert.deepEqual(reopenRow(row), { discarded: false });
  assert.equal(w.getPage(again)!.archivedAt, null, "written in: it stays");
});

test("the next day: the closed one's day + 1, but today at the earliest", async () => {
  const { nextCells } = await import("@/plugins/workspace/close-row");
  const props = [{ id: "d", type: "date" }, { id: "c", type: "checkbox" }];
  assert.deepEqual(nextCells(props, { d: "2026-10-22", c: true }, "2026-10-24"), { c: false, d: "2026-10-24" }, "an old one: today");
  assert.deepEqual(nextCells(props, { d: "2026-10-24" }, "2026-10-24"), { c: false, d: "2026-10-25" });
  assert.deepEqual(nextCells([{ id: "c", type: "checkbox" }], { c: true }), { c: false }, "no date: just the ticks");
});
