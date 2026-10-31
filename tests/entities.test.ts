import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
// Its proposals are decided by its own handler (proposals.sources), there only while the plugin is installed.
test.before(async () => (await import("@/plugins/state")).setInstalled("entities", true));

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
let mailNo = 0;
async function mail(name: string, email: string, subject = "Hallo") {
  const { getDb, schema } = await import("@/db");
  const key = `m${++mailNo}`;
  getDb().insert(schema.emails).values({ key, convId: `c-${key}`, syncedAt: ago(0), folder: "Posteingang", fromName: name, fromEmail: email, subject, preview: "…", receivedAt: ago(mailNo % 20) } as never).run();
}

test("entities: freemail domains are no organisation; a domain is its registrable part, a name without its legal form", async () => {
  const { isFreemail, registrableDomain, orgNameFromDomain, normalizeOrgName, normalizeAddress, isOnlineLocation } = await import("@/plugins/entities/normalize");
  for (const d of ["gmail.com", "googlemail.com", "gmx.de", "gmx.net", "web.de", "outlook.com", "outlook.de", "hotmail.com", "icloud.com", "me.com", "yahoo.de", "t-online.de", "posteo.de", "proton.me", "mail.de"]) assert.equal(isFreemail(d), true, d);
  for (const d of ["example.com", "example.org", "xing.com"]) assert.equal(isFreemail(d), false, d);
  assert.equal(registrableDomain("mail.xing.com"), "xing.com");
  assert.equal(registrableDomain("email.example.ai"), "example.ai");
  assert.equal(registrableDomain("shop.example.co.uk"), "example.co.uk");
  assert.equal(registrableDomain("Example.COM"), "example.com");
  assert.equal(registrableDomain("sharepoint.eu.com"), "sharepoint.eu.com");
  assert.equal(orgNameFromDomain("example.com"), "Example");
  assert.equal(orgNameFromDomain("it-dienst.de"), "It-Dienst");
  assert.equal(normalizeOrgName("Acme GmbH"), normalizeOrgName("ACME"));
  assert.equal(normalizeOrgName("Müller & Söhne GmbH & Co. KG"), "mueller & soehne");
  assert.equal(normalizeAddress("Anna-Müller-Weg 5, 79100 Freiburg"), normalizeAddress("anna-mueller-weg 5 79100  Freiburg"));
  assert.equal(normalizeAddress("Hauptstr. 3, 10115 Berlin"), normalizeAddress("Hauptstraße 3 10115 Berlin"));
  assert.equal(isOnlineLocation("Microsoft Teams Meeting"), true);
  assert.equal(isOnlineLocation("https://zoom.us/j/123"), true);
  assert.equal(isOnlineLocation("Büro"), false);
});

test("entities: a mail domain becomes an organisation to confirm — freemail never; accepted, its people work there and the resolver finds it", async () => {
  const { createPerson, getPerson } = await import("@/plugins/people/store");
  const { findEntitySuggestions, pendingEntitySuggestions, acceptEntitySuggestion, deriveEntityLinks } = await import("@/plugins/entities/suggest");
  const { listEntities } = await import("@/plugins/entities/store");
  const { resolveEntity } = await import("@/plugins/entities/resolve");
  const { linksOf } = await import("@/plugins/people/graph");
  const anna = createPerson({ name: "Anna Weber", emails: ["anna.weber@example.com"] });
  await mail("Anna Weber", "anna.weber@example.com");
  await mail("Bernd Kolb", "b.kolb@mail.example.com");
  for (let i = 0; i < 6; i++) await mail("Freund", `freund${i}@gmail.com`);
  for (let i = 0; i < 4; i++) await mail("Kumpel", `kumpel@web.de`);

  assert.ok(findEntitySuggestions() >= 1);
  assert.equal(listEntities("org").length, 0, "proposals only");
  const open = pendingEntitySuggestions();
  const org = open.find((s) => s.kind === "org" && s.name === "Example");
  assert.ok(org, JSON.stringify(open));
  assert.deepEqual(org!.data.domains, ["example.com"]);
  assert.ok(org!.evidence.includes("example.com"));
  assert.equal(open.some((s) => /gmail|web\.de|Gmail|Web/.test(s.name + JSON.stringify(s.data))), false, "freemail is no organisation");
  assert.equal(findEntitySuggestions(), 0, "nothing twice");

  const ref = await acceptEntitySuggestion(org!.id);
  assert.match(ref ?? "", /^org:\d+$/);
  deriveEntityLinks();
  const works = linksOf(anna).find((l) => l.rel === "works-at");
  assert.equal(works?.targetType, "org");
  assert.equal(`org:${works?.targetRef}`, ref);
  assert.equal(works?.label, "Example");
  assert.ok(getPerson(anna));

  assert.deepEqual(resolveEntity("someone@example.com").map((r) => r.ref), [ref]);
  assert.deepEqual(resolveEntity("example.com").map((r) => r.ref), [ref]);
  assert.deepEqual(resolveEntity("Example GmbH").map((r) => r.ref), [ref]);
  const annaRefs = resolveEntity("anna.weber@example.com").map((r) => r.ref);
  assert.ok(annaRefs.includes(`person:${anna}`) && annaRefs.includes(ref!));
  assert.deepEqual(resolveEntity("friend@gmail.com"), []);
});

test("entities: names of one organisation are merged or aliased only when you say so; a rejected one isn't proposed again", async () => {
  const { createEntity, getEntity, listEntities, addEntityLink, entityLinks } = await import("@/plugins/entities/store");
  const { findEntitySuggestions, pendingEntitySuggestions, acceptEntitySuggestion, rejectEntitySuggestion } = await import("@/plugins/entities/suggest");
  const { createJob } = await import("@/lib/jobs");
  const a = createEntity("org", "Contoso");
  addEntityLink(`org:${a}`, "domain", "contoso.de");
  const b = createEntity("org", "Contoso GmbH");
  const c = createEntity("org", "Fabrikam");
  addEntityLink(`org:${c}`, "domain", "fabrikam.com");
  // The customer of a job: Fabrikam under another name — the address says it's them.
  const { createPerson } = await import("@/plugins/people/store");
  const p = createPerson({ name: "Fabrikam Werke", emails: ["info@fabrikam.com"] });
  const { getSqlite } = await import("@/db");
  getSqlite().prepare("update people set kind = 'organization' where id = ?").run(p);
  createJob({ number: "FB-1", name: "Fabrikam Shop", customer: "Northwind AG" });

  findEntitySuggestions();
  const open = pendingEntitySuggestions();
  const merge = open.find((s) => s.kind === "merge");
  assert.ok(merge, JSON.stringify(open));
  assert.deepEqual([merge!.ref, merge!.otherRef].sort(), [`org:${a}`, `org:${b}`].sort());
  const alias = open.find((s) => s.kind === "alias" && s.name === "Fabrikam Werke");
  assert.equal(alias?.ref, `org:${c}`);
  const northwind = open.find((s) => s.kind === "org" && s.name === "Northwind AG");
  assert.ok(northwind, "a job's customer is an organisation to confirm");

  await acceptEntitySuggestion(merge!.id);
  assert.equal(listEntities("org").filter((o) => o.name.startsWith("Contoso")).length, 1);
  const kept = getEntity(merge!.ref)!;
  assert.ok([kept.name, ...kept.aliases].includes("Contoso GmbH") && [kept.name, ...kept.aliases].includes("Contoso"));
  assert.ok(entityLinks(merge!.ref).some((l) => l.rel === "domain" && l.target === "contoso.de"));

  await acceptEntitySuggestion(alias!.id);
  assert.ok(getEntity(`org:${c}`)!.aliases.includes("Fabrikam Werke"));
  await rejectEntitySuggestion(northwind!.id);
  findEntitySuggestions();
  assert.equal(pendingEntitySuggestions().some((s) => s.name === "Northwind AG"), false, "rejected stays rejected");
});

test("entities: a project gathers its job number, Jira key and board, repos and Workspace databases — proposed, then projectOf resolves tickets, entries, MRs, todos", async () => {
  const { getSqlite, getDb, schema } = await import("@/db");
  const { createJob } = await import("@/lib/jobs");
  const { findEntitySuggestions, pendingEntitySuggestions, acceptEntitySuggestion } = await import("@/plugins/entities/suggest");
  const { projectOf } = await import("@/plugins/entities/resolve");
  const { entityLinks } = await import("@/plugins/entities/store");
  const { getProject, createProject } = await import("@/lib/projects");
  const d = getSqlite();
  const job = createJob({ number: "AB123-000001-00", name: "PROJ Support" });
  createJob({ number: "AB123-000002-00", name: "PROJ Relaunch" });
  getDb().insert(schema.jiraBoards).values({ id: 3359, name: "PROJ Support", projectKey: "PROJ", jobNumber: "AB123-000001-00", enabled: true } as never).run();
  getDb().insert(schema.jiraBoards).values({ id: 3396, name: "PROJ - Relaunch", projectKey: "PROJ", jobNumber: "AB123-000002-00", enabled: true } as never).run();
  getDb().insert(schema.jiraTickets).values({ key: "PROJ-12", summary: "Footer", boardId: 3359 } as never).run();
  getDb().insert(schema.jiraTickets).values({ key: "PROJ-40", summary: "Relaunch nav", boardId: 3396 } as never).run();
  const repo = getDb().insert(schema.repos).values({ name: "proj-frontend", path: "C:/x/proj-frontend", gitlabProject: "customer-proj/proj-frontend", boards: "[3359]" } as never).returning().get() as { id: number };
  d.exec("create table if not exists jira_board_dbs (board_id text primary key, db_id integer not null)");
  d.prepare("insert into jira_board_dbs (board_id, db_id) values ('jira-3359', 26)").run();
  // An existing project with its job: a board on that job is proposed as a link.
  createJob({ number: "TY-1", name: "TYPO3" });
  const typo = createProject({ title: "TYPO 3 Training", jobNumber: "TY-1" });
  getDb().insert(schema.jiraBoards).values({ id: 77, name: "Typo board", projectKey: "TYPO", jobNumber: "TY-1", enabled: true } as never).run();

  findEntitySuggestions();
  const open = pendingEntitySuggestions();
  const support = open.find((s) => s.kind === "project" && s.name === "PROJ Support");
  assert.ok(support, JSON.stringify(open));
  const targets = support!.data.links!.map((l) => `${l.rel}:${l.target}`);
  for (const want of ["job:AB123-000001-00", "jira:PROJ", "board:3359", `repo:${repo.id}`, "db:26"]) assert.ok(targets.includes(want), `${want} in ${targets}`);
  assert.ok(open.find((s) => s.kind === "project" && s.name === "PROJ Relaunch"));
  const typoLink = open.find((s) => s.kind === "link" && s.ref === `project:${typo.id}`);
  assert.ok(typoLink?.data.links?.some((l) => l.rel === "board" && l.target === "77"), JSON.stringify(typoLink));

  const ref = (await acceptEntitySuggestion(support!.id))!;
  const id = Number(ref.split(":")[1]);
  assert.equal(getProject(id)?.job?.number, "AB123-000001-00");
  assert.ok(entityLinks(ref).some((l) => l.rel === "repo" && l.target === String(repo.id)));
  await acceptEntitySuggestion(typoLink!.id);

  assert.equal(projectOf("ticket:PROJ-12"), ref, "the ticket's board says which");
  assert.equal(projectOf("ticket:PROJ-40"), null, "PROJ is two jobs — Relaunch has no project yet");
  assert.equal(projectOf("job:AB123-000001-00"), ref);
  assert.equal(projectOf(`repo:${repo.id}`), ref);
  assert.equal(projectOf("mr:customer-proj/proj-frontend!17"), ref);
  assert.equal(projectOf("page:26"), ref);
  const entry = getDb().insert(schema.timeEntries).values({ jobId: job.id, date: "2026-10-20", hours: 1, description: "x" } as never).returning().get() as { id: number };
  assert.equal(projectOf(`entry:${entry.id}`), ref);
  const todo = d.prepare("insert into todos (ticket, text, created_at, updated_at) values ('PROJ-12', 'Fix it', ?, ?)").run(ago(0), ago(0));
  assert.equal(projectOf(`todo:${todo.lastInsertRowid}`), ref);
  assert.equal(projectOf("ticket:TYPO-3"), `project:${typo.id}`, "a key only one project has");
  assert.equal(projectOf("ticket:NOPE-1"), null);
});

test("entities: places from appointments and addresses — online ones never; an alias ('Büro') is the same place", async () => {
  const { getDb, schema } = await import("@/db");
  const { createPerson } = await import("@/plugins/people/store");
  const { addDetail } = await import("@/plugins/people/details");
  const { findEntitySuggestions, pendingEntitySuggestions, acceptEntitySuggestion, deriveEntityLinks } = await import("@/plugins/entities/suggest");
  const { addAlias, getEntity } = await import("@/plugins/entities/store");
  const { resolveEntity } = await import("@/plugins/entities/resolve");
  const { linksOf } = await import("@/plugins/people/graph");
  const ev = (key: string, location: string) => getDb().insert(schema.calendarEvents).values({ calendarId: 1, key, title: "Termin", start: "2026-10-20T10:00", end: "2026-10-20T11:00", location, updatedAt: ago(0) } as never).run();
  ev("e1", "Hauptstr. 3, 10115 Berlin");
  ev("e2", "Hauptstraße 3 10115 Berlin");
  ev("e3", "Microsoft Teams Meeting");
  ev("e4", "Microsoft Teams Meeting");
  ev("e5", "Hauptstr. 3");
  const tom = createPerson({ name: "Tom Lang" });
  addDetail(tom, "address", "Lindenallee 7, 79100 Freiburg");

  findEntitySuggestions();
  const open = pendingEntitySuggestions().filter((s) => s.kind === "place");
  assert.equal(open.filter((s) => /10115/.test(s.data.address ?? "")).length, 1, JSON.stringify(open));
  assert.ok(open.find((s) => /Lindenallee 7/.test(s.data.address ?? "")));
  assert.equal(open.some((s) => /Teams/.test(s.name)), false);

  const berlin = (await acceptEntitySuggestion(open.find((s) => /10115/.test(s.data.address ?? ""))!.id))!;
  const home = (await acceptEntitySuggestion(open.find((s) => /Lindenallee/.test(s.data.address ?? ""))!.id))!;
  findEntitySuggestions();
  const short = pendingEntitySuggestions().find((s) => s.kind === "alias" && s.name === "Hauptstr. 3");
  assert.equal(short?.ref, berlin, "a shorter way of writing it is an alias");
  deriveEntityLinks();
  assert.ok(linksOf(tom).some((l) => l.rel === "located-at" && `place:${l.targetRef}` === home));

  addAlias(berlin, "Büro");
  assert.deepEqual(resolveEntity("Büro").map((r) => r.ref), [berlin]);
  assert.deepEqual(resolveEntity("Hauptstraße 3, 10115 Berlin").map((r) => r.ref), [berlin]);
  assert.ok(getEntity(berlin)!.address.includes("10115"));
});

test("entities: the review queue lists the proposals and its buttons decide them; MCP search and get show an entity with its links", async () => {
  const { createEntity, addEntityLink } = await import("@/plugins/entities/store");
  const { reviewAct, reviewItems } = await import("@/lib/review");
  const { entitySearch, entityGet } = await import("@/plugins/entities/tools");
  await mail("Shop", "orders@tailspin.example");
  await mail("Shop", "orders@tailspin.example");
  const { findEntitySuggestions } = await import("@/plugins/entities/suggest");
  findEntitySuggestions();
  const items = (await reviewItems()).items.filter((i) => i.source === "entities");
  const item = items.find((i) => i.title.includes("Tailspin"));
  assert.ok(item, JSON.stringify(items.map((i) => i.title)));
  await reviewAct(item!.key, "yes");
  assert.equal((await reviewItems()).items.some((i) => i.source === "entities" && i.title.includes("Tailspin")), false);

  const w = createEntity("org", "Woodgrove Bank");
  addEntityLink(`org:${w}`, "domain", "woodgrove.example");
  const hits = entitySearch("woodgrove");
  assert.equal(hits[0]?.ref, `org:${w}`);
  const got = entityGet(`org:${w}`);
  assert.equal(got?.name, "Woodgrove Bank");
  assert.ok(got?.links.some((l) => l.rel === "domain" && l.target === "woodgrove.example"));
  assert.equal(entityGet("org:99999"), null);
});

test("entities: an organisation as a Workspace row — its page gathers people and mails, an edit in the row goes to it", async () => {
  const { ORGS_SOURCE, PROJECTS_SOURCE } = await import("@/plugins/entities/workspace-source");
  const { getEntity, listEntities } = await import("@/plugins/entities/store");
  const records = await ORGS_SOURCE.read();
  const pixel = listEntities("org").find((o) => o.name === "Example")!;
  const rec = records.find((r) => r.ref === pixel.ref)!;
  assert.ok(rec, "a row per organisation");
  assert.equal(rec.typed?.find((f) => f.id === "entdomains")?.value, "example.com");
  assert.match(String(rec.typed?.find((f) => f.id === "entpeople")?.value), /Anna Weber/);
  assert.match(rec.text ?? "", /Latest mails[\s\S]*Anna Weber: Hallo/);
  const row = { id: 1, title: "Acme", cells: { srcref: pixel.ref, srcedited: rec.updatedAt, entaliases: "PXP, Acme", entdomains: "example.com, example.de", entnote: "Arbeitgeber" } };
  await ORGS_SOURCE.pull!(0, [row as never], {} as never);
  const after = getEntity(pixel.ref)!;
  assert.deepEqual(after.aliases.sort(), ["Acme", "PXP"]);
  assert.deepEqual(after.domains.sort(), ["example.com", "example.de"]);
  assert.equal(after.note, "Arbeitgeber");
  const projects = await PROJECTS_SOURCE.read();
  const support = projects.find((r) => r.title === "PROJ Support")!;
  assert.equal(support.typed?.find((f) => f.id === "entjira")?.value, "PROJ");
  assert.equal(support.typed?.find((f) => f.id === "enthours")?.value, 1);
});
