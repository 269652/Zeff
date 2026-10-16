import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * People as a Workspace database: the People plugin contributes a source ("people") to the pipelines — one row per person — and
 * the profiles stay where everything else (mentions, dates, reminders, Jira accounts, the normalizer) reads them: the rows
 * are a two-way view of them. A join step brings a person's fields onto mails, tickets, anything naming them.
 */
test("the people source: a row per person, its fields; the type people", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people"]) setInstalled(id, true);
  const p = await import("@/plugins/people/store");
  const w = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
  const anna = p.createPerson({ name: "Anna Berg", aliases: ["Annchen"], emails: ["anna@example.com", "a.berg@work.example"], whatsapp: "Anna WA", note: "Kennt die Buchhaltung." });
  p.addAccount(anna, "jira", "aberg");
  p.addDate(anna, { kind: "birthday", day: 3, month: 5, year: 1990 });
  p.createPerson({ name: "Ben Bauer" });

  const id = await createExtSourceDatabase("people");
  const r = await runPipeline(id, { ai: false });
  assert.equal(r.ok, true, r.error);
  const d = w.getDatabase(id)!;
  assert.equal(d.schema.dataType, "people");
  const rows = w.rawRows(id);
  assert.deepEqual(rows.map((x) => x.title).sort(), ["Anna Berg", "Ben Bauer"]);
  const col = (name: string) => d.schema.properties.find((q) => q.name === name)!.id;
  const row = rows.find((x) => x.title === "Anna Berg")!;
  assert.equal(row.cells[col("Aliases")], "Annchen");
  assert.equal(row.cells[col("Emails")], "anna@example.com, a.berg@work.example");
  assert.equal(row.cells[col("Chat")], "Anna WA");
  assert.equal(row.cells[col("Jira")], "aberg");
  assert.equal(row.cells[col("Note")], "Kennt die Buchhaltung.");
  assert.equal(row.cells[col("Starred")] ?? false, false);
  assert.ok(String(row.cells[col("Next date")] ?? "").endsWith("-05-03"), "the next birthday");
});

test("two ways: an edit in the database goes to the profile; a change in the profile wins over an older row; a new row is a new person", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people"]) setInstalled(id, true);
  const p = await import("@/plugins/people/store");
  const w = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
  const cora = p.createPerson({ name: "Cora Zwei", note: "alt" });
  const id = await createExtSourceDatabase("people");
  await runPipeline(id, { ai: false });
  const d = w.getDatabase(id)!;
  const col = (name: string) => d.schema.properties.find((q) => q.name === name)!.id;
  const rowOf = (title: string) => w.rawRows(id).find((x) => x.title === title)!;

  w.setCell(rowOf("Cora Zwei").id, col("Note"), "neu im Workspace");
  w.setCell(rowOf("Cora Zwei").id, col("Starred"), true);
  w.setCell(rowOf("Cora Zwei").id, col("Emails"), "cora@example.com; c.zwei@example.org");
  await runPipeline(id, { ai: false });
  const got = p.getPerson(cora)!;
  assert.equal(got.note, "neu im Workspace", "the profile follows");
  assert.equal(got.starred, true);
  assert.deepEqual(got.emails, ["cora@example.com", "c.zwei@example.org"]);

  p.updatePerson(cora, { note: "geändert in der App" });
  await runPipeline(id, { ai: false });
  assert.equal(p.getPerson(cora)!.note, "geändert in der App", "the profile's newer change is not overwritten by the older row");
  assert.equal(rowOf("Cora Zwei").cells[col("Note")], "geändert in der App", "the row follows");

  w.addRow(id, { title: "Dora Neu" });
  await runPipeline(id, { ai: false });
  const dora = p.listPeople().find((x) => x.name === "Dora Neu");
  assert.ok(dora, "a new row is a new person");
  assert.equal(rowOf("Dora Neu").cells.srcref, `person:${dora!.id}`, "and the row is theirs from then on");
});

test("join with people: a mail's sender finds the profile by name, alias or address — its fields come onto the mail", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people", "outlook-mail", "mail-client"]) setInstalled(id, true);
  const p = await import("@/plugins/people/store");
  const w = await import("@/plugins/workspace/store");
  const { saveMails } = await import("@/lib/mail/store");
  const { runPipeline, previewJoin } = await import("@/plugins/workspace/pipeline");
  const { createExtSourceDatabase, createSourceDatabase } = await import("@/plugins/workspace/derived");
  const eva = p.createPerson({ name: "Eva Fünf", aliases: ["Evi"], emails: ["eva@five.example"], whatsapp: "Eva WA" });
  void eva;
  const people = await createExtSourceDatabase("people");
  await runPipeline(people, { ai: false });
  saveMails([
    { convId: "P1", folder: "Posteingang", from: "E. Fünf", fromEmail: "eva@five.example", subject: "Per Adresse", preview: "…", receivedAt: new Date().toISOString(), unread: true },
    { convId: "P2", folder: "Posteingang", from: "Evi", fromEmail: "x@y.example", subject: "Per Alias", preview: "…", receivedAt: new Date().toISOString(), unread: true },
    { convId: "P3", folder: "Posteingang", from: "Niemand", fromEmail: "nobody@y.example", subject: "Ohne", preview: "…", receivedAt: new Date().toISOString(), unread: true },
  ]);
  const mail = createSourceDatabase("mail");
  await runPipeline(mail, { ai: false });
  const steps = [w.getDatabase(mail)!.schema.pipeline!.steps[0], { id: "j", kind: "join", dbId: people, on: "From", bring: ["Chat"] } as never];
  assert.deepEqual((await previewJoin(mail, steps, "j")).filter((x) => x.matched).map((x) => x.title).sort(), ["Per Adresse", "Per Alias"], "by the defaults of a people database: name, aliases, emails");
  w.updateSchema(mail, { ...w.getDatabase(mail)!.schema, pipeline: { steps } });
  await runPipeline(mail, { ai: false });
  const d = w.getDatabase(mail)!;
  const chat = d.schema.properties.find((q) => q.name === "Chat")!;
  assert.equal(w.rawRows(mail).find((r) => r.title === "Per Adresse")!.cells[chat.id], "Eva WA");
});

test("the profiles stay what the app reads: dates, accounts, mentions work as before", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people"]) setInstalled(id, true);
  const p = await import("@/plugins/people/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
  const gus = p.createPerson({ name: "Gus Sechs" });
  p.addAccount(gus, "jira", "gsechs");
  const id = await createExtSourceDatabase("people");
  await runPipeline(id, { ai: false });
  assert.equal(p.personByAccount("jira", "gsechs")?.id, gus);
  assert.equal(p.listPeople().filter((x) => x.name === "Gus Sechs").length, 1, "no second profile made by the sync");
  await runPipeline(id, { ai: false });
  assert.equal(p.listPeople().filter((x) => x.name === "Gus Sechs").length, 1);
});

test("ensurePeopleDatabase: made once with the People plugin — and left alone when you remove it", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const { ensurePeopleDatabase, peopleDatabase } = await import("@/plugins/workspace/people-database");
  await ensurePeopleDatabase();
  const id = peopleDatabase();
  assert.ok(id, "a people database");
  assert.equal(w.getDatabase(id!)!.schema.dataType, "people");
  const n = w.tree().length;
  await ensurePeopleDatabase();
  assert.equal(w.tree().length, n, "once");
  w.archivePage(id!);
  await ensurePeopleDatabase();
  assert.equal(peopleDatabase(), null, "a removed one is not made again");
});

test("the people database: pages that mention them, context, knowledge, todos, shared tickets — and the profile as the row's page", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people", "todos"]) setInstalled(id, true);
  const p = await import("@/plugins/people/store");
  const g = await import("@/plugins/people/graph");
  const w = await import("@/plugins/workspace/store");
  const { addManualTodo } = await import("@/lib/boards/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
  const hanna = p.createPerson({ name: "Hanna Acht", aliases: ["Hanni"] });
  p.setCompiled(hanna, { connection: "Teamleitung im Relaunch", keyFacts: ["Entscheidet über das Budget"], funFacts: [], at: new Date().toISOString(), sources: 3 });
  g.addClaim({ personId: hanna, kind: "role", text: "Leitet das Frontend-Team", status: "confirmed" });
  g.addLink({ personId: hanna, rel: "on-ticket", targetType: "ticket", targetRef: "PROJ-77", status: "confirmed" });
  addManualTodo({ ticket: "", text: "Hanni wegen der Freigabe anrufen" });
  addManualTodo({ ticket: "", text: "Ganz anderes" });
  w.createPage({ title: "Kickoff", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "zeffRef", attrs: { kind: "person", ref: String(hanna), label: "Hanna Acht" } }] }] } });

  const id = await createExtSourceDatabase("people");
  await runPipeline(id, { ai: false });
  const d = w.getDatabase(id)!;
  const row = w.rawRows(id).find((r) => r.title === "Hanna Acht")!;
  const cell = (name: string) => String(row.cells[d.schema.properties.find((q) => q.name === name)!.id] ?? "");
  assert.equal(cell("Pages"), "Kickoff");
  assert.equal(cell("Context"), "Teamleitung im Relaunch");
  assert.match(cell("Knowledge"), /Leitet das Frontend-Team/);
  assert.match(cell("Todos"), /Hanni wegen der Freigabe anrufen/);
  assert.ok(!cell("Todos").includes("Ganz anderes"), "only the todos that name them (by alias too)");
  assert.equal(cell("Tickets"), "PROJ-77");
  const page = w.getPage(row.id)!;
  const text = JSON.stringify(page.content);
  assert.ok(text.includes("Teamleitung im Relaunch") && text.includes("Entscheidet über das Budget"), "the profile on the row's page");
});

test("data sources lists what plugins bring — People, with its count and its databases", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people"]) setInstalled(id, true);
  const p = await import("@/plugins/people/store");
  const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
  const { sourcesOverview } = await import("@/plugins/workspace/sources");
  const before = p.listPeople().length;
  const db = await createExtSourceDatabase("people", "Meine Leute");
  const src = (await sourcesOverview()).find((s) => s.key === "ext:people")!;
  assert.ok(src, "People is listed");
  assert.equal(src.name, "People");
  assert.equal(src.count, before);
  assert.ok(src.databases.some((x) => x.href === `/workspace/${db}`), "its databases");
});

test("a person's mention opens their row in the people database — the profile page when there is none", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people"]) setInstalled(id, true);
  const p = await import("@/plugins/people/store");
  const w = await import("@/plugins/workspace/store");
  const { ensurePeopleDatabase, personHref } = await import("@/plugins/workspace/people-database");
  const iris = p.createPerson({ name: "Iris Neun" });
  const { getPref, setPref } = await import("@/lib/prefs");
  void getPref;
  setPref("workspace.peopleDb", 0);
  assert.equal(personHref(iris), "/workspace", "without a database: the Workspace");
  setPref("workspace.peopleDb", null);
  await ensurePeopleDatabase();
  const { peopleDatabase } = await import("@/plugins/workspace/people-database");
  const row = w.rawRows(peopleDatabase()!).find((r) => r.cells.srcref === `person:${iris}`);
  assert.ok(row);
  assert.equal(personHref(iris), `/workspace/${row!.id}`);
});
