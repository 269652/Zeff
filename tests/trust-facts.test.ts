import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

test("trust: values compared as what they mean — IBAN spacing and case, dates in any spelling, URLs without scheme or slash, phone prefixes, street spellings", async () => {
  const { sameValue, normalizeValue } = await import("@/lib/trust/normalize");
  assert.equal(normalizeValue("iban", "de22 6609 0800 0007 7773 02"), "DE22660908000007777302");
  assert.ok(sameValue("iban", "DE22 6609 0800 0007 7773 02", "de22660908000007777302"));
  assert.ok(!sameValue("iban", "DE22 6609 0800 0007 7773 02", "DE89 3704 0044 0532 0130 00"));
  assert.ok(sameValue("birthday", "16.10.", "16. Oktober"));
  assert.ok(sameValue("birthday", "16.10.1990", "1990-10-16"));
  assert.ok(sameValue("birthday", "16.10.", "16.10.1990"), "a year added is no other day");
  assert.ok(!sameValue("birthday", "16.10.", "17.10."));
  assert.ok(sameValue("prod-url", "https://Shop.Example.de/", "http://shop.example.de"));
  assert.ok(!sameValue("prod-url", "https://shop.example.de", "https://stage.shop.example.de"));
  assert.ok(sameValue("phone", "+49 172 3420865", "0172 3420865"));
  assert.ok(sameValue("address", "Luisenstr. 2, 79098 Freiburg", "Luisenstraße 2 79098 freiburg"));
  assert.ok(sameValue("revtag", "@Chris.B", "chris.b"));
  // A free text: the dates in it decide; without any, mostly the same words.
  assert.ok(sameValue("absence", "Nicht im Dienst bis 29.10.2026", "Urlaub bis 29.10.2026, nicht im Dienst"));
  assert.ok(!sameValue("absence", "Nicht im Dienst bis 29.10.2026", "Nicht im Dienst bis 05.11.2026"));
  assert.ok(sameValue("text", "Trinkt gern grünen Tee am Morgen", "trinkt gern grünen Tee am Morgen!"));
});

test("trust: what a fact is about and which kind it is — read off a fact's subject; birthdays never go stale, roles and addresses do", async () => {
  const { attributeOfSubject, shelfLife } = await import("@/lib/trust/normalize");
  assert.equal(attributeOfSubject("Nadines Geburtstag"), "birthday");
  assert.equal(attributeOfSubject("IBAN von Nathanael"), "iban");
  assert.equal(attributeOfSubject("Nathanael Abwesenheit"), "absence");
  assert.equal(attributeOfSubject("Lieblingsessen von Karla"), "text");
  assert.equal(shelfLife("birthday"), null);
  assert.ok((shelfLife("address") ?? 0) > 0);
  assert.ok((shelfLife("role") ?? 0) > 0);
});

test("trust: a value seen again is confirmed, another one for the same thing is disputed — not written over — and waits in the review queue with both sources", async () => {
  const { recordFact, versionsOf, currentFacts } = await import("@/lib/trust/store");
  const a = recordFact({ subject: "person:900", subjectLabel: "Nathanael", attribute: "iban", value: "DE22 6609 0800 0007 7773 02", writer: "test", sourceRef: "mail:a", quote: "IBAN DE22 6609 …" });
  assert.equal(a.outcome, "added");
  assert.equal(a.version.status, "current");
  const again = recordFact({ subject: "person:900", subjectLabel: "Nathanael", attribute: "iban", value: "de22660908000007777302", writer: "test", sourceRef: "mail:b" });
  assert.equal(again.outcome, "same");
  assert.equal(again.version.id, a.version.id);
  const b = recordFact({ subject: "person:900", subjectLabel: "Nathanael", attribute: "iban", value: "DE89 3704 0044 0532 0130 00", writer: "test", sourceRef: "doc:7", quote: "neue Bankverbindung", link: "/documents/7" });
  assert.equal(b.outcome, "disputed");
  assert.deepEqual(currentFacts("person:900").map((v) => v.value), ["DE22 6609 0800 0007 7773 02"], "the old one stays current");
  assert.equal(versionsOf("person:900", "iban").length, 2);

  const { reviewItems } = await import("@/lib/review");
  const item = (await reviewItems()).items.find((i) => i.source === "trust-dispute");
  assert.ok(item, "a review item");
  assert.match(item!.title, /IBAN/);
  assert.match(item!.title, /Nathanael/);
  assert.match(item!.title, /DE22 6609/);
  assert.match(item!.title, /DE89 3704/);
  assert.match(item!.detail ?? "", /mail:a/);
  assert.match(item!.detail ?? "", /doc:7/);
  assert.deepEqual(item!.actions.map((x) => x.id), ["yes", "no", "both"]);
  assert.equal(item!.href, (await import("@/plugins/workspace/people-database")).personHref(900)); // (the person's page, not the /personen redirect)

  // Seen again, the disputed one stays disputed: no second item.
  assert.equal(recordFact({ subject: "person:900", attribute: "iban", value: "DE89370400440532013000", writer: "test", sourceRef: "doc:8" }).outcome, "disputed");
  assert.equal((await reviewItems()).items.filter((i) => i.source === "trust-dispute").length, 1);
});

test("trust: the decisions — take the new one (the old superseded), keep the old (the new rejected, not asked again), both valid (both current)", async () => {
  const { recordFact, currentFacts, versionsOf } = await import("@/lib/trust/store");
  const { reviewAct, reviewItems } = await import("@/lib/review");
  const dispute = async (subject: string) => (await reviewItems()).items.find((i) => i.source === "trust-dispute" && i.title.includes(subject))!;

  recordFact({ subject: "person:901", subjectLabel: "Anna", attribute: "address", value: "Luisenstraße 2, 79098 Freiburg", writer: "test", sourceRef: "mail:1" });
  recordFact({ subject: "person:901", subjectLabel: "Anna", attribute: "address", value: "Hauptstraße 5, 79100 Freiburg", writer: "test", sourceRef: "mail:2" });
  await reviewAct((await dispute("Anna")).key, "yes");
  assert.deepEqual(currentFacts("person:901").map((v) => v.value), ["Hauptstraße 5, 79100 Freiburg"]);
  assert.equal(versionsOf("person:901", "address").find((v) => v.value.startsWith("Luisen"))?.status, "superseded");
  // The old one read again doesn't come back.
  assert.equal(recordFact({ subject: "person:901", attribute: "address", value: "Luisenstr. 2, 79098 Freiburg", writer: "test", sourceRef: "mail:3" }).outcome, "superseded");

  recordFact({ subject: "person:902", subjectLabel: "Bert", attribute: "iban", value: "DE22 6609 0800 0007 7773 02", writer: "test", sourceRef: "mail:1" });
  recordFact({ subject: "person:902", subjectLabel: "Bert", attribute: "iban", value: "DE89 3704 0044 0532 0130 00", writer: "test", sourceRef: "mail:2" });
  await reviewAct((await dispute("Bert")).key, "no");
  assert.deepEqual(currentFacts("person:902").map((v) => v.value), ["DE22 6609 0800 0007 7773 02"]);
  assert.equal(recordFact({ subject: "person:902", attribute: "iban", value: "DE89370400440532013000", writer: "test", sourceRef: "mail:9" }).outcome, "rejected");
  assert.equal((await reviewItems()).items.filter((i) => i.source === "trust-dispute" && i.title.includes("Bert")).length, 0);

  recordFact({ subject: "person:903", subjectLabel: "Cleo", attribute: "iban", value: "DE22 6609 0800 0007 7773 02", writer: "test", sourceRef: "mail:1" });
  recordFact({ subject: "person:903", subjectLabel: "Cleo", attribute: "iban", value: "DE89 3704 0044 0532 0130 00", writer: "test", sourceRef: "mail:2" });
  await reviewAct((await dispute("Cleo")).key, "both");
  assert.equal(currentFacts("person:903").length, 2);
});

test("trust: what you say yourself replaces at once; values of a kind that has several (phones) never dispute each other", async () => {
  const { recordFact, currentFacts, versionsOf } = await import("@/lib/trust/store");
  recordFact({ subject: "person:904", attribute: "iban", value: "DE22 6609 0800 0007 7773 02", writer: "test", sourceRef: "mail:1" });
  assert.equal(recordFact({ subject: "person:904", attribute: "iban", value: "DE89 3704 0044 0532 0130 00", writer: "test", byUser: true }).outcome, "added");
  assert.deepEqual(currentFacts("person:904").map((v) => v.value), ["DE89 3704 0044 0532 0130 00"]);
  assert.equal(versionsOf("person:904", "iban").find((v) => v.value.startsWith("DE22"))?.status, "superseded");
  recordFact({ subject: "person:904", attribute: "phone", value: "0172 3420865", writer: "test", sourceRef: "mail:1" });
  assert.equal(recordFact({ subject: "person:904", attribute: "phone", value: "0761 123456", writer: "test", sourceRef: "mail:2" }).outcome, "added");
});

test("trust: facts past their shelf life come back as “still true?” — a few a day, the rest on the next days; birthdays never", async () => {
  const { getSqlite } = await import("@/db");
  const { recordFact, staleBatch, decideVersion } = await import("@/lib/trust/store");
  for (let i = 0; i < 7; i++) recordFact({ subject: `person:${950 + i}`, attribute: "address", value: `Weg ${i}, 79098 Freiburg`, writer: "test", sourceRef: "mail:x" });
  recordFact({ subject: "person:960", attribute: "birthday", value: "16.10.", writer: "test", sourceRef: "mail:x" });
  getSqlite().prepare("update fact_versions set confirmed_at = ?, expires_at = ? where subject like 'person:95%'").run(ago(400), ago(35));
  getSqlite().prepare("update fact_versions set confirmed_at = ? where subject = 'person:960'").run(ago(4000));
  const day1 = new Date();
  const first = staleBatch({ now: day1, cap: 3 });
  assert.equal(first.length, 3);
  assert.deepEqual(staleBatch({ now: day1, cap: 3 }).map((v) => v.id), first.map((v) => v.id), "the same ones all day");
  // One answered: no new one before tomorrow.
  decideVersion(first[0].id, "still");
  assert.equal(staleBatch({ now: day1, cap: 3 }).length, 2);
  const day2 = new Date(day1.getTime() + 864e5);
  const second = staleBatch({ now: day2, cap: 3 });
  assert.equal(second.length, 3, "yesterday's two still open, one new");
  assert.ok(!second.some((v) => v.subject === "person:960"), "a birthday doesn't go stale");

  const { reviewItems } = await import("@/lib/review");
  const stale = (await reviewItems()).items.filter((i) => i.source === "trust-stale");
  assert.ok(stale.length > 0 && stale.length <= 5);
  assert.deepEqual(stale[0].actions.map((a) => a.id), ["yes", "no"]);
});

test("trust: a daily batch of anything — the people's claims to check again too — at most a few new a day", async () => {
  const { dailyBatch } = await import("@/lib/trust/store");
  const items = Array.from({ length: 10 }, (_, i) => ({ id: i }));
  const now = new Date("2026-10-22T10:00:00Z");
  assert.deepEqual(dailyBatch("test-kind", items, (x) => String(x.id), { cap: 4, now }).map((x) => x.id), [0, 1, 2, 3]);
  assert.deepEqual(dailyBatch("test-kind", items.slice(2), (x) => String(x.id), { cap: 4, now }).map((x) => x.id), [2, 3]);
  assert.deepEqual(dailyBatch("test-kind", items.slice(2), (x) => String(x.id), { cap: 4, now: new Date("2026-10-23T10:00:00Z") }).map((x) => x.id), [2, 3, 4, 5]);
});
