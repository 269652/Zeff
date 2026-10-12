import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

async function run(people: string[]) {
  const { getDb, schema } = await import("@/db");
  getDb().insert(schema.boardRuns).values({ status: "ok", jql: "x", tickets: JSON.stringify([{ key: "JR-1", analyzed: true, people }]), result: "{}" } as never).run();
}

test("names are compared the way people write them: umlauts, case, 'Last, First', and a letter off", async () => {
  const { normalizeName, nameSimilar } = await import("@/plugins/people/accounts");
  assert.equal(normalizeName("Jonas Teichrüb"), "jonas teichrueb");
  assert.equal(normalizeName("Teichrueb, Jonas"), "jonas teichrueb");
  assert.equal(normalizeName("  Dr. Anna  Groß "), "anna gross");
  assert.ok(nameSimilar("Jonas Teichrueb", "Jonas Teichrüb"));
  assert.ok(nameSimilar("Jonas Teichrueb", "Teichrueb, Jonas"));
  assert.ok(nameSimilar("Christopher Lorenz", "Christoper Lorenz"), "one letter off");
  assert.ok(!nameSimilar("Jonas Teichrueb", "Jonas Teichmann"));
  assert.ok(!nameSimilar("Jan Roth", "Jon Rot"), "short names have to match");
});

test("Jira usernames here are the first three letters of the first name and the first five of the last — candidates follow that, with the digit for a second one", async () => {
  const { usernameCandidates } = await import("@/plugins/people/accounts");
  assert.deepEqual(usernameCandidates("Jonas Teichrueb").slice(0, 3), ["jonteich", "jonteich1", "jonteich2"]);
  assert.equal(usernameCandidates("Christopher Lorenz")[0], "chrlorenz");
  assert.equal(usernameCandidates("Rico Clemen")[0], "riccleme");
  assert.equal(usernameCandidates("Anna Groß")[0], "anngross");
  assert.equal(usernameCandidates("Lisa")[0], undefined, "one word: nothing to go by");
});

test("a Jira user listed under a slightly different spelling is still tied to the profile", async () => {
  const { createPerson, getPerson } = await import("@/plugins/people/store");
  const { linkJiraAccounts } = await import("@/plugins/people/accounts");
  await run(["Jonas Teichrüb (jonteich)", "Anna Beispiel (annbeisp)", "Anne Beispiel (anebeisp)"]);
  const jonas = createPerson({ name: "Jonas Teichrueb" });
  const anna = createPerson({ name: "Anna Beispiel" });
  assert.equal(linkJiraAccounts() >= 2, true);
  assert.deepEqual(getPerson(jonas)!.accounts, [{ kind: "jira", value: "jonteich" }]);
  assert.deepEqual(getPerson(anna)!.accounts, [{ kind: "jira", value: "annbeisp" }], "the exact name wins over the near one");
});

test("whoever Zeff hasn't seen on a ticket is looked up in Jira by the username candidates — and only taken when Jira's name for it fits", async () => {
  const { createPerson, getPerson } = await import("@/plugins/people/store");
  const { resolveJiraAccounts } = await import("@/plugins/people/accounts");
  const mara = createPerson({ name: "Mara Verlorenname" });
  const otto = createPerson({ name: "Otto Anderswo" });
  const known = createPerson({ name: "Schon Verknuepft" });
  const { addAccount } = await import("@/plugins/people/store");
  addAccount(known, "jira", "schverkn");
  const asked: string[] = [];
  const lookup = async (username: string) => {
    asked.push(username);
    if (username === "marverlo1") return { username, displayName: "Mara Verlorenname" }; // the second one of that pattern
    if (username === "otoander") return { username, displayName: "Otto Andersson" }; // a different person with that username
    return null;
  };
  const r = await resolveJiraAccounts({ lookup });
  assert.deepEqual(getPerson(mara)!.accounts, [{ kind: "jira", value: "marverlo1" }]);
  assert.deepEqual(getPerson(otto)!.accounts, [], "the username exists, but it's someone else's");
  assert.ok(!asked.some((a) => a.startsWith("schverkn")), "those with an account aren't looked up");
  assert.equal(asked.indexOf("marverlo") < asked.indexOf("marverlo1"), true, "in the order of the pattern");
  assert.equal(r.linked >= 1, true);
  // Only some people: the others aren't asked about.
  const before = asked.length;
  await resolveJiraAccounts({ lookup, ids: [known] });
  assert.equal(asked.length, before);
});
