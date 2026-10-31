import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The blocks of a person's page (the detail view of a row of the people database): one bundle of what is known — profile, dates,
 * summary, claims, relations, messages, todos, pages, tickets — and the operations the blocks offer. They work on the profile
 * of the row (its source reference), wherever the page is.
 */
async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people", "todos"]) setInstalled(id, true);
  const p = await import("@/plugins/people/store");
  const w = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
  const db = await createExtSourceDatabase("people", "Leute");
  return { p, w, runPipeline, db };
}

test("personOfRow: the profile a row stands for — by its source reference", async () => {
  const { p, w, runPipeline, db } = await setup();
  const { personOfRow } = await import("@/plugins/people/blocks");
  const id = p.createPerson({ name: "Jana Blocks" });
  await runPipeline(db, { ai: false });
  const row = w.rawRows(db).find((r) => r.title === "Jana Blocks")!;
  assert.equal(personOfRow(row.id), id);
  assert.equal(personOfRow(w.createPage({ title: "Keine Person" })), null);
});

test("personBundle: what the blocks show", async () => {
  const { p } = await setup();
  const g = await import("@/plugins/people/graph");
  const { personBundle } = await import("@/plugins/people/blocks");
  const { addManualTodo } = await import("@/lib/todos/store");
  const id = p.createPerson({ name: "Kim Bundle", aliases: ["Kimmy"], emails: ["kim@bundle.example"], whatsapp: "Kim WA", note: "mag Tee" });
  p.addAccount(id, "jira", "kbundle");
  p.addDate(id, { kind: "birthday", day: 1, month: 2, year: 1991 });
  g.addClaim({ personId: id, kind: "fact", text: "Spielt Cello", status: "confirmed" });
  g.addClaim({ personId: id, kind: "role", text: "Vermutlich Teamleiterin", status: "proposed", confidence: 0.5 });
  g.addLink({ personId: id, rel: "on-ticket", targetType: "ticket", targetRef: "PROJ-9", status: "confirmed" });
  addManualTodo({ ticket: "", text: "Kimmy anrufen" });
  const b = await personBundle(id);
  assert.equal(b.name, "Kim Bundle");
  assert.deepEqual([b.aliases, b.emails, b.jira, b.whatsapp, b.note], [["Kimmy"], ["kim@bundle.example"], ["kbundle"], "Kim WA", "mag Tee"]);
  assert.equal(b.dates.length, 1);
  assert.equal(b.dates[0].kind, "birthday");
  assert.deepEqual(b.claims.map((c) => [c.text, c.status]).sort(), [["Spielt Cello", "confirmed"], ["Vermutlich Teamleiterin", "proposed"]], "claims, the proposed ones to review too");
  assert.deepEqual(b.tickets, ["PROJ-9"]);
  assert.deepEqual(b.todos.map((t) => t.text), ["Kimmy anrufen"]);
  assert.ok(b.others.every((o) => o.id !== id), "the others to merge into");
});

test("personOp: profile, note, star, dates, relations, review — and merge and delete", async () => {
  const { p } = await setup();
  const g = await import("@/plugins/people/graph");
  const { personOp, personBundle } = await import("@/plugins/people/blocks");
  const id = p.createPerson({ name: "Lou Ops" });

  await personOp(id, { op: "profile", name: "Lou Operator", aliases: "Lulu; Lou-Lou", emails: "lou@ops.example", whatsapp: "Lou WA", jira: "@louops" });
  let b = await personBundle(id);
  assert.deepEqual([b.name, b.aliases, b.emails, b.whatsapp, b.jira], ["Lou Operator", ["Lulu", "Lou-Lou"], ["lou@ops.example"], "Lou WA", ["louops"]]);
  await personOp(id, { op: "note", note: "Neu" });
  await personOp(id, { op: "star", on: true });
  b = await personBundle(id);
  assert.deepEqual([b.note, b.starred], ["Neu", true]);

  await personOp(id, { op: "addDate", kind: "birthday", date: "16.10.1990", label: "" });
  b = await personBundle(id);
  assert.equal(b.dates.length, 1);
  assert.equal(b.dates[0].confirmed, true);
  await personOp(id, { op: "dateRemind", id: b.dates[0].id, days: 3 });
  assert.equal((await personBundle(id)).dates[0].remindDays, 3);
  await assert.rejects(() => personOp(id, { op: "addDate", kind: "birthday", date: "nonsense", label: "" }), /16\.10\./);
  await personOp(id, { op: "dateDelete", id: b.dates[0].id });
  assert.equal((await personBundle(id)).dates.length, 0);

  await personOp(id, { op: "addRelation", rel: "Vermieterin", other: 0 });
  b = await personBundle(id);
  assert.equal(b.relations.out[0].rel, "Vermieterin");
  await personOp(id, { op: "deleteRelation", id: b.relations.out[0].id });
  assert.equal((await personBundle(id)).relations.out.length, 0);

  g.addClaim({ personId: id, kind: "fact", text: "Mag Pilze", status: "proposed", confidence: 0.4 });
  b = await personBundle(id);
  await personOp(id, { op: "review", what: "claim", id: b.claims[0].id, action: "confirm" });
  assert.equal((await personBundle(id)).claims[0].status, "confirmed");

  const other = p.createPerson({ name: "Mo Merge" });
  const r = await personOp(other, { op: "merge", keep: id });
  assert.equal(r.gone, true);
  assert.equal(p.getPerson(other), null, "the merged one is gone");
  assert.ok((await personBundle(id)).aliases.includes("Mo Merge"), "its name an alias of the one kept");
  const r2 = await personOp(id, { op: "delete" });
  assert.equal(r2.gone, true);
  assert.equal(p.getPerson(id), null);
});

test("the people database's rows: a person's page is ONE custom-view block, its own text free — no detail layout page", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
  const { ensureRowView, rowViewOf } = await import("@/plugins/workspace/row-views");
  const p = await import("@/plugins/people/store");
  p.createPerson({ name: "Seiten Person" });
  const db = await createExtSourceDatabase("people", "Seitenleute");
  const d = w.getDatabase(db)!;
  assert.equal(d.schema.dataType, "people", "typed from the start");
  assert.equal((d.schema as { detailPage?: number }).detailPage, undefined, "no detail layout page");
  assert.equal(rowViewOf(d.schema.dataType)?.id, "person");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  await runPipeline(db, { ai: false });
  const row = w.rawRows(db).find((r) => r.title === "Seiten Person")!;
  ensureRowView(row.id);
  const doc = JSON.stringify(w.getPage(row.id)!.content);
  assert.match(doc, /"type":"rowView"/, "its page starts with the person's view");
  assert.ok(!doc.includes("person-profile") && !doc.includes('"flexBox"'), "no dozen modules, no layout boxes");
});

test("the overview of the people database: what is coming up, what to check — and the tools", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people"]) setInstalled(id, true);
  const p = await import("@/plugins/people/store");
  const g = await import("@/plugins/people/graph");
  const { peopleOverview, peopleTool } = await import("@/plugins/people/tools");
  await peopleTool({ tool: "add", name: "Nora Overview" });
  const nora = p.listPeople().find((x) => x.name === "Nora Overview")!;
  assert.ok(nora, "a person added by the tool");
  const soon = new Date(Date.now() + 3 * 864e5);
  p.addDate(nora.id, { kind: "birthday", day: soon.getDate(), month: soon.getMonth() + 1, year: 1990 });
  p.addDate(nora.id, { kind: "anniversary", day: 1, month: 1, year: 2015, confirmed: false, source: "ai", sourceText: "Hochzeit 2015" });
  g.addClaim({ personId: nora.id, kind: "role", text: "Leitet die Buchhaltung", status: "proposed", confidence: 0.6 });

  let o = await peopleOverview();
  assert.ok(o.upcoming.some((u) => u.personId === nora.id), "her birthday is coming up");
  assert.ok(o.dates.some((d) => d.personId === nora.id && d.source === "Hochzeit 2015"), "a date found, to confirm");
  assert.ok(o.claims.some((c) => c.personId === nora.id && c.text === "Leitet die Buchhaltung"), "a claim to check");

  await peopleTool({ tool: "dateConfirm", id: o.dates.find((d) => d.personId === nora.id)!.id });
  await peopleTool({ tool: "claim", id: o.claims.find((c) => c.personId === nora.id)!.id, action: "confirm" });
  o = await peopleOverview();
  assert.ok(!o.dates.some((d) => d.personId === nora.id), "confirmed: no longer proposed");
  assert.ok(!o.claims.some((c) => c.personId === nora.id));
});

test("a filtered database of the people database: its rows stand for the same profiles (and open as the person's page too)", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people"]) setInstalled(id, true);
  const p = await import("@/plugins/people/store");
  const w = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createDerivedDatabase } = await import("@/plugins/workspace/derived");
  const { ensurePeopleDatabase, peopleDatabase } = await import("@/plugins/workspace/people-database");
  const { personOfRow } = await import("@/plugins/people/blocks");
  const id = p.createPerson({ name: "Derya Abgeleitet" });
  await ensurePeopleDatabase();
  const home = peopleDatabase()!;
  await runPipeline(home, { ai: false });
  const child = createDerivedDatabase(home, "Gefilterte Leute");
  await runPipeline(child, { ai: false });
  const d = w.getDatabase(child)!;
  assert.equal(d.schema.dataType, "people");
  const row = w.rawRows(child).find((r) => r.title === "Derya Abgeleitet")!;
  assert.equal(personOfRow(row.id), id, "its row stands for the same profile");
});

test("edit in place: a title or a cell changed on a person's row reaches the profile at once (a run of the people database follows the edit)", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "people"]) setInstalled(id, true);
  const p = await import("@/plugins/people/store");
  const w = await import("@/plugins/workspace/store");
  const { runPipeline, syncAfterEdit } = await import("@/plugins/workspace/pipeline");
  const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
  const id = p.createPerson({ name: "Edda Direkt", note: "alt" });
  const db = await createExtSourceDatabase("people", "Direkt");
  await runPipeline(db, { ai: false });
  const row = w.rawRows(db).find((r) => r.title === "Edda Direkt")!;
  w.updatePage(row.id, { title: "Edda Geändert" });
  const done = await syncAfterEdit(row.id);
  assert.ok(done, "a run followed");
  assert.equal(p.getPerson(id)!.name, "Edda Geändert", "the profile has the new name");
  // a database without a two-way source: nothing runs
  const plain = w.createPage({ kind: "database", title: "Plain" });
  const r2 = w.addRow(plain, { title: "x" });
  assert.equal(await syncAfterEdit(r2), null);
});
