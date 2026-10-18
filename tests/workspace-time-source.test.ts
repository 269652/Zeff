import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The time you booked is a source of the Workspace: a database "Time booked" with one row per entry (date, hours, ticket, job, project,
 * type). A database of tickets (or projects, jobs) rolls it up through a matching relation — "Hours booked" per ticket, live.
 */
test("time booked as a database: rows per entry; a matching relation + rollup gives the hours per ticket", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const { createJob } = await import("@/lib/jobs");
  const { createEntry } = await import("@/lib/entries");
  createJob({ number: "100200", name: "Relaunch" });
  const book = (hours: number, ticket: string | undefined, description: string, date = "2026-10-12") => createEntry({ jobNumber: "100200", date, hours, description, ticket } as never, "web");
  book(1.5, "PROJ-1", "Analyse");
  book(2, "PROJ-1", "Umsetzung");
  book(4, "PROJ-2", "Review");
  book(1, undefined, "Meeting");

  const derived = await import("@/plugins/workspace/derived");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const w = await import("@/plugins/workspace/store");
  const { extSources } = await import("@/plugins/workspace/source-point");
  const src = (await extSources()).find((s) => s.id === "time");
  assert.ok(src, "Time tracking brings the source");
  assert.equal(src.count!(), 4);

  const timeDb = await derived.createExtSourceDatabase("time");
  await runPipeline(timeDb, { ai: false });
  const time = w.rowsOf(timeDb)!;
  assert.equal(time.rows.length, 4);
  const byTitle = Object.fromEntries(time.rows.map((r) => [r.title, r]));
  const prop = (name: string) => time.schema.properties.find((p) => p.name === name)!;
  assert.equal(byTitle["Analyse"].cells[prop("Hours").id], 1.5);
  assert.equal(byTitle["Analyse"].cells[prop("Ticket").id], "PROJ-1");
  assert.equal(byTitle["Analyse"].cells[prop("Date").id], "2026-10-12");
  assert.match(String(byTitle["Analyse"].cells[prop("Job").id]), /100200/);

  // Tickets roll the hours up through a matching relation on their title.
  const tickets = w.createPage({
    kind: "database",
    title: "Tickets",
    schema: {
      titleName: "Ticket",
      properties: [
        { id: "booked", name: "Booked", type: "relation", relationDb: timeDb, match: { from: "title", to: prop("Ticket").id } },
        { id: "total", name: "Hours booked", type: "rollup", rollup: { relation: "booked", property: prop("Hours").id, fn: "sum" } },
      ],
      views: [],
    },
  });
  for (const t of ["PROJ-1", "PROJ-2", "PROJ-3"]) w.addRow(tickets, { title: t, cells: {} });
  const out = w.rowsOf(tickets)!.rows;
  const total = (t: string) => out.find((r) => r.title === t)!.cells.total;
  assert.equal(total("PROJ-1"), 3.5);
  assert.equal(total("PROJ-2"), 4);
  assert.equal(total("PROJ-3"), 0);

  // A new booking shows after the next read of the source.
  book(0.5, "PROJ-3", "Nachfrage");
  await runPipeline(timeDb, { ai: false, force: true });
  assert.equal(w.rowsOf(tickets)!.rows.find((r) => r.title === "PROJ-3")!.cells.total, 0.5);
});
