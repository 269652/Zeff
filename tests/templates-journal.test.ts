import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("the journal: its days and reviews drawn by their templates without errors, two scheduled agents (weekly, monthly) off until switched on", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const { fromTemplate } = await import("@/plugins/workspace/templates");
  const { getDatabase, getPage, rawRows, subtree } = await import("@/plugins/workspace/store");
  const { getRoutine } = await import("@/plugins/workspace/routines");
  const { renderView } = await import("@/plugins/workspace/view-template");
  const { vnodeToString } = await import("@/plugins/workspace/card-template");
  const root = await fromTemplate("journal", null);
  assert.equal(getPage(root)!.title, "Journal");
  const kids = subtree(root).map((id) => getPage(id)!).filter((p) => p.parentId === root);
  const [entries, reviews] = ["Journal entries", "Reviews"].map((n) => kids.find((p) => p.title === n && p.kind === "database")!.id);

  const { listCollections } = await import("@/lib/items");
  assert.equal(listCollections().find((c) => c.id === `workspace:${entries}`)?.knowledge, true, "the entries go into the knowledge");
  assert.notEqual(listCollections().find((c) => c.id === `workspace:${reviews}`)?.knowledge, true, "the reviews don't");

  const draw = (db: number, state: Record<string, string> = {}, texts: Record<number, string> = {}) => {
    const { page, schema } = getDatabase(db)!;
    const view = schema.views[0];
    assert.equal(view.app, "template");
    return renderView(view.template!, { rows: rawRows(db), props: schema.properties, titleName: schema.titleName, state, app: {}, db: { id: db, title: page.title }, now: new Date(), texts });
  };
  const first = rawRows(entries).find((r) => r.title === "Started the journal")!;
  const e = draw(entries, {}, { [first.id]: "Wrote my first lines.\nAnd a second one." });
  assert.deepEqual(e.errors, []);
  const feed = vnodeToString(e.nodes);
  assert.match(feed, /Started the journal/);
  assert.match(feed, /Wrote my first lines\.\s*And a second one\./, "what the entry's page says is read in the feed");
  assert.match(feed, /Nothing written yet/, "an entry with an empty page says so");
  assert.doesNotMatch(JSON.stringify(e.nodes), /"action":"new"/, "no New of its own — the toolbar's");

  const { addRow, getPage: page } = await import("@/plugins/workspace/store");
  const dateProp = getDatabase(entries)!.schema.properties.find((p) => p.type === "date")!;
  assert.equal(page(addRow(entries, {}))!.props[dateProp.id], new Date().toLocaleDateString("sv-SE"), "a new entry starts with today");
  assert.equal(page(addRow(entries, { cells: { [dateProp.id]: "2026-01-02" } }))!.props[dateProp.id], "2026-01-02", "a date given stays");
  const s = getDatabase(reviews)!.schema;
  const by = (n: string) => s.properties.find((p) => p.name === n)!;
  addRow(reviews, { title: "Week 43", cells: { [by("Kind").id]: by("Kind").options![0].id, [by("Summary").id]: "A calm week." } });
  addRow(reviews, { title: "October 2026", cells: { [by("Kind").id]: by("Kind").options![1].id, [by("Summary").id]: "A full month." } });
  const week = draw(reviews);
  assert.deepEqual(week.errors, []);
  assert.match(vnodeToString(week.nodes), /A calm week/);
  assert.doesNotMatch(vnodeToString(week.nodes), /A full month/, "the weekly tab first");
  assert.match(vnodeToString(draw(reviews, { kind: "Month" }).nodes), /A full month/);

  const agents = kids.filter((p) => getRoutine(p.id)).map((p) => getRoutine(p.id)!);
  assert.deepEqual(agents.map((r) => [r.kind, r.enabled, r.triggers, r.permissions.scope]), [
    ["agent", false, [{ kind: "schedule", at: "07:00", days: [1] }], "parent"],
    ["agent", false, [{ kind: "schedule", at: "07:30", monthDay: 1 }], "parent"],
  ]);
});
