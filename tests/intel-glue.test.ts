import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The increments of the intelligence program wired together: structured questions follow the data boundaries and ask the
 * timeline and the entities; the evals read the feedback ledger; the correlations and the timeline leave out what the
 * boundaries close; the timeline page says when a source it reads isn't well.
 */

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "todos", "cases", "finances", "calendar", "questions", "llm", "timeline", "entities", "correlations", "zeiterfassung", "whatsapp", "signal", "teams"]) setInstalled(p, true);
  await import("@/plugins/contributions");
}

let mailNo = 0;
async function mail(key: string, convId: string, fromName: string, preview: string, receivedAt: string) {
  const { getDb, schema } = await import("@/db");
  mailNo++;
  getDb().insert(schema.emails).values({ key, convId, syncedAt: receivedAt, folder: convId.startsWith("wa:") ? "WhatsApp" : "Posteingang", fromName, fromEmail: convId.startsWith("wa:") ? null : `${fromName.toLowerCase()}@example.com`, subject: `Betreff ${mailNo}`, preview, receivedAt } as never).run();
}

function bankTable() {
  return import("@/db").then(({ getSqlite }) =>
    getSqlite().exec("create table if not exists bank_transactions (id text primary key, account text not null, date text not null, amount real not null, currency text not null default 'EUR', text text not null default '', counterparty text not null default '', iban text not null default '', reference text not null default '', imported_at text not null, case_id integer, todo_id integer, matched_at text)"),
  );
}

// ---------------------------------------------------------------------------
// 1. Questions × boundaries
// ---------------------------------------------------------------------------

test("questions × boundaries: the bank is personal — an agent without the permission doesn't see the view, you do; secret: nobody", async () => {
  await setup();
  await bankTable();
  const { getSqlite } = await import("@/db");
  getSqlite().prepare("insert into bank_transactions (id, account, date, amount, text, counterparty, imported_at) values ('q1', 'DE1', '2026-10-01', -80, 'Farbe', 'Maler Müller GmbH', ?)").run(ago(0));
  const { withClearance, setSourceLabel } = await import("@/lib/boundaries");
  const v = await import("@/plugins/questions/views");
  const names = (c: "open" | "personal") => withClearance(c, () => v.listViews({ via: "mcp" }).map((x) => x.name));
  assert.ok(names("personal").includes("bank_transactions"));
  assert.ok(!names("open").includes("bank_transactions"), "personal by default: closed to an agent without the permission");
  assert.ok(names("open").includes("time_entries"), "work data stays open");
  await assert.rejects(withClearance("open", () => v.runQuery({ view: "bank_transactions", aggregate: "count" }, { via: "mcp" })), /Unknown view/);
  // The context may carry the clearance itself (a test, a caller that knows it).
  assert.equal(v.allowedFor("bank_transactions", { via: "test", clearance: "open" }), false);
  assert.equal(v.allowedFor("bank_transactions", { via: "test", clearance: "personal" }), true);
  setSourceLabel("bank", "secret");
  assert.ok(!names("personal").includes("bank_transactions"), "secret: not even you");
  setSourceLabel("bank", null);
});

test("questions × boundaries: messages per their source's label — WhatsApp personal, mail open; a secret source for nobody", async () => {
  await setup();
  await mail("wa:q1", "wa:Julia", "Julia", "Kommst du morgen?", "2026-09-10T10:00:00.000Z");
  await mail("q-m1", "conv-q1", "Julia", "Das Angebot", "2026-09-11T10:00:00.000Z");
  const { withClearance, setSourceLabel } = await import("@/lib/boundaries");
  const { runQuery } = await import("@/plugins/questions/views");
  const count = (c: "open" | "personal") => withClearance(c, () => runQuery({ view: "messages", aggregate: "count", filters: { from: "2026-09-10", to: "2026-09-11" } }, { via: "mcp" })).then((r) => r.rows.map((x) => x.ref).sort());
  assert.deepEqual(await count("personal"), ["mail:q-m1", "mail:wa:q1"]);
  assert.deepEqual(await count("open"), ["mail:q-m1"], "WhatsApp is personal");
  setSourceLabel("whatsapp", "secret");
  assert.deepEqual(await count("personal"), ["mail:q-m1"], "secret: not even you");
  setSourceLabel("whatsapp", null);
});

test("questions × boundaries: a Workspace database by its label — a journal is personal, a secret one is refused and not offered to the planner", async () => {
  await setup();
  const store = await import("@/plugins/workspace/store");
  const { withClearance } = await import("@/lib/boundaries");
  const { setDatabaseLabel } = await import("@/plugins/workspace/sensitivity");
  const { runQuery } = await import("@/plugins/questions/views");
  const { workspaceDatabases } = await import("@/plugins/questions/builtin-views");
  const journal = store.createPage({ title: "Tagebuch", kind: "database" });
  store.addRow(journal, { title: "Ein guter Tag" });
  const tasks = store.createPage({ title: "Einkauf", kind: "database" });
  store.addRow(tasks, { title: "Farbe" });
  const q = (db: number) => ({ view: "workspace", aggregate: "count", filters: { database: String(db) } });
  assert.equal((await runQuery(q(journal), { via: "chat" })).total.count, 1, "you see your journal");
  await assert.rejects(withClearance("open", () => runQuery(q(journal), { via: "mcp" })), /personal/);
  assert.equal((await withClearance("open", () => runQuery(q(tasks), { via: "mcp" }))).total.count, 1);
  assert.ok(!withClearance("open", () => workspaceDatabases()).some((d) => d.id === journal), "the planner of an agent doesn't see it");
  setDatabaseLabel(tasks, "secret");
  await assert.rejects(runQuery(q(tasks), { via: "chat" }), /secret/);
  assert.ok(!workspaceDatabases().some((d) => d.id === tasks), "a secret database's name never goes to the planner");
  assert.ok(workspaceDatabases().some((d) => d.id === journal));
  setDatabaseLabel(tasks, null);
});

// ---------------------------------------------------------------------------
// 2. Questions × timeline
// ---------------------------------------------------------------------------

test("questions × timeline: a timeline view — “when did I last talk to Y” by a person's name, counts per month, by kind and source", async () => {
  await setup();
  const { createPerson } = await import("@/plugins/people/store");
  const anna = createPerson({ name: "Anna Glue", aliases: ["Anni"] });
  const { recordEvent } = await import("@/plugins/timeline/store");
  recordEvent({ at: "2026-08-03T09:00:00.000Z", kind: "message", source: "teams", sourceRef: "g1", title: "Anna · Chat", refs: [`person:${anna}`] });
  recordEvent({ at: "2026-09-04T09:00:00.000Z", kind: "mail", source: "mail", sourceRef: "g2", title: "Angebot", refs: [`person:${anna}`] });
  recordEvent({ at: "2026-09-20T09:00:00.000Z", kind: "meeting", source: "calendar", sourceRef: "g3", title: "Jour fixe", refs: [`person:${anna}`] });
  recordEvent({ at: "2026-09-21T09:00:00.000Z", kind: "mail", source: "mail", sourceRef: "g4", title: "Andere", refs: ["person:999"] });
  const { listViews, runQuery } = await import("@/plugins/questions/views");
  assert.ok(listViews({ via: "chat" }).some((x) => x.name === "timeline"), "the timeline's view is offered");
  const last = await runQuery({ view: "timeline", aggregate: "last", filters: { entity: "Anni" } }, { via: "chat" });
  assert.equal(last.total.value, "2026-09-20T09:00:00.000Z");
  assert.equal(last.total.count, 3);
  const talked = await runQuery({ view: "timeline", aggregate: "last", filters: { entity: "Anna Glue", kind: ["mail", "message"] } }, { via: "chat" });
  assert.equal(talked.total.value, "2026-09-04T09:00:00.000Z", "a kind by its prefix");
  const perMonth = await runQuery({ view: "timeline", aggregate: "count", groupBy: "month", filters: { entity: `person:${anna}` } }, { via: "chat" });
  assert.deepEqual(perMonth.groups.map((g) => [g.key, g.value]), [["2026-09", 2], ["2026-08", 1]]);
  const bySource = await runQuery({ view: "timeline", aggregate: "count", groupBy: "source", filters: { from: "2026-09-01", to: "2026-09-30" } }, { via: "chat" });
  assert.equal(bySource.groups.find((g) => g.key === "mail")?.value, 2);
  await assert.rejects(runQuery({ view: "timeline", aggregate: "count", filters: { entity: "Niemand Bekanntes" } }, { via: "chat" }), /Niemand/);
});

// ---------------------------------------------------------------------------
// 3. Questions × entities
// ---------------------------------------------------------------------------

test("questions × entities: time entries by a project's name or alias (projectOf) and by an organisation; bank transactions by an organisation's counterparty names", async () => {
  await setup();
  await bankTable();
  const { getSqlite } = await import("@/db");
  const { createJob } = await import("@/lib/jobs");
  const { createEntry } = await import("@/lib/entries");
  const { createProject } = await import("@/lib/projects");
  const { createEntity, addAlias, addEntityLink, updateEntity } = await import("@/plugins/entities/store");
  createJob({ number: "EN-1", name: "Kundenportal Wartung" });
  createJob({ number: "EN-2", name: "Sonstiges" });
  const project = createProject({ title: "Kundenportal", jobNumber: "EN-1" });
  addAlias(`project:${project.id}`, "KP");
  const org = createEntity("org", "Acme Holding GmbH");
  updateEntity(`org:${org}`, { aliases: ["ACME"], domains: ["acme.example"] });
  addEntityLink(`project:${project.id}`, "org", `org:${org}`);
  createEntry({ jobNumber: "EN-1", date: "2026-07-02", hours: 3, description: "Login" }, "web");
  createEntry({ jobNumber: "EN-2", date: "2026-07-03", hours: 2, description: "Anderes" }, "web");
  const { runQuery } = await import("@/plugins/questions/views");
  const hours = (filters: Record<string, unknown>) => runQuery({ view: "time_entries", aggregate: "sum", filters: { from: "2026-07", to: "2026-07", ...filters } }, { via: "chat" }).then((r) => r.total.value);
  assert.equal(await hours({ project: "KP" }), 3, "a project's alias, through projectOf");
  assert.equal(await hours({ org: "Acme" }), 3, "an organisation: the entries of its projects");
  assert.equal(await hours({ org: "acme.example" }), 3, "by its domain");
  getSqlite().prepare("insert into bank_transactions (id, account, date, amount, text, counterparty, imported_at) values ('e1', 'DE1', '2026-07-05', -120, 'Rechnung 7', 'ACME HOLDING GMBH', ?), ('e2', 'DE1', '2026-07-06', -30, 'Brot', 'Bäckerei', ?)").run(ago(0), ago(0));
  const spent = await runQuery({ view: "bank_transactions", aggregate: "sum", measure: "abs", filters: { org: "Acme", from: "2026-07", to: "2026-07" } }, { via: "chat" });
  assert.equal(spent.total.value, 120, "the counterparty is the organisation (legal form and case ignored)");
});

// ---------------------------------------------------------------------------
// 4. Evals × ledger
// ---------------------------------------------------------------------------

test("evals × ledger: the auto-actions you removed are negatives of the golden set — one action, or all of them", async () => {
  await setup();
  const { recordFeedback } = await import("@/lib/learning/ledger");
  const { autoActionsFeedback } = await import("@/lib/learning/sources");
  const { ledgerVerdicts } = await import("@/lib/evals/ledger");
  const { applyVerdicts } = await import("@/lib/evals/golden");
  const todo = (id: number, types: string[]) => ({ id, text: `Todo ${id}`, ops: types.map((type) => ({ type })), autoOpsWhy: "weil" });
  recordFeedback(autoActionsFeedback(todo(71, ["mail", "event"]), "rejected", { type: "event" }));
  recordFeedback(autoActionsFeedback(todo(72, ["mail"]), "rejected"));
  recordFeedback(autoActionsFeedback(todo(73, ["jira"]), "accepted"));
  const src = ledgerVerdicts();
  assert.equal(src.name, "ai_feedback");
  const got = Object.fromEntries(src.verdicts("auto-actions").map((v) => [v.item, v.label]));
  assert.equal(got["todo:71:event"], "negative", "one action taken off: that action");
  assert.equal(got["todo:71"], undefined, "… not the todo");
  assert.equal(got["todo:72"], "negative", "all taken off: the todo and its actions");
  assert.equal(got["todo:72:mail"], "negative");
  assert.equal(got["todo:73"], "must");
  assert.equal(got["todo:73:jira"], "must");
  const r = applyVerdicts([{ id: "c", input: null, labels: { "todo:71": "open", "todo:71:event": "open", "todo:71:mail": "open" } }], src.verdicts("auto-actions"), "auto-actions");
  assert.deepEqual(r.cases[0].labels, { "todo:71": "open", "todo:71:event": "negative", "todo:71:mail": "open" });
  assert.deepEqual(src.verdicts("mail"), [], "the mail step's verdicts are its todos' already — none from the ledger");
});

// ---------------------------------------------------------------------------
// 6. Correlations × boundaries
// ---------------------------------------------------------------------------

test("correlations × boundaries: secret series for nobody; personal ones (a journal, WhatsApp, spending) only for you and agents allowed personal", async () => {
  await setup();
  const store = await import("@/plugins/workspace/store");
  const { newProperty } = await import("@/plugins/workspace/model");
  const { withClearance, setSourceLabel } = await import("@/lib/boundaries");
  const { setDatabaseLabel } = await import("@/plugins/workspace/sensitivity");
  const mk = (title: string) => {
    const db = store.createPage({ title, kind: "database" });
    const date = newProperty("Date", "date");
    const n = newProperty("Wert", "number");
    store.updateSchema(db, { ...store.getDatabase(db)!.schema, properties: [date, n] });
    store.addRow(db, { title: "x", cells: { [date.id]: "2026-10-01", [n.id]: 3 } });
    return db;
  };
  const journal = mk("Stimmung");
  const work = mk("Sprints");
  await mail("wa:c1", "wa:Julia", "Julia", "Hallo", "2026-10-01T10:00:00.000Z");
  const { allSeries, seriesCatalog } = await import("@/lib/series/series");
  const ids = (c: "open" | "personal") => withClearance(c, () => allSeries({ from: "2026-09-25", to: "2026-10-05" })).then((all) => all.map((s) => s.id));
  const mine = await ids("personal");
  assert.ok(mine.some((id) => id.startsWith(`db:${journal}:`)));
  assert.ok(mine.includes("messages:whatsapp:received"));
  const agent = await ids("open");
  assert.ok(!agent.some((id) => id.startsWith(`db:${journal}:`)), "a personal database");
  assert.ok(!agent.includes("messages:whatsapp:received"), "a personal source");
  assert.ok(agent.some((id) => id.startsWith(`db:${work}:`)));
  assert.ok(!withClearance("open", () => seriesCatalog()).some((s) => s.id.startsWith(`db:${journal}:`)), "nor offered as a target");
  setDatabaseLabel(work, "secret");
  setSourceLabel("whatsapp", "secret");
  const now = await ids("personal");
  assert.ok(!now.some((id) => id.startsWith(`db:${work}:`)), "a secret database: not even you");
  assert.ok(!now.includes("messages:whatsapp:received"), "a secret source: not even you");
  setDatabaseLabel(work, null);
  setSourceLabel("whatsapp", null);
});

// ---------------------------------------------------------------------------
// 7. Timeline × boundaries
// ---------------------------------------------------------------------------

test("timeline × boundaries: events of secret sources and databases are left out everywhere; personal ones only with clearance", async () => {
  await setup();
  const store = await import("@/plugins/workspace/store");
  const { withClearance, setSourceLabel } = await import("@/lib/boundaries");
  const { setDatabaseLabel } = await import("@/plugins/workspace/sensitivity");
  const { recordEvent } = await import("@/plugins/timeline/store");
  const db = store.createPage({ title: "Geheimprojekt", kind: "database" });
  const row = store.addRow(db, { title: "Zeile" });
  const who = "person:4711";
  recordEvent({ at: "2026-10-10T08:00:00.000Z", kind: "mail", source: "mail", sourceRef: "b1", title: "Mail", refs: [who] });
  recordEvent({ at: "2026-10-10T09:00:00.000Z", kind: "message", source: "whatsapp", sourceRef: "wa:b2", title: "Chat", refs: [who] });
  recordEvent({ at: "2026-10-10T10:00:00.000Z", kind: "row.added", source: "workspace", sourceRef: `row:${row}:added`, title: "Zeile", url: `/workspace/${row}`, refs: [`page:${row}`, who] });
  recordEvent({ at: "2026-10-10T11:00:00.000Z", kind: "payment", source: "bank", sourceRef: "b4", title: "50 EUR", refs: [who] });
  const { timelineFor, timelineSince, timelineAll } = await import("@/plugins/timeline/query");
  const forKinds = (c: "open" | "personal") => {
    const r = withClearance(c, () => timelineFor({ ref: who }));
    return r.ok ? r.events.map((e) => e.kind) : [];
  };
  assert.deepEqual(forKinds("personal"), ["payment", "row.added", "message", "mail"]);
  assert.deepEqual(forKinds("open"), ["row.added", "mail"], "WhatsApp and the bank are personal");
  setDatabaseLabel(db, "secret");
  setSourceLabel("mail", "secret");
  assert.deepEqual(forKinds("personal"), ["payment", "message"], "a secret database's rows and a secret source: not even you");
  const since = timelineSince({ since: "2026-10-01" });
  assert.ok(since.ok && since.groups.every((g) => g.events.every((e) => e.source !== "mail" && e.kind !== "row.added")));
  assert.equal(since.ok && since.groups.find((g) => g.ref === who)?.count, 2, "counted without them");
  const all = timelineAll({ since: "2026-10-01" });
  assert.ok(all.every((e) => e.source !== "mail" && e.kind !== "row.added"));
  setDatabaseLabel(db, null);
  setSourceLabel("mail", null);
});

// ---------------------------------------------------------------------------
// 8. Source health × timeline
// ---------------------------------------------------------------------------

test("source health × timeline: one line naming the sources the timeline reads that aren't well — nothing when all are", async () => {
  const { timelineHealthNote } = await import("@/plugins/timeline/health-note");
  const h = (key: string, label: string, state: string) => ({ key, label, state }) as never;
  const health = [h("whatsapp", "WhatsApp", "silent"), h("jira", "Jira", "failing"), h("news", "News", "stale"), h("teams", "Teams", "ok")];
  const line = timelineHealthNote(health, ["whatsapp", "jira", "teams", "mail"]);
  assert.ok(line);
  assert.match(line!, /WhatsApp/);
  assert.match(line!, /Jira/);
  assert.doesNotMatch(line!, /News/, "a source the timeline doesn't read");
  assert.doesNotMatch(line!, /Teams/, "a well one");
  assert.equal(timelineHealthNote([h("teams", "Teams", "ok")], ["teams"]), null);
  assert.match(timelineHealthNote([h("gcalendar", "Google Calendar", "stale")], ["calendar"]) ?? "", /Google Calendar/, "a source by any of its sync steps");
});
