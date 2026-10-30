import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const IBAN_A = "DE22 6609 0800 0007 7773 02";
const IBAN_B = "DE89 3704 0044 0532 0130 00";

async function people() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("people", true);
  return import("@/plugins/people/store");
}
const disputeOf = async (text: string) => (await (await import("@/lib/review")).reviewItems()).items.find((i) => i.source === "trust-dispute" && i.title.includes(text));

test("facts: a fact read again with another value isn't written over — it waits; taken, the fact says the new one (and its claim on the profile follows)", async () => {
  const { addFact, listFacts } = await import("@/lib/facts");
  const { reviewAct } = await import("@/lib/review");
  const a = addFact({ subject: "Karlas Geburtstag", text: "Karla hat am 16.10. Geburtstag", refs: ["mail:k1"] })!;
  // The same day in other words: the same fact, its text and sources updated.
  addFact({ subject: "Karlas Geburtstag", text: "16. Oktober", refs: ["mail:k2"] });
  assert.equal(listFacts().find((f) => f.id === a.id)?.text, "16. Oktober");
  // Another day: not written over.
  const b = addFact({ subject: "Karlas Geburtstag", text: "Karla hat am 18.10. Geburtstag", refs: ["mail:k3"] });
  assert.equal(b?.id, a.id);
  assert.equal(listFacts().find((f) => f.id === a.id)?.text, "16. Oktober");
  const item = await disputeOf("Karlas Geburtstag");
  assert.ok(item);
  assert.match(item!.title, /16\. Oktober/);
  assert.match(item!.title, /18\.10\./);
  await reviewAct(item!.key, "yes");
  const now = listFacts().find((f) => f.id === a.id)!;
  assert.equal(now.text, "Karla hat am 18.10. Geburtstag");
  assert.ok(now.refs.includes("mail:k3"));

  // Kept the old: the fact stays, the new one isn't asked about again.
  addFact({ subject: "Karlas Geburtstag", text: "Karla hat am 20.10. Geburtstag", refs: ["mail:k4"] });
  await reviewAct((await disputeOf("Karlas Geburtstag"))!.key, "no");
  assert.equal(listFacts().find((f) => f.id === a.id)!.text, "Karla hat am 18.10. Geburtstag");
  addFact({ subject: "Karlas Geburtstag", text: "am 20.10.", refs: ["mail:k5"] });
  assert.equal(await disputeOf("Karlas Geburtstag"), undefined);
});

test("facts: a fact about one profile is that person's (person:<id> + birthday) — a second subject naming another day is a contradiction too; the knowledge export has only what holds", async () => {
  const { createPerson } = await people();
  const { addFact, listFacts } = await import("@/lib/facts");
  const { currentFacts } = await import("@/lib/trust/store");
  const lotte = createPerson({ name: "Lotte Brandt" });
  addFact({ subject: "Lotte Brandt Geburtstag", text: "3. März", refs: ["mail:l1"] });
  assert.deepEqual(currentFacts(`person:${lotte}`, "birthday").map((v) => v.value), ["3. März"]);
  addFact({ subject: "Geburtstag von Lotte Brandt", text: "5. März", refs: ["mail:l2"] });
  assert.equal(listFacts().filter((f) => /Lotte/.test(f.subject)).length, 1, "not kept beside it");
  const item = await disputeOf("Lotte Brandt");
  assert.ok(item);
  assert.equal(item!.href, (await import("@/plugins/workspace/people-database")).personHref(lotte)); // (the person's page, not the /personen redirect)

  const { knowledgeDocs } = await import("@/plugins/knowledge/export");
  const facts = knowledgeDocs("http://zeff").docs.filter((d) => d.id.startsWith("zeff:fact:") && /Lotte/.test(d.title));
  assert.equal(facts.length, 1);
  assert.match(facts[0].body, /3\. März/);
  assert.doesNotMatch(facts[0].body, /5\. März/);
});

test("facts: a fact past its time, marked outdated, is gone from the facts (and so from the knowledge)", async () => {
  const { addFact, listFacts } = await import("@/lib/facts");
  const { versionFor, decideVersion } = await import("@/lib/trust/store");
  const f = addFact({ subject: "Wartung Heizung", text: "Nächste Wartung im Mai", refs: ["mail:w1"] })!;
  const v = versionFor("subject:wartung heizung", "text", "Nächste Wartung im Mai")!;
  assert.ok(v);
  await import("@/lib/trust/review");
  decideVersion(v.id, "outdated");
  assert.equal(listFacts().some((x) => x.id === f.id), false);
});

test("details: a second IBAN read for someone waits — consumers (payees, the profile's details) get the one that holds, with its date and source; taken, the old claim is superseded and out of the knowledge", async () => {
  const { createPerson, updatePerson } = await people();
  const { addClaim, claimsOf, reviewClaim } = await import("@/plugins/people/graph");
  const { syncDetails, detailsOf, payees } = await import("@/plugins/people/details");
  const { pendingKnowledge } = await import("@/plugins/people/knowledge-sync");
  const { reviewAct } = await import("@/lib/review");
  const p = createPerson({ name: "Nathanael Gerichtsvollzieher" });
  updatePerson(p, { entityId: 4711 });
  addClaim({ personId: p, kind: "fact", text: `Dienstkonto: IBAN ${IBAN_A}, BIC GENODE61BBB.`, evidence: `IBAN ${IBAN_A}`, sourceRef: "mail:n1", confidence: 0.9 });
  const old = claimsOf(p)[0];
  reviewClaim(old.id, "confirm");
  syncDetails(p);
  addClaim({ personId: p, kind: "fact", text: `Neue Bankverbindung: IBAN ${IBAN_B}`, evidence: "neue Bankverbindung", sourceRef: "doc:9", confidence: 0.9 });
  syncDetails(p);
  const ibans = () => detailsOf(p).filter((d) => d.key === "iban").map((d) => d.value);
  assert.deepEqual(ibans(), [IBAN_A], "the disputed one isn't shown");
  assert.deepEqual(payees().find((x) => x.name === "Nathanael Gerichtsvollzieher")?.details.filter((d) => d.key === "iban").map((d) => d.value), [IBAN_A]);
  const shown = detailsOf(p).find((d) => d.key === "iban")!;
  assert.equal(shown.source, "mail:n1");
  assert.ok(shown.confirmedAt.length >= 10);
  assert.ok(shown.history.some((h) => h.value === IBAN_B && h.status === "disputed"));

  const item = await disputeOf("Nathanael Gerichtsvollzieher");
  assert.ok(item);
  assert.match(item!.detail ?? "", /doc:9/);
  await reviewAct(item!.key, "yes");
  syncDetails(p);
  assert.deepEqual(ibans(), [IBAN_B]);
  assert.ok(detailsOf(p).some((d) => d.key === "bic"), "the old claim's other details stay");
  assert.equal(claimsOf(p, { status: ["superseded"] })[0]?.id, old.id);
  assert.ok(!claimsOf(p).some((c) => c.id === old.id), "a superseded claim isn't among what is known");
  assert.equal(pendingKnowledge().find((e) => e.ref === `claim:${old.id}`)?.text, "", "taken out of the knowledge");
});

test("details: one you add replaces at once; a transfer's account that differs waits; one you removed isn't read again", async () => {
  const { createPerson } = await people();
  const { addDetail, detailsOf, rememberAccount, removeDetail } = await import("@/plugins/people/details");
  const p = createPerson({ name: "Mara Kontoinhaberin" });
  addDetail(p, "iban", IBAN_A);
  addDetail(p, "iban", IBAN_B);
  assert.deepEqual(detailsOf(p).filter((d) => d.key === "iban").map((d) => d.value), [IBAN_B]);
  assert.equal(rememberAccount("Mara Kontoinhaberin", "DE02 1203 0000 0000 2020 51"), null, "not taken without you");
  assert.deepEqual(detailsOf(p).filter((d) => d.key === "iban").map((d) => d.value), [IBAN_B]);
  assert.ok(await disputeOf("Mara Kontoinhaberin"));
  removeDetail(p, "iban", IBAN_B);
  assert.deepEqual(detailsOf(p).filter((d) => d.key === "iban").map((d) => d.value), []);
});

test("people: confirmed claims past their time come back a few a day", async () => {
  const { createPerson } = await people();
  const { getSqlite } = await import("@/db");
  const { addClaim } = await import("@/plugins/people/graph");
  const { reviewItems } = await import("@/lib/review");
  const p = createPerson({ name: "Viele Rollen" });
  for (let i = 0; i < 9; i++) addClaim({ personId: p, kind: "role", text: `Rolle Nummer ${i}`, status: "confirmed" });
  getSqlite().prepare("update people_claims set expires_at = ? where text like 'Rolle Nummer %'").run(new Date(Date.now() - 864e5).toISOString());
  const stale = (await reviewItems()).items.filter((i) => i.source === "people-stale");
  assert.ok(stale.length > 0 && stale.length <= 5, `${stale.length}`);
});

test("repo systems: a prod address the AI picks that differs from the one that holds isn't used — the summary keeps the old one until you decide", async () => {
  const { trustPicks } = await import("@/plugins/knowledge/repo-trust");
  const first = trustPicks(3, "Shop", [
    { env: "prod", label: "Shop", url: "https://shop.example.de", sure: true },
    { env: "test", label: "Stage", url: "https://stage.example.de", sure: true },
  ]);
  assert.deepEqual(first.map((p) => p.url), ["https://shop.example.de", "https://stage.example.de"]);
  const second = trustPicks(3, "Shop", [
    { env: "prod", label: "Shop neu", url: "https://www.new-shop.example.de", sure: true },
    { env: "test", label: "Stage", url: "https://stage.example.de/", sure: true },
    { env: "test", label: "QA", url: "https://qa.example.de", sure: true },
  ]);
  assert.deepEqual(second.map((p) => p.url), ["https://shop.example.de", "https://stage.example.de/", "https://qa.example.de"]);
  const item = await disputeOf("Shop");
  assert.ok(item);
  assert.match(item!.title, /new-shop/);
});

test("consumers: the AI's people search has only the IBAN that holds, with the day it was confirmed", async () => {
  const { createPerson } = await people();
  const { addDetail, rememberAccount } = await import("@/plugins/people/details");
  const { searchPeople } = await import("@/plugins/people/search");
  const p = createPerson({ name: "Suchbar Kontomann" });
  addDetail(p, "iban", IBAN_A);
  rememberAccount("Suchbar Kontomann", IBAN_B);
  const hit = searchPeople(["DE"], { dated: true }).find((h) => h.personId === p)!;
  assert.match(hit.text, /DE22 6609 0800 0007 7773 02 \(bestätigt \d{4}-\d{2}-\d{2}\)/);
  assert.doesNotMatch(hit.text, /DE89/);
});
