import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

async function seed() {
  const { getDb, schema } = await import("@/db");
  const { createPerson, addAccount, listPeople } = await import("@/plugins/people/store");
  const had = listPeople().find((p) => p.name === "Julia Freidank");
  if (had) return { julia: had.id, rico: listPeople().find((p) => p.name === "Rico Clemen")!.id };
  const db = getDb();
  const julia = createPerson({ name: "Julia Freidank", aliases: ["Julia"] });
  const rico = createPerson({ name: "Rico Clemen" });
  addAccount(rico, "jira", "ricclem");
  db.insert(schema.boardRuns).values({ status: "ok", jql: "x", tickets: JSON.stringify([{ key: "PC-1", summary: "Navigation", analyzed: true, people: ["Julia Freidank (julfreid)", "Rico Clemen (ricclem)"] }]), result: "{}" } as never).run();
  db.insert(schema.jiraComments).values({ id: "pj1", ticket: "PC-2", author: "Julia Freidank", at: ago(5), body: "Abnahme für die Navigation ist durch, ich schicke die Liste bis Freitag." } as never).run();
  const msg = (key: string, text: string, who = "Rico Clemen", days = 1) =>
    db.insert(schema.teamsMessages).values({ key, kind: "chat", conversationId: "x", messageId: key, sentAt: ago(days), html: "", text, link: "l", syncedAt: ago(0), senderName: who, place: "PROJ Devs" } as never).run();
  msg("t1", "Julia ist bei uns für die Abnahme und das Testing zuständig, sie leitet das QA-Team.");
  msg("t2", "Ich schicke dir die Figma-Nodes bis 2026-10-16, Julia — sag Bescheid, wenn du was brauchst.");
  msg("t3", "ok"); // too short to read
  msg("t4", "Das Wetter ist heute wirklich schön, wollen wir draußen essen?", "Fremder Mensch"); // names no one
  return { julia, rico };
}

test("rules: the tickets, comments and places the sources list become confirmed links — no AI", async () => {
  const { julia, rico } = await seed();
  const { deriveLinks, linksOf, linksTo, whoKnows } = await import("@/plugins/people/graph");
  assert.ok(deriveLinks() >= 3);
  assert.equal(deriveLinks(), 0, "seen again: not new");
  assert.deepEqual(linksOf(julia).map((l) => [l.rel, l.targetRef]).sort(), [["commented-on", "PC-2"], ["on-ticket", "PC-1"]]);
  assert.deepEqual(linksTo("ticket", "PC-1").map((l) => l.personId).sort(), [julia, rico].sort());
  // "Who knows about PC-1?" — the people on it.
  assert.deepEqual(whoKnows("Frage zu PC-1: Navigation").map((e) => e.personId).sort(), [julia, rico].sort());
});

test("extraction: new messages about people become claims and links with a quote and a source — proposals, taught by what you reject", async () => {
  const { julia, rico } = await seed();
  const { extractKnowledge } = await import("@/plugins/people/extract");
  const { claimsOf, linksOf, reviewClaim, proposedClaims, openCommitments, staleClaims, extractionQuality, rejectedExamples, whoKnows } = await import("@/plugins/people/graph");
  const prompts: string[] = [];
  // The ids are given in time order: found by what the message says.
  const idIn = (prompt: string, snippet: string) => new RegExp(String.raw`\[(m\d+)\].*${snippet}`).exec(prompt)?.[1] ?? "m0";
  const answerFor = (prompt: string) => {
    const m1 = idIn(prompt, "Julia ist bei uns");
    const m2 = idIn(prompt, "Figma-Nodes");
    return {
    claims: [
      { person: julia, kind: "owns", text: "Verantwortet Abnahme und Testing, leitet das QA-Team", evidence: "für die Abnahme und das Testing zuständig, sie leitet das QA-Team", source: m1, confidence: 0.92 },
      { person: rico, kind: "commitment", text: "Schickt die Figma-Nodes bis 16.10.", evidence: "Ich schicke dir die Figma-Nodes bis 2026-10-16", source: m2, confidence: 0.9, direction: "theirs", due: "2026-10-16" },
      { person: julia, kind: "fact", text: "Mag Sonnenschein", evidence: "x", source: "m9", confidence: 0.9 }, // no such source: dropped
      { person: julia, kind: "role", text: "Vermutlich Chefin von allem", evidence: "", source: m1, confidence: 0.9 }, // no quote: dropped
      { person: julia, kind: "fact", text: "Unsicher geraten", evidence: "hm", source: m1, confidence: 0.2 }, // too unsure: dropped
      { person: 999, kind: "fact", text: "Jemand anderes ganz", evidence: "hm", source: m1, confidence: 0.9 }, // no such person: dropped
      { person: julia, kind: "commitment", text: "Ohne Richtung", evidence: "hm hm", source: m1, confidence: 0.9 }, // a commitment needs a direction
    ],
    links: [
      { person: julia, rel: "manages", target_type: "person", target: String(rico), evidence: "sie leitet das QA-Team", source: m1, confidence: 0.6 },
      { person: julia, rel: "owns", target_type: "topic", target: "QA", evidence: "sie leitet das QA-Team", source: m1, confidence: 0.9 },
      { person: julia, rel: "owns", target_type: "person", target: "999", evidence: "kaputt", source: m1, confidence: 0.9 }, // target person missing: dropped
    ],
    };
  };
  const r = await extractKnowledge({ ask: async (p) => (prompts.push(p), answerFor(p)) });
  assert.equal(r.ok, true);
  assert.equal(r.items, 3, "only the messages that name or come from someone, and long enough, are read (two Teams messages, a Jira comment)");
  assert.equal(r.claims, 2);
  assert.equal(r.links, 2);
  assert.match(prompts[0], /Julia ist bei uns/);
  assert.doesNotMatch(prompts[0], /Wetter/);
  assert.equal(claimsOf(julia)[0].sourceRef.startsWith("teams:"), true);
  assert.ok(linksOf(julia).some((l) => l.rel === "owns" && l.targetRef === "QA"));
  assert.equal(linksOf(julia).some((l) => l.rel === "manages"), false, "0.6 isn't shown until you confirm it");
  assert.deepEqual(openCommitments().map((c) => [c.personName, c.direction, c.due]), [["Rico Clemen", "theirs", "2026-10-16"]]);

  // Read: the next run has nothing new.
  const again = await extractKnowledge({ ask: async () => (prompts.push("again"), answerFor("")) });
  assert.equal(again.items, 0);
  assert.equal(prompts.includes("again"), false);

  // Your review: a claim rejected is told to the next run; one confirmed is counted.
  const owns = claimsOf(julia).find((c) => c.kind === "owns")!;
  reviewClaim(owns.id, "reject");
  const commitment = proposedClaims().find((c) => c.kind === "commitment")!;
  reviewClaim(commitment.id, "confirm");
  assert.deepEqual(extractionQuality().claims, { confirmed: 1, rejected: 1 });
  assert.match(rejectedExamples().claims.join("\n"), /Verantwortet Abnahme/);
  assert.equal(staleClaims().length, 0);
  assert.equal(whoKnows("Wer macht das QA-Team heute?").map((e) => e.personId).includes(julia), true);

  // A look back reads again — and the AI is told what was rejected.
  prompts.length = 0;
  await extractKnowledge({ ask: async (p) => (prompts.push(p), { claims: [], links: [] }), sinceDays: 7 });
  assert.match(prompts[0], /Abgelehnt/);
  assert.match(prompts[0], /Verantwortet Abnahme/);
  // The same claim again isn't made twice, and a rejected one stays rejected.
  const dup = await extractKnowledge({ ask: async (p) => answerFor(p), sinceDays: 7 });
  assert.equal(dup.claims, 0);
});

test("a merge moves claims and links; a deleted profile takes its own with it", async () => {
  const { createPerson, mergePeople, deletePerson } = await import("@/plugins/people/store");
  const { addClaim, addLink, claimsOf } = await import("@/plugins/people/graph");
  const { getSqlite } = await import("@/db");
  const a = createPerson({ name: "Alpha Eins" });
  const b = createPerson({ name: "Beta Zwei" });
  const c = createPerson({ name: "Gamma Drei" });
  addClaim({ personId: b, kind: "role", text: "Entwicklerin im Team Beta" });
  addLink({ personId: c, rel: "works-with", targetType: "person", targetRef: String(b) });
  mergePeople(a, b);
  assert.equal(claimsOf(a).length, 1);
  assert.equal((getSqlite().prepare("select target_ref from people_links where person_id = ?").get(c) as { target_ref: string }).target_ref, String(a));
  deletePerson(a);
  assert.equal(claimsOf(a).length, 0);
  assert.equal((getSqlite().prepare("select count(*) n from people_links where target_ref = ?").get(String(a)) as { n: number }).n, 0);
});

test("a claim that ages comes back to be checked", async () => {
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim, claimsOf, staleClaims, reviewClaim } = await import("@/plugins/people/graph");
  const { getSqlite } = await import("@/db");
  const p = createPerson({ name: "Alt Rolle" });
  addClaim({ personId: p, kind: "role", text: "Leitet das Backend", status: "confirmed" });
  assert.equal(staleClaims().length, 0);
  getSqlite().prepare("update people_claims set expires_at = ? where person_id = ?").run(ago(1), p);
  assert.equal(staleClaims().length, 1);
  reviewClaim(claimsOf(p)[0].id, "recheck");
  assert.equal(staleClaims().length, 0);
});
