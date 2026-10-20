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
  const { getDb, schema } = await import("@/db");
  const { findIdentitySuggestions, pendingSuggestions, acceptSuggestion } = await import("@/plugins/people/identity");
  const db = getDb();
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
  // Accepting tells which profile it made — the one to read back for.
  const { getPerson } = await import("@/plugins/people/store");
  const made = acceptSuggestion(found[0].id);
  assert.deepEqual(getPerson(made!)?.emails, ["ogv.nathanael@gvjustiz.de"]);
});
