import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

/** A small world: two people, and something of every source about them. */
async function seed() {
  const { getDb, getSqlite, schema } = await import("@/db");
  const { createPerson, addAccount, listPeople } = await import("@/plugins/people/store");
  const had = listPeople().find((p) => p.name === "Julia Freidank");
  if (had) return { julia: had.id, rico: listPeople().find((p) => p.name === "Rico Clemen")!.id };
  const db = getDb();
  const julia = createPerson({ name: "Julia Freidank", aliases: ["Jule"], emails: ["julia@example.com"], whatsapp: "Jule" });
  const rico = createPerson({ name: "Rico Clemen" });
  addAccount(rico, "jira", "ricclem");
  db.insert(schema.emails).values({ key: "m1", convId: "c1", folder: "Posteingang", fromName: "J. Freidank", fromEmail: "Julia@Example.com", subject: "Abnahme ORD-12", preview: "Die Abnahme ist durch.", receivedAt: ago(3), syncedAt: ago(0) }).run();
  db.insert(schema.emails).values({ key: "w1", convId: "wa:Jule", folder: "WhatsApp", fromName: "Jule", subject: "", preview: "Kommst du morgen?", receivedAt: ago(2), syncedAt: ago(0) }).run();
  db.insert(schema.emails).values({ key: "s1", convId: "sg:Rico Clemen", folder: "Signal", fromName: "Rico Clemen", subject: "", preview: "Bin da", receivedAt: ago(2), syncedAt: ago(0) }).run();
  db.insert(schema.teamsMessages).values({ key: "t1", kind: "pm", conversationId: "x", messageId: "t1", sentAt: ago(1), html: "", text: "Rico, kannst du ORD-12 deployen?", link: "https://teams/x", syncedAt: ago(0), senderName: "Julia Freidank", place: "Chat" } as never).run();
  db.insert(schema.jiraTickets).values({ key: "ORD-12", summary: "Navigation", status: "In Arbeit", statusCategory: "inprogress", assignee: "Rico Clemen", url: "https://jira/ORD-12", openedAt: ago(10), updatedAt: ago(1) }).run();
  db.insert(schema.jiraComments).values({ id: "jc1", ticket: "ORD-12", author: "ricclem", at: ago(1), body: "Deployed auf Stage." }).run();
  db.insert(schema.gitlabItems).values({ key: "mr:web!7", kind: "mr", project: "web", projectUrl: "https://gl/web", ref: "!7", title: "ORD-12 Navigation", body: "", author: "Rico Clemen", state: "opened", createdAt: ago(2), updatedAt: ago(2), url: "https://gl/web/-/merge_requests/7", syncedAt: ago(0) }).run();
  db.insert(schema.calendars).values({ key: "zeff", source: "zeff", name: "Meine", color: "#00f", createdAt: ago(9), updatedAt: ago(9) }).run();
  const cal = (getSqlite().prepare("select id from calendars where key = 'zeff'").get() as { id: number }).id;
  db.insert(schema.calendarEvents).values({ calendarId: cal, key: "e1", title: "Abstimmung ORD-12", start: "2026-10-20T10:00", end: "2026-10-20T11:00", attendees: JSON.stringify(["julia@example.com", "Rico Clemen"]), updatedAt: ago(1) }).run();
  db.insert(schema.jobs).values({ number: "2026-0815", name: "Relaunch" }).run();
  const job = (getSqlite().prepare("select id from jobs where number = '2026-0815'").get() as { id: number }).id;
  db.insert(schema.projects).values({ title: "Relaunch", jobId: job }).run();
  const project = (getSqlite().prepare("select id from projects where title = 'Relaunch'").get() as { id: number }).id;
  db.insert(schema.timeEntries).values({ jobId: job, projectId: project, date: "2026-10-20", hours: 1.5, description: "Navigation gebaut", ticket: "ORD-12", start: "09:00" }).run();
  const todo = Number(db.insert(schema.todos).values({ ticket: "ORD-12", text: "Rico an das Deployment erinnern" }).run().lastInsertRowid);
  getSqlite().prepare("update todos set status = 'done', done_at = ? where id = ?").run(ago(0), todo);
  // A document naming Julia by her address.
  db.insert(schema.documents).values({ name: "Brief.pdf", sha256: "abc", status: "ready", file: "f", text: "Kontakt: julia@example.com", summary: "Ein Brief", createdAt: ago(4), updatedAt: ago(4) }).run();
  return { julia, rico, todo, project };
}

test("the indexer reads every source into events with their refs — and running it again records nothing new", async () => {
  const { julia, rico, todo, project } = await seed();
  const { indexTimeline } = await import("@/plugins/timeline/indexer");
  const { eventsFor, eventBySource } = await import("@/plugins/timeline/store");
  const first = await indexTimeline();
  assert.ok(first.added >= 10, `added ${first.added}`);
  const again = await indexTimeline();
  assert.equal(again.added, 0, "nothing new the second time");

  const mail = eventBySource("mail", "m1")!;
  assert.equal(mail.kind, "mail");
  assert.ok(mail.refs.includes(`person:${julia}`), "the sender by her address (any case)");
  assert.ok(mail.refs.includes("ticket:ORD-12"), "the ticket key in the subject");
  assert.ok(mail.refs.includes("mail:m1"));
  assert.equal(mail.actorRef, `person:${julia}`);

  const chat = eventBySource("whatsapp", "w1")!;
  assert.equal(chat.kind, "message");
  assert.ok(chat.refs.includes(`person:${julia}`), "the chat's owner (her WhatsApp chat name)");
  assert.ok(chat.refs.includes("msg:whatsapp:w1"));
  assert.ok(eventBySource("signal", "s1")!.refs.includes(`person:${rico}`));

  const teams = eventBySource("teams", "t1")!;
  assert.ok(teams.refs.includes(`person:${julia}`) && teams.refs.includes(`person:${rico}`), "the sender and who it names");
  assert.equal(teams.url, "https://teams/x");

  assert.ok(eventBySource("jira", "ORD-12:created")!.refs.includes(`person:${rico}`), "the assignee");
  const comment = eventBySource("jira", "comment:jc1")!;
  assert.ok(comment.refs.includes(`person:${rico}`), "the author by their Jira username");
  assert.ok(eventBySource("gitlab", "mr:web!7:opened")!.refs.includes("ticket:ORD-12"));
  const meeting = eventsFor("ticket:ORD-12", { kinds: ["meeting"] })[0];
  assert.ok(meeting.refs.includes(`person:${julia}`) && meeting.refs.includes(`person:${rico}`), "attendees by address and name");
  const time = eventsFor("ticket:ORD-12", { kinds: ["time"] })[0];
  assert.ok(time.refs.includes(`project:${project}`) && time.refs.includes("job:2026-0815"));
  assert.deepEqual(eventsFor(`todo:${todo}`).map((e) => e.kind), ["todo.done", "todo.created"]);
  assert.ok(eventsFor(`todo:${todo}`)[0].refs.includes(`person:${rico}`), "the person the todo names");
  assert.ok(eventsFor(`person:${julia}`, { kinds: ["document"] }).length === 1, "the letter with her address");
  // Everything about the ticket, in time order (newest first).
  const all = eventsFor("ticket:ORD-12");
  assert.ok(all.length >= 6);
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].at >= all[i].at);
});

test("a ticket moved to another status is an event of its own; changed otherwise, one per update", async () => {
  await seed();
  const { getSqlite } = await import("@/db");
  const { indexTimeline } = await import("@/plugins/timeline/indexer");
  const { eventsFor } = await import("@/plugins/timeline/store");
  await indexTimeline();
  getSqlite().prepare("update jira_tickets set status = 'Done', status_category = 'done', updated_at = ? where key = 'ORD-12'").run(new Date().toISOString());
  await indexTimeline();
  const st = eventsFor("ticket:ORD-12", { kinds: ["ticket.status"] });
  assert.equal(st.length, 1);
  assert.match(st[0].title, /Done/);
  assert.equal((await indexTimeline()).added, 0);
});

test("Workspace rows: added and changed (a day's changes in one event), with their database and the person the row stands for", async () => {
  await seed();
  const w = await import("@/plugins/workspace/store");
  const { indexTimeline } = await import("@/plugins/timeline/indexer");
  const { eventsFor } = await import("@/plugins/timeline/store");
  const db = w.createPage({ kind: "database", title: "Journal" });
  const row = w.addRow(db, { title: "Tag mit Jule" });
  await indexTimeline();
  const ev = eventsFor(`page:${row}`);
  assert.deepEqual(ev.map((e) => e.kind), ["row.added"]);
  assert.ok(ev[0].refs.includes(`page:${db}`), "its database");
  assert.match(ev[0].title, /Tag mit Jule/);
  w.updatePage(row, { title: "Tag mit Jule am See" });
  w.updatePage(row, { title: "Tag mit Jule am See!" });
  await indexTimeline();
  const changed = eventsFor(`page:${row}`, { kinds: ["row.changed"] });
  assert.equal(changed.length, 1, "one event for the day's changes");
  assert.equal((await indexTimeline()).added, 0);
});

test("bank transactions (Finances installed): a payment with the case's row and the counterparty", async () => {
  const { julia } = await seed();
  const { getSqlite } = await import("@/db");
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("finances", true);
  getSqlite().exec("create table if not exists bank_transactions (id text primary key, account text not null, date text not null, amount real not null, currency text not null default 'EUR', text text not null default '', counterparty text not null default '', iban text not null default '', reference text not null default '', imported_at text not null, case_id integer, todo_id integer, matched_at text)");
  getSqlite().prepare("insert into bank_transactions (id, account, date, amount, text, counterparty, imported_at) values ('tx1', 'DE1', '2026-10-19', -50, 'Rate Oktober', 'Julia Freidank', ?)").run(ago(0));
  const { indexTimeline } = await import("@/plugins/timeline/indexer");
  const { eventBySource } = await import("@/plugins/timeline/store");
  await indexTimeline();
  const tx = eventBySource("bank", "tx1")!;
  assert.equal(tx.kind, "payment");
  assert.ok(tx.refs.includes(`person:${julia}`));
  assert.match(tx.title, /50/);
});

test("resolveQuery: a ref, a ticket key, a person's name or alias, a page's title", async () => {
  const { julia } = await seed();
  const { resolveQuery } = await import("@/plugins/timeline/refs");
  assert.equal(resolveQuery("person:7")?.ref, "person:7");
  assert.equal(resolveQuery("ord-12")?.ref, "ticket:ORD-12");
  assert.equal(resolveQuery("Julia Freidank")?.ref, `person:${julia}`);
  assert.equal(resolveQuery("jule")?.ref, `person:${julia}`);
  assert.equal(resolveQuery("Freidank")?.ref, `person:${julia}`, "a part of the name, when only one has it");
  assert.equal(resolveQuery("Relaunch")?.ref.split(":")[0], "project");
  assert.equal(resolveQuery("nichts dergleichen xyz"), null);
});
