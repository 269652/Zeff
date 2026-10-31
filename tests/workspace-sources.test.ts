import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
delete process.env.JIRA_URL;

/** The Workspace's data sources (Jira, Google Keep): what they bring, which databases they keep, switched on here. */
test("sourcesOverview: Jira's boards with their switch and database, Google Keep with its database", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "jira-lage", "keep"]) setInstalled(id, true);
  const { getDb, schema } = await import("@/db");
  const g = await import("@/plugins/keep/store");
  const { sourcesOverview } = await import("@/plugins/workspace/sources");
  (await import("@/plugins/workspace/store")).tree(); // (the Workspace's tables there, as in the app)
  const { syncJiraBoardDatabases } = await import("@/plugins/jira-lage/to-workspace");
  const { syncGoogleKeepDatabase } = await import("@/plugins/keep/google-workspace");
  getDb().insert(schema.jiraBoards).values([{ id: 11, name: "Support", projectKey: "PROJ", enabled: true }, { id: 12, name: "Relaunch", projectKey: "PROJ", enabled: false }]).run();

  let o = sourcesOverview();
  const jira = () => o.find((s) => s.key === "jira")!;
  assert.deepEqual(jira().boards!.map((b) => [b.name, b.enabled, b.href]), [["Support", true, null], ["Relaunch", false, null]], "no database yet");
  await syncJiraBoardDatabases();
  o = sourcesOverview();
  assert.match(jira().boards!.find((b) => b.name === "Support")!.href ?? "", /^\/workspace\/\d+$/, "its database once kept");
  assert.equal(jira().boards!.find((b) => b.name === "Relaunch")!.href, null, "a board switched off has none");

  g.saveKeepNotes([{ id: "k1", kind: "note", title: "N", text: "x", labels: [], color: null, pinned: false, archived: false, createdAt: null, updatedAt: null, url: "" }], true);
  syncGoogleKeepDatabase();
  o = sourcesOverview();
  const keep = o.find((s) => s.key === "keep")!;
  assert.equal(keep.count, 1);
  assert.match(keep.databases[0].href, /^\/workspace\/\d+$/);
  assert.equal(keep.databases[0].title, "Google Keep");

  setInstalled("keep", false);
  assert.ok(!sourcesOverview().some((s) => s.key === "keep"), "a source whose plugin is off isn't offered");
});
