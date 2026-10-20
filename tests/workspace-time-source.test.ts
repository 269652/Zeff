import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The time you booked is something a relation can point at — no database of it is made. A database of tickets (or projects, jobs) matches
 * its rows to the entries and rolls them up: "Hours booked" per ticket, live, also over a filtered part (this month, one kind of work).
 */
test("booked time as the source of a matching relation: hours per ticket, with and without a filter; no database of its own", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const { createJob } = await import("@/lib/jobs");
  const { createEntry } = await import("@/lib/entries");
  createJob({ number: "100200", name: "Relaunch" });
  const book = (hours: number, ticket: string | undefined, description: string, date = "2026-10-12", type = "ticket") => createEntry({ jobNumber: "100200", date, hours, description, ticket, type } as never, "web");
  book(1.5, "PROJ-1", "Analyse");
  book(2, "PROJ-1", "Umsetzung", "2026-09-30", "meeting");
  book(4, "PROJ-2", "Review");
  book(1, undefined, "Meeting");

  const w = await import("@/plugins/workspace/store");
  const { relationSources, sourceTable } = await import("@/plugins/workspace/source-table");
  const { sourcesOverview } = await import("@/plugins/workspace/sources");
  w.tree(); // (makes the Workspace tables)
  assert.ok(relationSources().some((s) => s.id === "time"), "the booked time is one of them");
  assert.ok(!sourcesOverview().some((s) => s.key === "ext:time"), "it is not offered as a database of its own");
  const table = sourceTable("time")!;
  assert.equal(table.rows.length, 4);
  const prop = (name: string) => table.schema.properties.find((p) => p.name === name)!;
  assert.deepEqual(table.schema.properties.map((p) => p.name), ["Date", "Hours", "Ticket", "Job", "Project", "Type", "Reported by"]);

  const tickets = w.createPage({
    kind: "database",
    title: "Tickets",
    schema: {
      titleName: "Ticket",
      properties: [
        { id: "booked", name: "Time booked", type: "relation", relationSource: "time", match: { from: "title", to: prop("Ticket").id } },
        { id: "total", name: "Hours booked", type: "rollup", rollup: { relation: "booked", property: prop("Hours").id, fn: "sum" } },
        { id: "oct", name: "Hours in October", type: "rollup", rollup: { relation: "booked", property: prop("Hours").id, fn: "sum", filter: { op: "and", rules: [{ prop: prop("Date").id, cond: "on_or_after", value: "2026-10-01" }] } } },
        { id: "meet", name: "Meetings", type: "rollup", rollup: { relation: "booked", property: prop("Hours").id, fn: "sum", filter: { op: "and", rules: [{ prop: prop("Type").id, cond: "is", value: "meeting" }] } } },
      ],
      views: [],
    },
  });
  for (const t of ["PROJ-1", "PROJ-2", "PROJ-3"]) w.addRow(tickets, { title: t, cells: {} });
  const out = w.rowsOf(tickets)!.rows;
  const cell = (t: string, id: string) => out.find((r) => r.title === t)!.cells[id];
  assert.equal(cell("PROJ-1", "total"), 3.5);
  assert.equal(cell("PROJ-1", "oct"), 1.5, "the filter: only entries from October on");
  assert.equal(cell("PROJ-1", "meet"), 2, "the filter: only meetings");
  assert.equal(cell("PROJ-2", "total"), 4);
  assert.equal(cell("PROJ-3", "total"), 0);

  // A new booking is there at the next read - nothing to refresh.
  book(0.5, "PROJ-3", "Nachfrage");
  assert.equal(w.rowsOf(tickets)!.rows.find((r) => r.title === "PROJ-3")!.cells.total, 0.5);

  // The matched entries are not pages: nothing is looked up as a page (the ids are the table's row numbers), and a text export says how many.
  const shown = w.rowsOf(tickets)!;
  const labels = await w.labelsFor(shown.schema, shown.rows);
  assert.deepEqual(labels.pages, {}, "no page titles for a source's rows");
  const { cellText } = await import("@/plugins/workspace/model");
  assert.equal(cellText(shown.schema.properties[0], shown.rows.find((r) => r.title === "PROJ-1")!.cells.booked, labels as never), "2");

  // What the rollup wizard offers.
  const { relationSourcesAction } = await import("@/plugins/workspace/actions");
  const r = await relationSourcesAction();
  assert.ok(r.ok && r.sources.find((s) => s.id === "time")!.schema.properties.some((p) => p.name === "Hours"));
});

test("date filters by calendar month and year (a rollup of this month's hours)", async () => {
  const { matchRule, newProperty } = await import("@/plugins/workspace/model");
  const d = newProperty("Date", "date");
  const row = (v: string) => ({ id: 1, title: "", icon: "", cells: { [d.id]: v }, createdAt: "", updatedAt: "" });
  const rule = (cond: "this_month" | "last_month" | "this_year") => ({ prop: d.id, cond });
  const now = new Date();
  const iso = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const thisMonth = iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const lastMonth = iso(new Date(now.getFullYear(), now.getMonth() - 1, 15));
  assert.equal(matchRule(row(thisMonth), rule("this_month"), [d]), true);
  assert.equal(matchRule(row(lastMonth), rule("this_month"), [d]), false);
  assert.equal(matchRule(row(lastMonth), rule("last_month"), [d]), true);
  assert.equal(matchRule(row(iso(new Date(now.getFullYear() - 1, 5, 1))), rule("this_year"), [d]), false);
  assert.equal(matchRule(row(thisMonth), rule("this_year"), [d]), true);
});

test("an agent sets up the same through the schema operations: a relation to the source with a match, a rollup with a filter", async () => {
  const { applyOps } = await import("@/plugins/workspace/schema-ops");
  const { sourceTable } = await import("@/plugins/workspace/source-table");
  const { normalizeSchema } = await import("@/plugins/workspace/model");
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const base = normalizeSchema({ titleName: "Ticket", properties: [], views: [] });
  const related = (k: number | string) => (typeof k === "string" ? (sourceTable(k)?.schema ?? null) : null);
  const { schema } = applyOps(
    base,
    [
      { op: "add_property", name: "Booked", type: "relation", relation: { source: "time", match: { from: "title", to: "Ticket" } } },
      { op: "add_property", name: "Hours this month", type: "rollup", rollup: { relation: "Booked", property: "Hours", fn: "sum", filter: [{ property: "Date", cond: "this_month" }] } },
    ] as never,
    { related },
  );
  const rel = schema.properties[0];
  assert.equal(rel.relationSource, "time");
  assert.equal(rel.match?.from, "title");
  assert.equal(schema.properties[1].rollup?.filter?.rules.length, 1);
  assert.throws(() => applyOps(base, [{ op: "add_property", name: "X", type: "relation", relation: { source: "time" } }] as never, { related }), /needs relation.match/);
});
