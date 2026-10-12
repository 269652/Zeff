import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
let n = 0;

async function seed() {
  const { getDb, schema } = await import("@/db");
  const db = getDb();
  const mail = (v: Record<string, unknown>) => db.insert(schema.emails).values({ key: `m${++n}`, convId: `c${n}`, syncedAt: ago(0), folder: "Posteingang", ...v } as never).run();
  mail({ fromName: "Julia Freidank", fromEmail: "julia.freidank@example.com", subject: "Test der Navigation", preview: "Kannst du das bitte prüfen? Gruß Julia", receivedAt: ago(2) });
  mail({ fromName: "Altmail Person", fromEmail: "alt@example.com", subject: "Uralt", preview: "vor langer Zeit", receivedAt: ago(40) });
  mail({ fromName: "Jira Notification", fromEmail: "noreply@jira.example.com", subject: "[PPJIRA] Updates", preview: "Systemmail", receivedAt: ago(1) });
  mail({ fromName: "Ich", fromEmail: null, subject: "Re: Test der Navigation", preview: "Mache ich, Danke Julia", receivedAt: ago(2) });
  mail({ fromName: "Lisa Chat", fromEmail: null, convId: "wa:Lisa Chat", folder: "WhatsApp", subject: "Lisa Chat", preview: "Bringst du Brot mit?", receivedAt: ago(3) });
  db.insert(schema.teamsMessages).values({ key: "t1", kind: "chat", conversationId: "x", messageId: "1", sentAt: ago(1), html: "", text: "Nikolai und ich besprechen das morgen", link: "https://teams/x", syncedAt: ago(0), senderName: "Rico Clemen", place: "PROJ Devs" } as never).run();
  db.insert(schema.jiraComments).values({ id: "j1", ticket: "PI-1", author: "Christopher Lorenz", at: ago(4), body: "Warum vier MRs?" } as never).run();
  db.insert(schema.jiraComments).values({ id: "j2", ticket: "PI-1", author: "Vorgestern Vergessen", at: ago(60), body: "alt" } as never).run();
  db.insert(schema.boardRuns).values({ status: "ok", jql: "x", tickets: JSON.stringify([{ key: "PI-1", analyzed: true, people: ["Christopher Lorenz (chrlorenz1)", "Rico Clemen (riccleme)"] }]), result: "{}" } as never).run();
}

test("people are imported from what came in over the last 14 days — the AI picks the real ones; accounts, addresses and chats come along; nobody twice", async () => {
  await seed();
  const { createPerson, listPeople, getPerson } = await import("@/plugins/people/store");
  const { importPeopleFromContext } = await import("@/plugins/people/import");
  const known = createPerson({ name: "Rico Clemen" });
  const prompts: string[] = [];
  const r = await importPeopleFromContext({
    ask: async (prompt) => {
      prompts.push(prompt);
      return {
        people: [
          { name: "Julia Freidank", aliases: ["Julia"], emails: ["julia.freidank@example.com"] },
          { name: "Christopher Lorenz", jira: "chrlorenz1" },
          { name: "Lisa Chat", whatsapp: "Lisa Chat" },
          { name: "Nikolai Townsend", aliases: ["Nikolai"] },
          { name: "Rico Clemen", jira: "riccleme", emails: ["rico@example.com"] }, // there already: enriched, not made twice
        ],
      };
    },
  });
  const prompt = prompts[0];
  for (const seen of ["Julia Freidank", "julia.freidank@example.com", "Rico Clemen", "PROJ Devs", "Christopher Lorenz (chrlorenz1)", "Lisa Chat", "Nikolai und ich"]) assert.match(prompt, new RegExp(seen.replace(/[()]/g, "\\$&")), `${seen} is in what the AI reads`);
  for (const gone of ["Altmail Person", "Uralt", "Vorgestern Vergessen", "noreply@jira.example.com"]) assert.doesNotMatch(prompt, new RegExp(gone), `${gone} is out (old, or a system)`);
  assert.match(prompt, /Rico Clemen/); // the existing profiles are listed, so nobody's made twice
  assert.equal(r.created, 4);
  assert.equal(r.updated, 1);
  const byName = new Map(listPeople().map((p) => [p.name, p]));
  assert.deepEqual(byName.get("Julia Freidank")!.emails, ["julia.freidank@example.com"]);
  assert.deepEqual(byName.get("Julia Freidank")!.aliases, ["Julia"]);
  assert.deepEqual(byName.get("Christopher Lorenz")!.accounts, [{ kind: "jira", value: "chrlorenz1" }]);
  assert.equal(byName.get("Lisa Chat")!.whatsapp, "Lisa Chat");
  const rico = getPerson(known)!;
  assert.deepEqual(rico.accounts, [{ kind: "jira", value: "riccleme" }]);
  assert.deepEqual(rico.emails, ["rico@example.com"]);
  assert.equal(listPeople().filter((p) => p.name === "Rico Clemen").length, 1);
  // Again: nothing new.
  const again = await importPeopleFromContext({ ask: async () => ({ people: [{ name: "Julia Freidank", emails: ["julia.freidank@example.com"] }, { name: "Julia", emails: [] }] }) });
  assert.deepEqual([again.created, again.updated], [0, 0]);
});

test("the AI failing leaves the people as they are, and says why; not you, not systems", async () => {
  const { listPeople } = await import("@/plugins/people/store");
  const { importPeopleFromContext } = await import("@/plugins/people/import");
  const before = listPeople().length;
  await assert.rejects(importPeopleFromContext({ ask: async () => { throw new Error("quota"); } }), /quota/);
  assert.equal(listPeople().length, before);
  const r = await importPeopleFromContext({ ask: async () => ({ people: [{ name: "Ich" }, { name: "Jira Notification" }, { name: "  " }, { name: "X" }] }) });
  assert.equal(r.created, 0);
});
