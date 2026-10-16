import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
delete process.env.JIRA_URL;

/**
 * My briefing becomes a database like any other: its rows from a pipeline (Jira: on me or followed, open) with the Lage as
 * AI fields — not kept by the Jira sync any more. Its rows (and their Lage) stay; once.
 */
test("briefingToPipelineOnce: My briefing a pipeline database, its rows and Lage kept, the Jira sync leaves it", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["kanban", "jira-lage", "workspace"]) setInstalled(id, true);
  const { getDb, schema } = await import("@/db");
  const w = await import("@/plugins/workspace/store");
  const { databaseSource } = await import("@/plugins/workspace/collections");
  const { syncJiraBoardDatabases, jiraBoardDatabase, briefingToPipelineOnce } = await import("@/plugins/jira-lage/to-workspace");
  const now = new Date().toISOString();
  getDb().insert(schema.jiraTickets).values({ key: "ME-1", summary: "Meins", status: "In Arbeit", statusCategory: "inprogress", assignee: "Ich", mine: true, updatedAt: now }).run();
  await syncJiraBoardDatabases();
  const dbId = jiraBoardDatabase("jira-lage")!;
  assert.ok(dbId, "My briefing kept by the sync first");
  // (Its rows come from the Ticket-Lage's runs — one as the sync keeps it.)
  const row = { id: w.addRow(dbId, { title: "Meins", cells: { ticketkey: "ME-1" } }) };
  (await import("@/plugins/workspace/lage-fields")).ensureLageFields(dbId);
  w.setCell(row.id, "lagelead", "Läuft.");

  const r = await briefingToPipelineOnce();
  assert.equal(r, dbId);
  const d = w.getDatabase(dbId)!;
  assert.equal(d.page.locked, false, "yours to change now");
  assert.equal(databaseSource(dbId), null, "not the Jira sync's any more");
  const src = d.schema.pipeline!.steps.find((s) => s.kind === "source")!;
  assert.deepEqual([src.from, src.jira?.mine, src.jira?.involved, src.jira?.briefed, src.jira?.openOnly, src.jira?.doneDays], ["jira", true, true, true, true, 3], "on me, followed or in the Ticket-Lage; open, or done lately");
  assert.ok(d.schema.pipeline!.steps.some((s) => s.kind === "ai" && s.prop === "lagelead"), "the Lage as AI steps");
  const after = w.rawRows(dbId);
  assert.ok(after.some((x) => x.id === row.id), "the same rows");
  assert.equal(w.getPage(row.id)!.props.lagelead, "Läuft.", "their Lage kept");
  assert.equal(await briefingToPipelineOnce(), null, "once");

  // The Jira sync leaves it alone now.
  const title = d.page.title;
  w.updatePage(dbId, { title: "Meine Lage (mein Titel)" });
  await syncJiraBoardDatabases();
  assert.equal(w.getDatabase(dbId)!.page.title, "Meine Lage (mein Titel)");
  assert.equal(jiraBoardDatabase("jira-lage"), dbId, "still found as My briefing");
  assert.ok(title);
});
