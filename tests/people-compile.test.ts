import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

async function seed() {
  const { getDb, schema } = await import("@/db");
  const { createPerson, addDate, addAccount } = await import("@/plugins/people/store");
  const db = getDb();
  const julia = createPerson({ name: "Julia Freidank", aliases: ["Julia"], emails: ["julia.freidank@example.com"] });
  addAccount(julia, "jira", "julfreid");
  addDate(julia, { kind: "birthday", day: 16, month: 10, year: 1990, yearly: true, source: "manual", confirmed: true });
  const quiet = createPerson({ name: "Ruhiger Mensch" });
  db.insert(schema.emails).values({ key: "pc1", convId: "c-pc1", syncedAt: ago(0), folder: "Posteingang", fromName: "Julia Freidank", fromEmail: "julia.freidank@example.com", subject: "Test der Navigation", preview: "Ich teste am liebsten am Freitag, danach geht's zum Klettern.", receivedAt: ago(3) } as never).run();
  db.insert(schema.teamsMessages).values({ key: "pt1", kind: "chat", conversationId: "x", messageId: "1", sentAt: ago(2), html: "", text: "Julia testet die Storybook-Stories", link: "https://teams/x", syncedAt: ago(0), senderName: "Rico Clemen", place: "PROJ Devs" } as never).run();
  db.insert(schema.jiraComments).values({ id: "pj1", ticket: "PC-1", author: "Julia Freidank", at: ago(5), body: "Abnahme für die Navigation ist durch." } as never).run();
  db.insert(schema.boardRuns).values({ status: "ok", jql: "x", tickets: JSON.stringify([{ key: "PC-1", summary: "Navigation", analyzed: true, people: ["Julia Freidank (julfreid)"] }]), result: "{}" } as never).run();
  db.insert(schema.facts).values({ subject: "Julias Hobby", text: "Julia klettert und fährt gern Rennrad", createdAt: ago(9), updatedAt: ago(9) } as never).run();
  const { addFollowUp } = await import("@/lib/boards/store");
  addFollowUp({ ticket: "PC-1", text: "Mit Julia die Abnahme der Navigation klären", kind: "clarify", parentId: null as unknown as number, workRunId: null, source: "test" });
  return { julia, quiet };
}

test("a person's summary is compiled from everything Zeff has on them: what connects you, key facts, fun facts — and kept", async () => {
  const { julia } = await seed();
  const { compilePerson } = await import("@/plugins/people/compile");
  const { getPerson } = await import("@/plugins/people/store");
  const prompts: string[] = [];
  const r = await compilePerson(julia, {
    ask: async (prompt) => (
      prompts.push(prompt),
      { connection: "Ihr arbeitet beide an der Navigation (PC-1); sie nimmt ab, du baust.", keyFacts: ["Testet und nimmt Tickets ab", "Jira: julfreid"], funFacts: ["Klettert gern", "Fährt Rennrad"] }
    ),
  });
  assert.equal(r.state, "compiled");
  const p = prompts[0];
  for (const seen of ["Julia Freidank", "Test der Navigation", "Klettern", "Julia testet die Storybook-Stories", "Abnahme für die Navigation ist durch", "PC-1", "julfreid", "Julia klettert und fährt gern Rennrad", "Mit Julia die Abnahme der Navigation klären", "16.10."]) assert.match(p, new RegExp(seen.replace(/[.()]/g, "\\$&")), `${seen} is in the evidence`);
  const s = getPerson(julia)!.compiled!;
  assert.match(s.connection, /Navigation/);
  assert.deepEqual(s.keyFacts, ["Testet und nimmt Tickets ab", "Jira: julfreid"]);
  assert.deepEqual(s.funFacts, ["Klettert gern", "Fährt Rennrad"]);
  assert.ok(s.at);
});

test("someone Zeff knows nothing about isn't sent to the AI; a fresh summary isn't compiled again unless forced", async () => {
  const { compilePerson, compileAll } = await import("@/plugins/people/compile");
  const { listPeople } = await import("@/plugins/people/store");
  const quiet = listPeople().find((p) => p.name === "Ruhiger Mensch")!;
  let asked = 0;
  const ask = async () => (asked++, { connection: "x", keyFacts: [], funFacts: [] });
  const r = await compilePerson(quiet.id, { ask });
  assert.equal(r.state, "nothing-known");
  assert.equal(asked, 0);
  // Julia was compiled a moment ago: all together, only the ones that need it.
  const all = await compileAll({ ask });
  assert.deepEqual([all.compiled, all.skipped, all.failed.length], [0, 2, 0]);
  assert.equal(asked, 0);
  const forced = await compileAll({ ask, force: true });
  assert.equal(forced.compiled, 1, "Julia, again — Ruhiger Mensch still has nothing");
  assert.equal(asked, 1);
});

test("one person failing doesn't stop the rest, and says who and why", async () => {
  const { createPerson } = await import("@/plugins/people/store");
  const { compileAll } = await import("@/plugins/people/compile");
  const { getDb, schema } = await import("@/db");
  const anna = createPerson({ name: "Anna Evidenz" });
  const berta = createPerson({ name: "Berta Evidenz" });
  for (const n of ["Anna Evidenz", "Berta Evidenz"]) getDb().insert(schema.jiraComments).values({ id: `pe-${n}`, ticket: "PC-2", author: n, at: ago(1), body: "hallo" } as never).run();
  const r = await compileAll({
    force: true,
    ask: async (prompt) => {
      if (/Anna Evidenz/.test(prompt) && !/Berta Evidenz/.test(prompt.split("# Meine Person")[1] ?? "")) throw new Error("quota");
      return { connection: "ok", keyFacts: [], funFacts: [] };
    },
  });
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0], /Anna Evidenz.*quota/);
  assert.ok(r.compiled >= 1);
  const { getPerson } = await import("@/plugins/people/store");
  assert.equal(getPerson(anna)!.compiled, null);
  assert.equal(getPerson(berta)!.compiled?.connection, "ok");
});
