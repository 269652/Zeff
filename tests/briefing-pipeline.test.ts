import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
delete process.env.JIRA_URL;

/**
 * My briefing goes for good: the board the Jira sync kept (its rows from the Ticket-Lage, its Lage written onto it) and the
 * page over it go to the trash. In their place a database like any other — "Meine Lage": a pipeline (Jira: on me or
 * followed, open, done lately), its AI steps the Lage (attention, a sentence per ticket) and one overall summary — only
 * what any pipeline can choose. The Ticket-Lage writes nothing into it; its own AI review reads every row.
 */
test("replaceBriefingOnce: My briefing replaced by a pipeline database with its own AI steps", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["jira-lage", "workspace"]) setInstalled(id, true);
  const { getDb, schema } = await import("@/db");
  const w = await import("@/plugins/workspace/store");
  const { databaseSource } = await import("@/plugins/workspace/collections");
  const { applyTicketLage } = await import("@/plugins/workspace/lage-fields");
  const { syncJiraBoardDatabases, jiraBoardDatabase, jiraBoardHref, replaceBriefingOnce, briefingDatabase } = await import("@/plugins/jira-lage/to-workspace");
  const now = new Date().toISOString();
  getDb().insert(schema.jiraTickets).values({ key: "ME-1", summary: "Meins", status: "In Arbeit", statusCategory: "inprogress", assignee: "Ich", mine: true, updatedAt: now }).run();
  getDb().insert(schema.jiraTickets).values({ key: "OT-1", summary: "Fremd", status: "Offen", statusCategory: "todo", assignee: "Anna", mine: false, updatedAt: now }).run();

  // As before: the sync kept My briefing.
  const { createPage } = w;
  const legacy = createPage({ kind: "database", title: "My briefing", schema: { titleName: "Summary", properties: [], views: [] } });
  const { getSqlite } = await import("@/db");
  getSqlite().exec("create table if not exists jira_board_dbs (board_id text primary key, db_id integer not null)");
  getSqlite().prepare("insert into jira_board_dbs (board_id, db_id) values ('jira-lage', ?)").run(legacy);
  assert.equal(jiraBoardDatabase("jira-lage"), legacy);

  const id = await replaceBriefingOnce();
  assert.ok(id && id !== legacy);
  assert.ok(w.getPage(legacy)!.archivedAt, "the old one in the trash");
  assert.equal(briefingDatabase(), id);
  const d = w.getDatabase(id!)!;
  assert.equal(d.page.title, "Meine Lage");
  assert.equal(d.page.locked, false);
  assert.equal(databaseSource(id!), null, "no sync keeps it: its pipeline does");
  const steps = d.schema.pipeline!.steps;
  const src = steps.find((s) => s.kind === "source")!;
  assert.deepEqual([src.from, src.jira?.mine, src.jira?.involved, src.jira?.openOnly, src.jira?.doneDays, src.jira?.briefed], ["jira", true, true, true, 3, undefined], "only what a pipeline can choose — not the Ticket-Lage's tickets");
  const fields = steps.filter((s) => s.kind === "ai" && s.output === "field");
  assert.equal(fields.length, 2, "attention and the Lage sentence");
  assert.ok(fields.every((s) => !s.prop), "fields of its own (not the Ticket-Lage's)");
  assert.ok(fields.some((s) => s.choices?.includes("blocked")));
  assert.ok(steps.some((s) => s.kind === "ai" && s.output === "summary"), "the overall picture");
  const { listInstructions } = await import("@/plugins/workspace/instructions");
  const lage = listInstructions().find((i) => i.title === "Lage")!.id;
  assert.ok(steps.filter((s) => s.kind === "ai").every((s) => s.instructions?.includes(lage)), "its AI steps go by the instruction Lage");
  assert.deepEqual(d.schema.review, { on: true }, "its AI review reads every row");
  assert.deepEqual(w.rawRows(id!).map((r) => r.cells.ticketkey), ["ME-1"], "its rows at once");
  assert.equal(jiraBoardHref("jira-lage"), `/workspace/${id}`, "old links lead to it");

  // The Ticket-Lage writes nothing into it; the sync doesn't make My briefing again.
  applyTicketLage([{ key: "ME-1", lead: "Von der Ticket-Lage." }]);
  assert.ok(!w.getDatabase(id!)!.schema.properties.some((p) => p.id === "lagelead"));
  await syncJiraBoardDatabases();
  assert.equal(jiraBoardDatabase("jira-lage"), null);
  assert.equal(await replaceBriefingOnce(), null, "once");
});
