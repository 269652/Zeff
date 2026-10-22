import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

test("the deadline radar: a date field set to remind brings its rows into Needs attention within its days — past ones as overdue, done ones and far ones not", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "todos"]) setInstalled(p, true);
  setInstalled("finances", false);
  await import("@/plugins/contributions");
  const { fromTemplate } = await import("@/plugins/workspace/templates");
  const { addRow, getDatabase } = await import("@/plugins/workspace/store");
  const id = await fromTemplate("contracts", null);
  const s = getDatabase(id)!.schema;
  const cancel = s.properties.find((p) => p.type === "date" && p.remind === 30)!;
  assert.ok(cancel, "the contracts' cancel-by reminds a month before");
  const st = s.properties.find((p) => p.type === "status")!;
  addRow(id, { title: "Fitnessstudio", cells: { [cancel.id]: day(20) } });
  addRow(id, { title: "Zeitung", cells: { [cancel.id]: day(-3) } });
  addRow(id, { title: "Weit weg", cells: { [cancel.id]: day(90) } });
  addRow(id, { title: "Gekündigt", cells: { [cancel.id]: day(5), [st.id]: st.options!.find((o) => o.group === "done")!.id } });
  const { deadlines } = await import("@/plugins/workspace/deadlines");
  const near = deadlines().filter((d) => d.dbId === id);
  assert.deepEqual(near.map((d) => [d.title, d.days]), [["Zeitung", -3], ["Fitnessstudio", 20]], "the past first, the far and the done left out");
  const { widgetData } = await import("@/plugins/workspace/widgets");
  const att = await widgetData("workspace.attention", { limit: 20 });
  assert.ok(att.kind === "list" && att.items.some((i) => i.text === "Fitnessstudio" && i.tone === "warn") && att.items.some((i) => i.text === "Zeitung" && i.tone === "bad"));
});
