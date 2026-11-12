import assert from "node:assert/strict";
import test from "node:test";

/** <schedule>: rows with a time drawn as a calendar — what goes to the grid (times, all day, colour, which may be dragged) and what it is told. */
test("a schedule takes its items' times from the rows: a time, a day, a range; the rest left out", async () => {
  const { renderView } = await import("@/plugins/workspace/view-template");
  const props = [
    { id: "s", name: "Start", type: "date" },
    { id: "e", name: "End", type: "date" },
    { id: "k", name: "Kind", type: "text" },
  ] as never;
  const row = (id: number, title: string, cells: Record<string, unknown>) => ({ id, title, cells, createdAt: "", updatedAt: "", position: id });
  const rows = [
    row(1, "Meeting", { s: "2026-11-12T10:00", e: "2026-11-12T11:30", k: "blue" }),
    row(2, "Holiday", { s: { start: "2026-11-13", end: "2026-11-15" } }),
    row(3, "No date", {}),
  ] as never;
  const src = `<state name="view" value="week"/><schedule source="rows" color="Kind" view="{{ state.view }}" day="2026-11-12" bind="picked" emit="opened" move="moved"/>`;
  const r = renderView(src, { rows, props, titleName: "Name", state: {}, app: {}, data: {}, db: { id: 1, title: "Things" } });
  assert.deepEqual(r.errors, []);
  const node = r.nodes.find((n) => typeof n !== "string" && n.t === "schedule") as { a: Record<string, string> };
  const items = JSON.parse(node.a.items);
  assert.deepEqual(
    items.map((x: { id: string; start: string; end: string; allDay: boolean; editable: boolean }) => [x.id, x.start, x.end, x.allDay, x.editable]),
    [
      ["1", "2026-11-12T10:00", "2026-11-12T11:30", false, true],
      ["2", "2026-11-13", "2026-11-15", true, true],
    ],
  );
  assert.equal(items[0].color, "blue");
  assert.deepEqual([node.a.view, node.a.day, node.a.bind, node.a.emit, node.a.move], ["week", "2026-11-12", "picked", "opened", "moved"]);
});
