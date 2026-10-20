import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Facts, claims, the knowledge: what is known about one person in Zeff's facts reaches their profile, what you confirm reaches the knowledge. */

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("people", true);
  const { createPerson } = await import("@/plugins/people/store");
  return { createPerson };
}

const factClaims = async (personId: number) => (await import("@/plugins/people/graph")).claimsOf(personId, { status: ["proposed", "confirmed", "rejected"] }).filter((c) => c.sourceRef.startsWith("fact:"));

test("facts → people: a fact naming a profile (name, alias, address) becomes a claim of theirs — deduplicated, updated, removed with it", async () => {
  const { createPerson } = await setup();
  const { addFact, deleteFact } = await import("@/lib/facts");
  const { addClaim, claimsOf } = await import("@/plugins/people/graph");
  const ogv = createPerson({ name: "Obergerichtsvollzieherin Nathanael", aliases: ["U. Nathanael"], emails: ["ogv.nathanael@gvjustiz.de"] });
  const jens = createPerson({ name: "Jens Schulz" });
  // What the profile has already, in other words.
  addClaim({ personId: ogv, kind: "fact", text: "Kontoverbindung: IBAN DE02 1203 0000 0000 2020 51 bei der Landesbank", status: "confirmed" });

  const f = addFact({ subject: "Obergerichtsvollzieherin Nathanael Abwesenheit", text: "Nicht im Dienst bis 29.10.2026, Vertretung durch das Amtsgericht", refs: ["mail:m1"] })!;
  let mine = await factClaims(ogv);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].kind, "fact");
  assert.equal(mine[0].sourceRef, `fact:${f.id}`);
  assert.equal(mine[0].status, "proposed", "the mail review's: to confirm");
  assert.match(mine[0].text, /Nicht im Dienst bis 29\.10\.2026/);
  assert.equal((await factClaims(jens)).length, 0);

  // The same subject, a newer text: its claim follows (no second one).
  addFact({ subject: "Obergerichtsvollzieherin Nathanael Abwesenheit", text: "Nicht im Dienst bis 30.10.2026", refs: ["mail:m2"] });
  mine = await factClaims(ogv);
  assert.equal(mine.length, 1);
  assert.match(mine[0].text, /30\.10\.2026/);

  // By an alias, and by the address in the text.
  addFact({ subject: "Zahlung", text: "U. Nathanael bestätigt den Eingang der Rate", refs: [] });
  addFact({ subject: "Kontakt Gerichtsvollzieherin", text: "Erreichbar unter ogv.nathanael@gvjustiz.de", refs: [] });
  assert.equal((await factClaims(ogv)).length, 3);

  // What the profile knows already (in other words) isn't added again.
  addFact({ subject: "Nathanael Bankverbindung", text: "Kontoverbindung IBAN DE02 1203 0000 0000 2020 51 Landesbank", refs: [] });
  assert.equal((await factClaims(ogv)).length, 3);
  assert.equal(claimsOf(ogv).filter((c) => /IBAN/.test(c.text)).length, 1);

  // The same absence, as the extraction wrote it (the same date, other words): not twice.
  const ulrike = createPerson({ name: "Ulrike Nathanael", emails: ["ulrike@example.org"] });
  addClaim({ personId: ulrike, kind: "fact", text: "Urlaub vom 25.09.2026 bis 29.10.2026; E-Mails werden nicht weitergeleitet, in dringenden Fällen ans Amtsgericht wenden.", status: "confirmed" });
  addFact({ subject: "Abwesenheit", text: "Ulrike Nathanael ist nicht im Dienst bis 29.10.2026; E-Mails werden nicht weitergeleitet, dringend an Amtsgericht Freiburg.", refs: [] });
  assert.equal((await factClaims(ulrike)).length, 0);
  // Its subject says what it is about: kept with the text.
  addFact({ subject: "Ulrike Nathanael Sprechzeiten", text: "Dienstags 9 bis 11 Uhr", refs: [] });
  assert.ok((await factClaims(ulrike)).some((c) => c.text === "Ulrike Nathanael Sprechzeiten: Dienstags 9 bis 11 Uhr"));

  // A fact about nobody: no claim.
  addFact({ subject: "Wetter", text: "Am Freitag soll es regnen", refs: [] });
  assert.equal((await factClaims(jens)).length, 0);

  // Deleted: its claim goes.
  deleteFact(f.id);
  assert.equal((await factClaims(ogv)).some((c) => c.sourceRef === `fact:${f.id}`), false);

  // Yours: confirmed at once.
  const own = addFact({ subject: "Jens Schulz", text: "Jens Schulz zieht im November nach Köln", refs: [] }, { fromUser: true })!;
  const jc = await factClaims(jens);
  assert.equal(jc.length, 1);
  assert.equal(jc[0].sourceRef, `fact:${own.id}`);
  assert.equal(jc[0].status, "confirmed");
});

test("facts → people, the sync pass: facts written elsewhere are mirrored, gone ones unmirrored, nothing twice", async () => {
  const { createPerson } = await setup();
  const { getDb, schema } = await import("@/db");
  const { syncFactClaims } = await import("@/plugins/people/synergy");
  const { eq } = await import("drizzle-orm");
  const lotte = createPerson({ name: "Lotte Brandt" });
  const now = new Date().toISOString();
  const row = getDb().insert(schema.facts).values({ subject: "Lotte Brandt Geburtstag", text: "Lotte Brandt hat am 3. März Geburtstag", refs: "[]", createdAt: now, updatedAt: now }).returning().get();
  assert.ok(syncFactClaims() >= 1);
  assert.equal((await factClaims(lotte)).length, 1);
  assert.equal(syncFactClaims(), 0, "nothing twice");
  getDb().delete(schema.facts).where(eq(schema.facts.id, row.id)).run();
  syncFactClaims();
  assert.equal((await factClaims(lotte)).length, 0);
});

test("claims → knowledge: a confirmed claim is queued for the person's entity and sent; the server down, it waits", async () => {
  const { createPerson } = await setup();
  const { updatePerson } = await import("@/plugins/people/store");
  const { addClaim, claimsOf, reviewClaim } = await import("@/plugins/people/graph");
  const { flushKnowledgeOutbox, pendingKnowledge } = await import("@/plugins/people/knowledge-sync");
  const p = createPerson({ name: "Gerda Vollmer" });
  updatePerson(p, { entityId: 2880 });
  addClaim({ personId: p, kind: "fact", text: "Gerda Vollmer ist ab Januar Teamleiterin", evidence: "mail" });
  const c = claimsOf(p)[0];
  reviewClaim(c.id, "confirm");
  reviewClaim(c.id, "confirm");
  assert.equal(pendingKnowledge().length, 1, "once");

  const down = async () => {
    throw new Error("This account's knowledge server isn't answering");
  };
  let r = await flushKnowledgeOutbox({ sendFact: down });
  assert.equal(r.sent, 0);
  assert.equal(pendingKnowledge().length, 1, "kept for the next time");
  assert.equal(pendingKnowledge()[0].attempts, 1);

  const sent: { entityId: number; ref: string; text: string }[] = [];
  const up = async (entityId: number, v: { ref: string; text: string }) => {
    sent.push({ entityId, ...v });
  };
  r = await flushKnowledgeOutbox({ sendFact: up });
  assert.equal(r.sent, 1);
  assert.deepEqual(sent, [{ entityId: 2880, ref: `claim:${c.id}`, text: "Gerda Vollmer ist ab Januar Teamleiterin" }]);
  assert.equal(pendingKnowledge().length, 0);

  // Rejected later: taken out of the knowledge again.
  reviewClaim(c.id, "reject");
  await flushKnowledgeOutbox({ sendFact: up });
  assert.deepEqual(sent[1], { entityId: 2880, ref: `claim:${c.id}`, text: "" });

  // A profile without an entity: it waits until there is one.
  const q = createPerson({ name: "Ohne Eintrag" });
  addClaim({ personId: q, kind: "role", text: "Ohne Eintrag leitet den Verein" });
  reviewClaim(claimsOf(q)[0].id, "confirm");
  r = await flushKnowledgeOutbox({ sendFact: up, entityOf: async () => null });
  assert.equal(r.sent, 0);
  assert.equal(pendingKnowledge().length, 1);
  r = await flushKnowledgeOutbox({ sendFact: up, entityOf: async () => 77 });
  assert.equal(r.sent, 1);
  assert.equal(sent[2].entityId, 77);
});

test("knowledge merge: one profile, several entities — a proposal you confirm merges them in the knowledge; the profile keeps the one", async () => {
  const { createPerson } = await setup();
  const { getPerson, updatePerson } = await import("@/plugins/people/store");
  const { proposeKnowledgeMerge, knowledgeMergeOf, acceptKnowledgeMerge, rejectKnowledgeMerge } = await import("@/plugins/people/knowledge-sync");
  const p = createPerson({ name: "Obergerichtsvollzieherin Nathanael", aliases: ["U. Nathanael"] });
  updatePerson(p, { entityId: 2880 });
  const entities = [
    { id: 2226, name: "U. Nathanael" },
    { id: 2880, name: "Nathanael" },
  ];
  assert.equal(proposeKnowledgeMerge(p, [entities[0]]), null, "one entity: nothing to merge");
  const m = proposeKnowledgeMerge(p, entities)!;
  assert.equal(m.keepId, 2226, "the first (best) one stays");
  assert.deepEqual(m.dropIds, [2880]);
  assert.equal(proposeKnowledgeMerge(p, entities)!.id, m.id, "the same proposal again");
  assert.equal(knowledgeMergeOf(p)?.id, m.id);

  const calls: [number, number[]][] = [];
  await acceptKnowledgeMerge(m.id, async (keep, drop) => {
    calls.push([keep, drop]);
  });
  assert.deepEqual(calls, [[2226, [2880]]]);
  assert.equal(getPerson(p)!.entityId, 2226);
  assert.equal(knowledgeMergeOf(p), null);

  // A rejected one isn't proposed again.
  const q = createPerson({ name: "Karl Heinz" });
  const k = proposeKnowledgeMerge(q, [
    { id: 5, name: "Karl Heinz" },
    { id: 6, name: "Karl-Heinz" },
  ])!;
  rejectKnowledgeMerge(k.id);
  assert.equal(
    proposeKnowledgeMerge(q, [
      { id: 5, name: "Karl Heinz" },
      { id: 6, name: "Karl-Heinz" },
    ]),
    null,
  );
  // The knowledge refusing: the proposal stays, the error comes through.
  const r = createPerson({ name: "Rita Roth" });
  const x = proposeKnowledgeMerge(r, [
    { id: 8, name: "Rita Roth" },
    { id: 9, name: "R. Roth" },
  ])!;
  await assert.rejects(
    acceptKnowledgeMerge(x.id, async () => {
      throw new Error("not found");
    }),
    /not found/,
  );
  assert.equal(knowledgeMergeOf(r)?.id, x.id);
});
