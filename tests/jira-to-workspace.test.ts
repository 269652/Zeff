import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
delete process.env.JIRA_URL; // no Jira here: the columns are the status categories

/**
 * Jira as a data source: each Jira board (and "My briefing") is a Workspace board database the sync
 * keeps — its tickets rows with their key (PROJ-…), their column the status, type, priority, assignee,
 * the link to Jira. Read-only (Jira is where they change), marked as Jira's (no Lage tickets of its
 * own: the tickets come into the Lage from Jira already).
 */
test("syncJiraBoardDatabases: a Jira board becomes a read-only board database, kept by each sync", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["jira-lage", "workspace"]) setInstalled(id, true);
  const { getDb, schema } = await import("@/db");
  const w = await import("@/plugins/workspace/store");
  const c = await import("@/lib/items");
  const { boardLageTickets } = await import("@/lib/items/tickets");
  const { syncJiraBoardDatabases, jiraBoardDatabase } = await import("@/plugins/jira-lage/to-workspace");
  const db = getDb();
  db.insert(schema.jiraBoards).values({ id: 3359, name: "PROJ Board", projectKey: "PROJ", enabled: true }).run();
  const now = new Date().toISOString();
  const ticket = (key: string, status: string, statusCategory: "todo" | "inprogress" | "done", extra: Record<string, unknown> = {}) =>
    db.insert(schema.jiraTickets).values({ key, summary: `Summary ${key}`, status, statusCategory, issueType: "Bug", priority: "High", assignee: "Anna Berg", url: `https://jira.example/browse/${key}`, boardId: 3359, updatedAt: now, ...extra }).run();
  ticket("PROJ-1", "Offen", "todo");
  ticket("PROJ-2", "In Arbeit", "inprogress", { assignee: "Unassigned" });
  ticket("PROJ-3", "Fertig", "done", { resolvedAt: now });
  ticket("PROJ-4", "Fertig", "done", { resolvedAt: "2020-01-01T00:00:00Z" });

  const r = await syncJiraBoardDatabases();
  assert.equal(r.boards, 1, "the board (My briefing isn't one any more: Meine Lage is a pipeline database)");
  const dbId = jiraBoardDatabase("jira-3359")!;
  const d = w.getDatabase(dbId)!;
  assert.equal(d.page.title, "PROJ Board");
  assert.equal(d.page.locked, true, "read-only: Jira is where it changes");
  assert.equal(d.page.fullWidth, true);
  const prop = (name: string) => d.schema.properties.find((p) => p.name === name)!;
  assert.deepEqual(prop("Status").options!.map((o) => [o.name, o.group]), [["To do", "todo"], ["In progress", "doing"], ["Done", "done"]]);
  assert.equal(prop("Key").id, "ticketkey");
  assert.equal(d.schema.views[0].type, "board");

  const rows = () => w.rawRows(dbId);
  assert.deepEqual(rows().map((x) => x.cells.ticketkey).sort(), ["PROJ-1", "PROJ-2", "PROJ-3"], "done long ago: not on the board");
  const row = (k: string) => rows().find((x) => x.cells.ticketkey === k)!;
  assert.equal(row("PROJ-1").title, "Summary PROJ-1");
  assert.equal(row("PROJ-1").cells[prop("Status").id], prop("Status").options![0].id);
  assert.equal(row("PROJ-1").cells[prop("Assignee").id], "Anna Berg");
  assert.equal(row("PROJ-2").cells[prop("Assignee").id], undefined, "Jira's Unassigned is nobody");
  assert.equal(row("PROJ-1").cells[prop("Jira").id], "https://jira.example/browse/PROJ-1");
  assert.equal(prop("Type").options!.find((o) => o.id === row("PROJ-1").cells[prop("Type").id])?.name, "Bug");

  const col = c.listCollections().find((x) => x.id === `workspace:${dbId}`)!;
  assert.equal(col.kind, "board");
  assert.equal(col.source, "jira");
  assert.equal(col.readOnly, true);
  assert.equal(col.briefing, false);
  c.setCollection(col.id, { briefing: true });
  assert.ok(!boardLageTickets().some((x) => x.issue.key.startsWith("PROJ-")), "Jira's tickets come into the Lage from Jira, not again from its database");
  assert.equal(c.itemsByKeys(["PROJ-1"]).get("PROJ-1")?.title, "Summary PROJ-1", "found by its key");
  const a = await import("@/plugins/workspace/actions");
  const loaded = await a.loadDatabaseAction(dbId);
  assert.ok(loaded.ok && loaded.data.locked, "the view gets it as locked: no drag, no edits");

  // The next sync: a status changed, a ticket left the board, a new one came.
  db.update(schema.jiraTickets).set({ status: "In Arbeit", statusCategory: "inprogress", summary: "Renamed" }).where((await import("drizzle-orm")).eq(schema.jiraTickets.key, "PROJ-1")).run();
  db.update(schema.jiraTickets).set({ boardId: 1 }).where((await import("drizzle-orm")).eq(schema.jiraTickets.key, "PROJ-2")).run();
  ticket("PROJ-5", "Offen", "todo");
  const again = await syncJiraBoardDatabases();
  assert.equal(jiraBoardDatabase("jira-3359"), dbId, "the same database");
  assert.deepEqual(rows().map((x) => x.cells.ticketkey).sort(), ["PROJ-1", "PROJ-3", "PROJ-5"]);
  assert.equal(row("PROJ-1").title, "Renamed");
  assert.equal(row("PROJ-1").cells[prop("Status").id], prop("Status").options![1].id);
  assert.ok(again.archived >= 1);
  const quiet = await syncJiraBoardDatabases();
  assert.equal(quiet.updated + quiet.created + quiet.archived, 0, "nothing changed: nothing written");
});
