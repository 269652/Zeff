import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

/** People installed, a profile with a proposed claim, link and date, a stale claim and a name that may be hers. */
async function seed() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("people", true);
  const { getSqlite } = await import("@/db");
  const { createPerson, addDate, listPeople } = await import("@/plugins/people/store");
  const { addClaim, addLink, claimsOf } = await import("@/plugins/people/graph");
  const had = listPeople().find((p) => p.name === "Julia Freidank");
  const julia = had?.id ?? createPerson({ name: "Julia Freidank" });
  if (!had) {
    const rico = createPerson({ name: "Rico Clemen" });
    addClaim({ personId: julia, kind: "role", text: "Leitet das QA-Team", evidence: "„Julia leitet das QA-Team“", confidence: 0.7 });
    addClaim({ personId: julia, kind: "fact", text: "Mag Kaffee", confidence: 0.6 });
    addClaim({ personId: julia, kind: "role", text: "Teamleitung Frontend", status: "confirmed" });
    getSqlite().prepare("update people_claims set expires_at = ? where text = 'Teamleitung Frontend'").run(ago(1));
    addLink({ personId: julia, rel: "works-with", targetType: "person", targetRef: String(rico), evidence: "beide im Thread", confidence: 0.7 });
    addDate(julia, { kind: "birthday", day: 3, month: 5, source: "ai", sourceText: "„am 3. Mai hat Julia Geburtstag“", confirmed: false });
    const { propose } = await import("@/lib/proposals");
    const payload = { personId: julia, otherId: 0, name: "J. Freidank", emails: ["jf@example.com"], jira: "" };
    propose({ source: "people-identity", inputHash: "alias:jf", kind: "alias", subjectRef: `person:${julia}`, payload, why: "same address in mail", confidence: 0.9 });
  }
  return { julia, claim: (text: string) => claimsOf(julia, { status: ["proposed", "confirmed", "rejected"] }).find((c) => c.text === text)! };
}

test("People's queue: identity suggestions, proposed claims and links, claims to check again, dates found — each with its person, evidence and place", async () => {
  const { julia } = await seed();
  const { reviewItems } = await import("@/lib/review");
  const q = await reviewItems();
  const of = (source: string) => q.items.filter((i) => i.source === source);
  assert.equal(of("people-identity").length, 1);
  assert.match(of("people-identity")[0].title, /J\. Freidank.*Julia Freidank/);
  assert.equal(of("people-identity")[0].detail, "same address in mail");
  assert.equal(of("people-identity")[0].confidence, 0.9);
  const claim = of("people-claim").find((i) => i.title.includes("Leitet das QA-Team"))!;
  assert.match(claim.title, /^Julia Freidank/);
  assert.equal(claim.detail, "„Julia leitet das QA-Team“");
  assert.equal(claim.href, (await import("@/plugins/workspace/people-database")).personHref(julia)); // (the person's page, not the /personen redirect)
  assert.deepEqual(claim.actions.map((a) => [a.id, !!a.primary]), [["yes", true], ["no", false]]);
  assert.match(of("people-link")[0].title, /works-with Rico Clemen/);
  assert.match(of("people-stale")[0].title, /Teamleitung Frontend/);
  assert.match(of("people-date")[0].title, /Julia Freidank/);
  assert.equal(of("people-date")[0].detail, "„am 3. Mai hat Julia Geburtstag“");
});

test("a claim's yes confirms it, no rejects it — gone from the queue either way", async () => {
  const { claim } = await seed();
  const { reviewAct, reviewItems } = await import("@/lib/review");
  await reviewAct(`people-claim:${claim("Leitet das QA-Team").id}`, "yes");
  await reviewAct(`people-claim:${claim("Mag Kaffee").id}`, "no");
  assert.equal(claim("Leitet das QA-Team").status, "confirmed");
  assert.equal(claim("Mag Kaffee").status, "rejected");
  assert.equal((await reviewItems()).items.filter((i) => i.source === "people-claim").length, 0);
  await assert.rejects(() => reviewAct(`people-claim:${claim("Mag Kaffee").id}`, "maybe"), /maybe/);
});

test("still true: yes keeps it for another while, a date's yes confirms it, a link's no rejects it", async () => {
  const { julia, claim } = await seed();
  const { reviewAct, reviewItems } = await import("@/lib/review");
  const { datesOf } = await import("@/plugins/people/store");
  const { proposedLinks } = await import("@/plugins/people/graph");
  await reviewAct(`people-stale:${claim("Teamleitung Frontend").id}`, "yes");
  assert.ok(claim("Teamleitung Frontend").expiresAt! > new Date().toISOString());
  await reviewAct(`people-date:${datesOf(julia)[0].id}`, "yes");
  assert.equal(datesOf(julia)[0].confirmed, true);
  await reviewAct(`people-link:${proposedLinks()[0].id}`, "no");
  assert.equal(proposedLinks().length, 0);
  const left = (await reviewItems()).items.filter((i) => ["people-stale", "people-date", "people-link"].includes(i.source));
  assert.deepEqual(left, []);
});

test("an identity suggestion's yes accepts it: the name becomes the profile's alias, the address its", async () => {
  const { julia } = await seed();
  const { reviewAct } = await import("@/lib/review");
  const { pendingSuggestions } = await import("@/plugins/people/identity");
  const { getPerson } = await import("@/plugins/people/store");
  await reviewAct(`people-identity:${pendingSuggestions()[0].id}`, "yes");
  assert.deepEqual(pendingSuggestions(), []);
  assert.ok(getPerson(julia)!.aliases.includes("J. Freidank"));
  assert.ok(getPerson(julia)!.emails.includes("jf@example.com"));
});
