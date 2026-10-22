import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const now = () => new Date().toISOString();

async function install(...ids: string[]) {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ids) setInstalled(id, true);
}

/** A database under a page (its parent), with rows; its id. */
async function database(title: string, rows: { title: string; text?: string }[], parentTitle?: string): Promise<number> {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const d = await import("@/plugins/workspace/doc");
  const parentId = parentTitle ? w.createPage({ title: parentTitle }) : null;
  const dbId = w.createPage({ kind: "database", title, parentId, schema: { titleName: "Name", properties: [], views: [m.newView("Table")] } });
  for (const r of rows) {
    const id = w.addRow(dbId, { title: r.title });
    if (r.text) w.updatePage(id, { content: d.markdownToDoc(r.text) });
  }
  return dbId;
}

// ---------------------------------------------------------------------------
// The labels and what they let through (pure)
// ---------------------------------------------------------------------------

test("labels: open < personal < secret; a clearance lets open through, personal only when it is personal, secret never", async () => {
  const b = await import("@/lib/boundaries/shared");
  assert.deepEqual([...b.LABELS], ["open", "personal", "secret"]);
  assert.equal(b.maxLabel("open", "personal"), "personal");
  assert.equal(b.maxLabel("secret", "open"), "secret");
  assert.equal(b.allows("open", "open"), true);
  assert.equal(b.allows("open", "personal"), false);
  assert.equal(b.allows("personal", "personal"), true);
  assert.equal(b.allows("personal", "secret"), false);
});

test("the sources' defaults: work open, WhatsApp, Signal and the bank personal, nothing secret", async () => {
  const b = await import("@/lib/boundaries/shared");
  const def = Object.fromEntries(b.BOUNDARY_SOURCES.map((s) => [s.key, s.default]));
  for (const k of ["jira", "teams", "mail", "gitlab", "todos", "time"]) assert.equal(def[k], "open", k);
  for (const k of ["whatsapp", "signal", "bank"]) assert.equal(def[k], "personal", k);
  assert.ok(!Object.values(def).includes("secret"));
});

test("a knowledge page's and a reference's source", async () => {
  const b = await import("@/lib/boundaries/shared");
  assert.equal(b.docSourceKey("zeff:jira:AB-1"), "jira");
  assert.equal(b.docSourceKey("zeff:mail:wa:4917@c.us:2026-10"), "whatsapp");
  assert.equal(b.docSourceKey("zeff:mail:sg:abc"), "signal");
  assert.equal(b.docSourceKey("zeff:mail:gmail:123"), "gmail");
  assert.equal(b.docSourceKey("zeff:mail:AAMk"), "mail");
  assert.equal(b.docSourceKey("zeff:bank:giro:2026-10"), "bank");
  assert.equal(b.docSourceKey("zeff:branchctx:3"), "todos");
  assert.equal(b.docSourceKey("page:12"), null, "a row: its database's label");
  assert.equal(b.refSourceKey("mail:wa:4917@c.us:1"), "whatsapp");
  assert.equal(b.refSourceKey("mail:m1"), "mail");
  assert.equal(b.refSourceKey("teams:t1"), "teams");
  assert.equal(b.refSourceKey("jira-comment:j1"), "jira");
  assert.equal(b.refSourceKey("RG-1"), "jira");
  assert.equal(b.refSourceKey("T-12"), "todos");
  assert.equal(b.refSourceKey("context:3"), "notes");
  assert.equal(b.refSourceKey("person:4"), "people");
  // The shared entity refs (structured questions, the timeline).
  assert.equal(b.refSourceKey("msg:whatsapp:k1"), "whatsapp");
  assert.equal(b.refSourceKey("msg:teams:k1"), "teams");
  assert.equal(b.refSourceKey("entry:12"), "time");
  assert.equal(b.refSourceKey("tx:abc"), "bank");
  assert.equal(b.refSourceKey("todo:3"), "todos");
  assert.equal(b.refSourceKey("ticket:PROJ-1"), "jira");
});

test("the matrix: what flows into each exit for a label (and a database's own switches)", async () => {
  const b = await import("@/lib/boundaries/shared");
  assert.deepEqual(b.EXITS.map((e) => b.flowOf("open", e)), ["yes", "yes", "yes", "yes", "yes"]);
  assert.deepEqual(b.EXITS.map((e) => b.flowOf("personal", e)), ["yes", "yes", "permission", "yes", "permission"]);
  assert.deepEqual(b.EXITS.map((e) => b.flowOf("secret", e)), ["no", "no", "no", "no", "no"]);
  assert.equal(b.flowOf("open", "knowledge", { knowledge: false }), "off");
  assert.equal(b.flowOf("open", "briefing", { briefing: false }), "off");
  assert.equal(b.flowOf("secret", "knowledge", { knowledge: true }), "no", "secret beats the switch");
});

test("redact: the secret lines are left out of a text — whole, or cut short when a prompt clipped them", async () => {
  const b = await import("@/lib/boundaries/shared");
  const secret = ["Mein Befund vom Arzt: Blutwerte auffällig, Kontrolle in drei Wochen", "kurz"];
  const out = b.redact("Kontext:\n- Mein Befund vom Arzt: Blutwerte auffällig, Kontrolle in drei Wochen\n- Ticket AB-1 offen", secret);
  assert.ok(!out.includes("Blutwerte"));
  assert.match(out, /ausgelassen/);
  assert.match(out, /Ticket AB-1 offen/);
  const clipped = b.redact("Auszug: Mein Befund vom Arzt: Blutwerte auffällig, Kontr… weiter", secret);
  assert.ok(!clipped.includes("Blutwerte"), "a clipped secret line is left out too");
  assert.equal(b.redact("nothing to hide here at all", secret), "nothing to hide here at all");
  assert.equal(b.redact("kurz und gut", secret), "kurz und gut", "too short to tell: kept");
});

// ---------------------------------------------------------------------------
// The labels as kept
// ---------------------------------------------------------------------------

test("a source's label: its default until set, back to it when cleared", async () => {
  const { sourceLabel, setSourceLabel } = await import("@/lib/boundaries");
  assert.equal(sourceLabel("jira"), "open");
  assert.equal(sourceLabel("whatsapp"), "personal");
  setSourceLabel("jira", "secret");
  assert.equal(sourceLabel("jira"), "secret");
  setSourceLabel("jira", null);
  assert.equal(sourceLabel("jira"), "open");
  assert.equal(sourceLabel("unknown-thing"), "open");
});

test("a database's label: journal-like ones (by their name or a parent's) personal by default; set and cleared; a row and what is under it carry it", async () => {
  await install("workspace");
  const s = await import("@/plugins/workspace/sensitivity");
  const w = await import("@/plugins/workspace/store");
  const recipes = await database("Rezepte", [{ title: "Pfannkuchen" }]);
  const entries = await database("Einträge", [{ title: "Montag" }], "📓 Journal");
  const health = await database("Gesundheit", []);
  assert.equal(s.databaseLabel(recipes), "open");
  assert.equal(s.databaseLabel(entries), "personal", "under a journal");
  assert.equal(s.databaseLabel(health), "personal");
  s.setDatabaseLabel(recipes, "secret");
  assert.equal(s.databaseLabel(recipes), "secret");
  const row = w.rawRows(recipes)[0].id;
  assert.equal(s.pageLabel(row), "secret", "a row: its database's");
  const sub = w.createPage({ title: "Notiz", parentId: row });
  assert.equal(s.pageLabel(sub), "secret", "a page under the row too");
  assert.equal(s.pageLabel(w.createPage({ title: "Lose" })), "open");
  s.setDatabaseLabel(recipes, null);
  assert.equal(s.databaseLabel(recipes), "open");
  s.setDatabaseLabel(entries, "open");
  assert.equal(s.databaseLabel(entries), "open", "a journal set open stays open");
});

// ---------------------------------------------------------------------------
// The exits
// ---------------------------------------------------------------------------

test("collections carry their label; a secret one is in neither the briefing nor the knowledge, whatever its switches", async () => {
  await install("workspace");
  const { listCollections, setCollection } = await import("@/lib/items");
  const s = await import("@/plugins/workspace/sensitivity");
  const dbId = await database("Ideen", [{ title: "Idee" }]);
  setCollection(`workspace:${dbId}`, { briefing: true, knowledge: true });
  const c = () => listCollections().find((x) => x.id === `workspace:${dbId}`)!;
  assert.equal(c().sensitivity, "open");
  assert.equal(c().briefing, true);
  s.setDatabaseLabel(dbId, "secret");
  assert.equal(c().sensitivity, "secret");
  assert.equal(c().briefing, false);
  assert.equal(c().knowledge, false);
  assert.ok(!listCollections({ briefing: true }).some((x) => x.id === `workspace:${dbId}`), "the briefing doesn't read it");
  s.setDatabaseLabel(dbId, null);
  assert.equal(c().briefing, true, "its switches come back with its label");
});

test("knowledge export: a secret source and a secret database are left out — picked or not — and not offered in the catalog", async () => {
  await install("knowledge", "workspace", "todos", "teams");
  const { getDb, schema } = await import("@/db");
  const { setCollection } = await import("@/lib/items");
  const { setSourceLabel } = await import("@/lib/boundaries");
  const s = await import("@/plugins/workspace/sensitivity");
  const { knowledgeCatalog, knowledgeDocs } = await import("@/plugins/knowledge/export");
  getDb().insert(schema.jiraTickets).values({ key: "SB-1", summary: "Geheimprojekt", status: "Offen", statusCategory: "todo", updatedAt: now() }).run();
  const dbId = await database("Tagebuch geheim", [{ title: "Eintrag eins", text: "Was ich niemandem sage" }]);
  setCollection(`workspace:${dbId}`, { knowledge: true });
  assert.ok(knowledgeDocs("http://zeff").docs.some((d) => d.title === "Eintrag eins"), "personal: in, by its switch");
  s.setDatabaseLabel(dbId, "secret");
  setSourceLabel("jira", "secret");
  const all = knowledgeDocs("http://zeff").docs;
  assert.ok(!all.some((d) => d.title === "Eintrag eins"));
  assert.ok(!all.some((d) => d.id === "zeff:jira:SB-1"));
  const picked = knowledgeDocs("http://zeff", undefined, ["space:Zeff · Jira", `workspace:${dbId}`]).docs;
  assert.deepEqual(picked, [], "picked by the knowledge server: still out");
  const cat = knowledgeCatalog();
  assert.ok(!cat.some((c) => c.id === `workspace:${dbId}`));
  assert.ok(!cat.some((c) => c.id === "space:Zeff · Jira"));
  setSourceLabel("jira", null);
  s.setDatabaseLabel(dbId, null);
});

test("retrieval (search_context, the AI's lookups): secret never; personal only with a personal clearance", async () => {
  await install("workspace");
  const { getDb, schema } = await import("@/db");
  const { withClearance, setSourceLabel } = await import("@/lib/boundaries");
  const { retrieve } = await import("@/lib/rag");
  getDb().insert(schema.emails).values({ key: "wa:49171@c.us:1", convId: "wa:49171@c.us", subject: "Oma", preview: "Grillfest Samstag bei Oma im Garten", receivedAt: now(), syncedAt: now(), fromName: "Tante" } as never).run();
  getDb().insert(schema.emails).values({ key: "outlook1", convId: "o1", subject: "Grillfest Team", preview: "Grillfest Samstag mit dem Team", receivedAt: now(), syncedAt: now(), fromName: "Chef" } as never).run();
  const refs = async () => (await retrieve([{ query: "Grillfest Samstag", where: ["mails"] }], { knowledge: async () => [] })).hits.map((h) => h.ref).sort();
  assert.deepEqual(await refs(), ["mail:outlook1", "mail:wa:49171@c.us:1"], "outside an agent: personal is read");
  assert.deepEqual(await withClearance("open", refs), ["mail:outlook1"], "an agent without personal data");
  assert.deepEqual(await withClearance("personal", refs), ["mail:outlook1", "mail:wa:49171@c.us:1"]);
  setSourceLabel("mail", "secret");
  assert.deepEqual(await withClearance("personal", refs), ["mail:wa:49171@c.us:1"], "secret: never");
  setSourceLabel("mail", null);
});

test("the AI exit: a prompt has the secret database's rows and a secret source's texts left out; nothing secret — unchanged", async () => {
  await install("workspace");
  const { getDb, schema } = await import("@/db");
  const { guardPrompt, setSourceLabel } = await import("@/lib/boundaries");
  const s = await import("@/plugins/workspace/sensitivity");
  const dbId = await database("Befunde", [{ title: "Befund Oktober Blutbild", text: "Leberwerte erhöht, in drei Wochen wieder messen" }]);
  const prompt = "Fasse zusammen:\n- Befund Oktober Blutbild: Leberwerte erhöht, in drei Wochen wieder messen\n- Sprint-Review am Freitag um 10 Uhr";
  assert.equal(guardPrompt(prompt), prompt, "nothing secret: as it was");
  s.setDatabaseLabel(dbId, "secret");
  const out = guardPrompt(prompt);
  assert.ok(!out.includes("Leberwerte"));
  assert.ok(!out.includes("Befund Oktober Blutbild"));
  assert.match(out, /Sprint-Review am Freitag/);
  s.setDatabaseLabel(dbId, null);
  getDb().insert(schema.emails).values({ key: "sg:abc:1", convId: "sg:abc", subject: "Anna", preview: "Die Überraschungsparty ist am 3. November", receivedAt: now(), syncedAt: now(), fromName: "Anna" } as never).run();
  const chat = "Nachrichten:\n- Anna: Die Überraschungsparty ist am 3. November";
  assert.equal(guardPrompt(chat), chat);
  setSourceLabel("signal", "secret");
  assert.ok(!guardPrompt(chat).includes("Überraschungsparty"));
  setSourceLabel("signal", null);
});

test("the settings' matrix: the installed plugins' sources and every database, each with its label and what flows where", async () => {
  await install("workspace", "jira", "whatsapp");
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("signal", false);
  const { boundaryMatrix, setSourceLabel } = await import("@/lib/boundaries");
  const { setCollection } = await import("@/lib/items");
  const dbId = await database("Leseliste", []);
  setCollection(`workspace:${dbId}`, { briefing: false });
  const rows = await boundaryMatrix();
  const jira = rows.find((r) => r.kind === "source" && r.key === "jira")!;
  assert.deepEqual(jira.flows, { knowledge: "yes", briefing: "yes", agents: "yes", ai: "yes", web: "yes" });
  assert.equal(jira.own, false);
  const wa = rows.find((r) => r.key === "whatsapp")!;
  assert.equal(wa.label, "personal");
  assert.equal(wa.flows.agents, "permission");
  assert.ok(!rows.some((r) => r.key === "signal"), "a plugin not installed: not listed");
  const db = rows.find((r) => r.kind === "database" && r.key === String(dbId))!;
  assert.equal(db.flows.briefing, "off");
  setSourceLabel("jira", "secret");
  const after = (await boundaryMatrix()).find((r) => r.key === "jira")!;
  assert.equal(after.own, true);
  assert.equal(after.flows.ai, "no");
  setSourceLabel("jira", null);
});
