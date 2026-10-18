import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * A Jira source that asks for "mine" (Meine Lage) means mine on the boards you selected: tickets assigned to you in a project whose boards
 * are all deselected don't come along (the sync reads "assigned to me" across every project). What you follow on purpose still does.
 */
test("jira source: 'mine' is limited to the selected boards once any is selected; followed tickets stay", async () => {
  const { getDb, schema } = await import("@/db");
  const { jiraRecords } = await import("@/plugins/workspace/pipeline");
  const db = getDb();
  const ticket = (key: string, extra: Record<string, unknown> = {}) =>
    db.insert(schema.jiraTickets).values({ key, summary: key, status: "In Arbeit", statusCategory: "inprogress", mine: true, updatedAt: new Date().toISOString(), ...extra } as never).run();
  db.insert(schema.jiraBoards).values({ id: 1, name: "PROJ Support", enabled: true } as never).run();
  db.insert(schema.jiraBoards).values({ id: 2, name: "Disney", enabled: false } as never).run();
  ticket("PROJ-1", { boardId: 1 });
  ticket("DISNEY-1"); // assigned to you, on no selected board
  ticket("DISNEY-2", { followed: 1 }); // followed on purpose
  const keys = async (c: object) => (await jiraRecords(c as never)).map((r) => r.key).sort();
  assert.deepEqual(await keys({ mine: true }), ["PROJ-1"]);
  assert.deepEqual(await keys({ mine: true, involved: true }), ["PROJ-1", "DISNEY-2"], "followed tickets stay");

  // No board selected at all: nothing to limit by — mine is mine.
  db.update(schema.jiraBoards).set({ enabled: false }).run();
  assert.deepEqual(await keys({ mine: true }), ["PROJ-1", "DISNEY-1", "DISNEY-2"]);
});
