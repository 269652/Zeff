import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("views: a timeline and a chart are views the AI and the UI can add; a chart counts or sums rows by a field", async () => {
  (await import("@/plugins/state")).setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const { chartPoints } = await import("@/plugins/workspace/ui/view-chart");
  const id = store.createPage({ kind: "database", title: "Plan" });
  const { schema } = applyOps(
    store.getDatabase(id)!.schema,
    [
      { op: "add_property", name: "Start", type: "date" },
      { op: "add_property", name: "End", type: "date" },
      { op: "add_property", name: "Cost", type: "number" },
      { op: "add_property", name: "Team", type: "select", options: ["Red", "Blue"] },
      { op: "add_view", name: "Gantt", type: "timeline", dateProp: "Start", endProp: "End" },
      { op: "add_view", name: "Cost by team", type: "chart", groupBy: "Team", chartKind: "pie", chartCalc: "sum", chartProp: "Cost" },
    ],
    { related: () => null },
  );
  const saved = store.saveSchema(id, schema);
  const p = (n: string) => saved.properties.find((x) => x.name === n)!;
  const gantt = saved.views.find((v) => v.name === "Gantt")!;
  const chart = saved.views.find((v) => v.name === "Cost by team")!;
  assert.deepEqual([gantt.type, gantt.dateProp, gantt.endProp], ["timeline", p("Start").id, p("End").id]);
  assert.deepEqual([chart.type, chart.groupBy, chart.chartKind, chart.chartCalc, chart.chartProp], ["chart", p("Team").id, "pie", "sum", p("Cost").id]);
  const team = (n: string) => p("Team").options!.find((o) => o.name === n)!.id;
  for (const [title, t, cost] of [["a", "Red", 10], ["b", "Red", 5], ["c", "Blue", 7]] as const) {
    store.addRow(id, { title, cells: { [p("Team").id]: team(t), [p("Cost").id]: cost } });
  }
  const rows = store.rowsOf(id)!.rows;
  const sum = chartPoints(chart, rows, saved, "none");
  assert.deepEqual(sum.points.map((x) => [x.label, x.value]), [["Red", 15], ["Blue", 7]]);
  const count = chartPoints({ ...chart, chartCalc: undefined, chartProp: undefined }, rows, saved, "none");
  assert.deepEqual(count.points.map((x) => x.value), [2, 1]);
  const bad = applyOps(saved, [{ op: "update_view", view: "Gantt", chartKind: "nonsense" }], { related: () => null }).schema.views.find((v) => v.name === "Gantt")!;
  assert.equal(bad.chartKind, undefined, "an unknown chart kind is dropped");
});
