import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Subtasks in any database (as Kanban had them): a row's subtasks are rows of the same database linked to it by a relation
 * to itself ("Parent") — made with the first subtask; a new one starts in its parent's status; listed with whether they're
 * done; one level (a subtask has none of its own); made a row of its own again.
 */
test("subtasks: added (the relation Parent made once), listed with their state, one level, detached", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const s = await import("@/plugins/workspace/subtasks");
  const status: import("@/plugins/workspace/model").Property = { id: "st", name: "Status", type: "status", options: [{ id: "o1", name: "Offen", color: "gray", group: "todo" }, { id: "o2", name: "Läuft", color: "blue", group: "doing" }, { id: "o3", name: "Fertig", color: "green", group: "done" }] };
  const dbId = w.createPage({ kind: "database", title: "Board", schema: { titleName: "Name", properties: [status], views: [{ ...m.newView("Board", "board"), groupBy: "st" }] } });
  const parent = w.addRow(dbId, { title: "Relaunch", cells: { st: "o2" } });

  const a = s.addSubtask(parent, "Fonts");
  const parentProp = w.getDatabase(dbId)!.schema.properties.find((p) => p.type === "relation" && p.relationDb === dbId)!;
  assert.equal(parentProp.name, "Parent", "the relation made with the first subtask");
  assert.equal(w.getPage(a)!.props.st, "o2", "starts in its parent's status");
  const b = s.addSubtask(parent, "Farben");
  assert.equal(w.getDatabase(dbId)!.schema.properties.filter((p) => p.type === "relation").length, 1, "made once");
  w.setCell(b, "st", "o3");

  assert.deepEqual(s.subtasksOf(parent).map((x) => [x.title, x.done]), [["Fonts", false], ["Farben", true]]);
  assert.deepEqual(m.subtaskCounts(w.getDatabase(dbId)!.schema, w.rawRows(dbId), dbId)[parent], { done: 1, total: 2 }, "the card's counter");
  assert.throws(() => s.addSubtask(a, "Tiefer"), /subtask/i, "one level");

  s.detachSubtask(a);
  assert.deepEqual(s.subtasksOf(parent).map((x) => x.title), ["Farben"]);
  assert.equal(w.getPage(a)!.archivedAt, null, "a row of its own again, not gone");
});
