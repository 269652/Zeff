import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The knowledge server picks what it reads from Zeff: the export's catalog lists every source (its space: Jira, Teams,
 * Mail …, with how many pages) and every database of the Workspace; given a pick (include), the export has only those —
 * any database, whatever its old "in the knowledge" switch says. Without a pick: as before.
 */
test("knowledgeCatalog and include: the sources and databases there are, the export of the ones picked", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["knowledge", "workspace", "todos", "teams"]) setInstalled(id, true);
  const { getDb, schema } = await import("@/db");
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { saveTeamsMessages } = await import("@/lib/teams/store");
  const { knowledgeCatalog, knowledgeDocs } = await import("@/plugins/knowledge/export");
  getDb().insert(schema.jiraTickets).values({ key: "KN-1", summary: "Wissen", status: "Offen", statusCategory: "todo", updatedAt: new Date().toISOString() }).run();
  saveTeamsMessages([{ key: "19:k|m1", kind: "chat", mentionType: null, conversationId: "19:k", replyChainId: null, messageId: "m1", place: "Chat", senderName: "A", senderId: "a", sentAt: Date.now(), subject: null, html: "<p>Hallo</p>", text: "Hallo", link: "", isRead: null }]);
  const dbId = w.createPage({ kind: "database", title: "Rezepte", schema: { titleName: "Name", properties: [], views: [m.newView("Table")] } });
  w.addRow(dbId, { title: "Pfannkuchen" });

  const cat = knowledgeCatalog();
  const jira = cat.find((c) => c.id === "space:Zeff · Jira");
  assert.equal(jira?.count, 1);
  assert.equal(jira?.kind, "source");
  assert.ok(cat.some((c) => c.id === "space:Zeff · Teams"));
  const rez = cat.find((c) => c.id === `workspace:${dbId}`);
  assert.equal(rez?.kind, "database");
  assert.equal(rez?.name, "Rezepte");
  assert.equal(rez?.selected, false, "not in the knowledge by its old switch");

  const all = knowledgeDocs("http://zeff").docs;
  assert.ok(all.some((d) => d.id === "zeff:jira:KN-1"));
  assert.ok(!all.some((d) => d.title === "Pfannkuchen"), "without a pick: as before (the switch)");
  const picked = knowledgeDocs("http://zeff", undefined, ["space:Zeff · Jira", `workspace:${dbId}`]).docs;
  assert.ok(picked.some((d) => d.id === "zeff:jira:KN-1"));
  assert.ok(picked.some((d) => d.title === "Pfannkuchen"), "a database picked: in, whatever its switch");
  assert.ok(!picked.some((d) => d.space === "Zeff · Teams"), "Teams not picked: out");
});
