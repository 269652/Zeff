import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

test("identity: the names the sources write become proposals — nothing is applied by itself, a rejection stays rejected", async () => {
  const { getDb, schema } = await import("@/db");
  const { createPerson, addAccount, getPerson, listPeople } = await import("@/plugins/people/store");
  const { findIdentitySuggestions, pendingSuggestions, acceptSuggestion, rejectSuggestion } = await import("@/plugins/people/identity");
  const db = getDb();
  const chris = createPerson({ name: "Christopher Lorenz", emails: ["c.lorenz@example.com"] });
  addAccount(chris, "jira", "chrlorenz1");
  const julia = createPerson({ name: "Julia" });
  const jonas = createPerson({ name: "Jonas Teichrueb" });
  const jonasTwo = createPerson({ name: "Teichrüb, Jonas" });
  const mail = (key: string, name: string, email: string) => db.insert(schema.emails).values({ key, convId: `c-${key}`, syncedAt: ago(0), folder: "Posteingang", fromName: name, fromEmail: email, subject: "x", preview: "y", receivedAt: ago(1) } as never).run();
  // Same address, written as "Lorenz, Chris".
  mail("m1", "Lorenz, Chris", "c.lorenz@example.com");
  // Teams: "Julia Freidank" five times — Julia is the only Julia.
  for (let i = 0; i < 5; i++) db.insert(schema.teamsMessages).values({ key: `t${i}`, kind: "chat", conversationId: "x", messageId: String(i), sentAt: ago(i), html: "", text: "hi", link: "l", syncedAt: ago(0), senderName: "Julia Freidank", place: "PROJ Devs" } as never).run();
  // Someone with no profile who turns up in two sources.
  for (let i = 0; i < 2; i++) db.insert(schema.jiraComments).values({ id: `j${i}`, ticket: "PC-1", author: "Nikolai Townsend", at: ago(1), body: "x" } as never).run();
  db.insert(schema.teamsMessages).values({ key: "tn", kind: "chat", conversationId: "x", messageId: "n", sentAt: ago(1), html: "", text: "hi", link: "l", syncedAt: ago(0), senderName: "Nikolai Townsend", place: "PROJ Devs" } as never).run();
  // A bot is no one.
  mail("m2", "Jira Notification", "jira@example.com");

  const before = listPeople().length;
  assert.ok(findIdentitySuggestions() >= 4);
  assert.equal(listPeople().length, before, "proposals only");
  const open = pendingSuggestions();
  const by = (kind: string, name: string) => open.find((s) => s.kind === kind && s.name.includes(name));
  assert.equal(by("alias", "Lorenz, Chris")?.personId, chris);
  assert.ok((by("alias", "Lorenz, Chris")?.confidence ?? 0) >= 0.9);
  assert.equal(by("alias", "Julia Freidank")?.personId, julia);
  assert.ok(by("person", "Nikolai Townsend"));
  assert.equal(open.some((s) => /notification/i.test(s.name)), false);
  const merge = open.find((s) => s.kind === "merge");
  assert.deepEqual([merge?.personId, merge?.otherId].sort(), [jonas, jonasTwo].sort());
  assert.equal(findIdentitySuggestions(), 0, "nothing twice");

  acceptSuggestion(by("alias", "Lorenz, Chris")!.id);
  assert.ok(getPerson(chris)!.aliases.includes("Lorenz, Chris"));
  rejectSuggestion(by("person", "Nikolai Townsend")!.id);
  acceptSuggestion(merge!.id);
  assert.equal(listPeople().length, before - 1);
  assert.equal(findIdentitySuggestions(), 0, "a rejected one isn't proposed again");
  assert.equal(pendingSuggestions().some((s) => s.name.includes("Nikolai")), false);
});

test("identity: one address written as several names is one person — the address-like and cut-off names count for the real one", async () => {
  const { getDb, getSqlite, schema } = await import("@/db");
  const { findIdentitySuggestions, pendingSuggestions, acceptSuggestion } = await import("@/plugins/people/identity");
  const db = getDb();
  const getSqliteRun = (sql: string, ...args: unknown[]) => getSqlite().prepare(sql).run(...args);
  const mail = (key: string, name: string) => db.insert(schema.emails).values({ key, convId: `c-${key}`, syncedAt: ago(0), folder: "Posteingang", fromName: name, fromEmail: "ogv.nathanael@gvjustiz.de", subject: "DR II 810/26", preview: "y", receivedAt: ago(1) } as never).run();
  // Seven mails, four ways of writing the sender — none reaches four on its own.
  mail("n1", "Obergerichtsvollzieherin Nathanael");
  mail("n2", "Obergerichtsvollzie.");
  mail("n3", "ogv.nathanael");
  mail("n4", "ogv.nathanael");
  for (const k of ["n5", "n6", "n7"]) mail(k, "ogv.nathanael@gvjustiz.de");
  findIdentitySuggestions();
  const found = pendingSuggestions().filter((s) => s.emails.includes("ogv.nathanael@gvjustiz.de"));
  assert.deepEqual(found.map((s) => [s.kind, s.name]), [["person", "Obergerichtsvollzieherin Nathanael"]]);
  assert.match(found[0].evidence, /7×/);

  // A shop's newsletter with a real-looking name: never answered, its address names no one — no person.
  const shop = (key: string) => db.insert(schema.emails).values({ key, convId: `c-${key}`, syncedAt: ago(0), folder: "Posteingang", fromName: "Verivox Kreditangebote", fromEmail: "email@mail.verivox.de", subject: "Angebot", preview: "y", receivedAt: ago(2) } as never).run();
  for (let i = 0; i < 11; i++) shop(`v${i}`);
  // One proposed before that rule: it goes when the next run doesn't make it again.
  getSqliteRun("insert into people_suggestions (key, kind, name, emails, evidence, confidence, created_at) values ('person:xing jobs', 'person', 'XING Jobs', '[\"jobs@mail.xing.com\"]', '5× in mail', 0.75, ?)", ago(1));
  // I wrote back to her, and her letters carry her address: she goes to the top of the queue.
  db.insert(schema.emails).values({ key: "n1r", convId: "c-n1", syncedAt: ago(0), folder: "Gesendet", fromName: "Ich", fromEmail: null, subject: "Re: DR II 810/26", preview: "Sehr geehrte Frau Nathanael", receivedAt: ago(0) } as never).run();
  for (const sha of ["d1", "d2"]) db.insert(schema.documents).values({ name: `${sha}.pdf`, sha256: sha, kind: "pdf", status: "ready", file: `${sha}.pdf`, text: "U. Nathanael, Obergerichtsvollzieherin\nE-Mail: ogv.nathanael@gvjustiz.de", createdAt: ago(3), updatedAt: ago(3) } as never).run();
  findIdentitySuggestions();
  const queue = pendingSuggestions();
  assert.equal(queue.some((s) => /verivox|xing/i.test(s.name)), false, "no shops, also not the one from before");
  const her = queue.find((s) => s.emails.includes("ogv.nathanael@gvjustiz.de"))!;
  assert.equal(queue[0].id, her.id);
  assert.ok(her.confidence >= 0.9);
  assert.match(her.evidence, /9× in mail, documents/);
  assert.match(her.evidence, /you wrote back/);
  // Accepting tells which profile it made — the one to read back for.
  const { getPerson } = await import("@/plugins/people/store");
  const made = acceptSuggestion(found[0].id);
  assert.deepEqual(getPerson(made!)?.emails, ["ogv.nathanael@gvjustiz.de"]);
});
