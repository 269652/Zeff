import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("details: a bank account, addresses, a phone and office hours read off what was said about someone — the IBAN only with its check digits right", async () => {
  const { detailsFromText } = await import("@/plugins/people/details");
  const pick = (text: string) => detailsFromText(text).map((d) => `${d.key}: ${d.value}`);
  assert.deepEqual(pick("Dienstkonto für Zahlungen: Empfänger Nathanael Dienstkonto, IBAN DE22 6609 0800 0007 7773 02, BIC GENODE61BBB, Bank BBBank Karlsruhe; Verwendungszweck ist das jeweilige Aktenzeichen."), [
    "iban: DE22 6609 0800 0007 7773 02",
    "bic: GENODE61BBB",
    "bank: BBBank Karlsruhe",
  ]);
  // The bank without "Bank" before it.
  assert.deepEqual(pick("Konto: IBAN DE22 6609 0800 0007 7773 02, BIC GENODE61BBB, BBBank Karlsruhe; Zahlungen mit Aktenzeichen."), [
    "iban: DE22 6609 0800 0007 7773 02",
    "bic: GENODE61BBB",
    "bank: BBBank Karlsruhe",
  ]);
  assert.deepEqual(pick("Kontakt: E-Mail ogv.nathanael@gvjustiz.de; Dienstadresse Amtsgericht Freiburg, Kaiser-Joseph-Straße 257a, 79098 Freiburg im Breisgau."), ["address: Kaiser-Joseph-Straße 257a, 79098 Freiburg im Breisgau"]);
  assert.deepEqual(pick("Sprechstunden Montag und Mittwoch 10:00–11:00 Uhr im Sprechzeitenbüro Luisenstraße 2, 79098 Freiburg; Telefon 0172 3420865; E-Mail ogv.nathanael@gvjustiz.de."), [
    "address: Luisenstraße 2, 79098 Freiburg",
    "phone: 0172 3420865",
    "hours: Montag und Mittwoch 10:00–11:00 Uhr",
  ]);
  // A wrong check digit is no IBAN; a file number or an amount is nothing.
  assert.deepEqual(pick("IBAN DE23 6609 0800 0007 7773 02"), []);
  assert.deepEqual(pick("Verfahren DR II 1121/26: 12 Raten à 300 €, erste am 20.10.2026."), []);
});

test("details: kept with the profile from what was read — a rejected claim takes its detail along, one you removed doesn't come back, one you add stays", async () => {
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim, claimsOf, reviewClaim } = await import("@/plugins/people/graph");
  const { syncDetails, detailsOf, removeDetail, addDetail } = await import("@/plugins/people/details");
  const p = createPerson({ name: "Ulla Nathanael" });
  addClaim({ personId: p, kind: "fact", text: "Dienstkonto: IBAN DE22 6609 0800 0007 7773 02, BIC GENODE61BBB, Bank BBBank Karlsruhe.", evidence: "IBAN: DE22 6609 0800 0007 7773 02", sourceRef: "doc:1", confidence: 0.9 });
  addClaim({ personId: p, kind: "fact", text: "Sprechzeitenbüro Luisenstraße 2, 79098 Freiburg; Telefon 0172 3420865.", evidence: "Telefon 0172 3420865", sourceRef: "doc:1", confidence: 0.9 });
  syncDetails(p);
  const keys = () => detailsOf(p).map((d) => `${d.key}: ${d.value}`);
  assert.deepEqual(keys(), ["iban: DE22 6609 0800 0007 7773 02", "bic: GENODE61BBB", "bank: BBBank Karlsruhe", "address: Luisenstraße 2, 79098 Freiburg", "phone: 0172 3420865"]);
  assert.equal(detailsOf(p)[0].confirmed, false, "from a claim not checked yet");
  const [bank, office] = claimsOf(p).sort((a, b) => a.id - b.id);
  reviewClaim(bank.id, "confirm");
  syncDetails(p);
  assert.equal(detailsOf(p)[0].confirmed, true);
  reviewClaim(office.id, "reject");
  syncDetails(p);
  assert.deepEqual(keys(), ["iban: DE22 6609 0800 0007 7773 02", "bic: GENODE61BBB", "bank: BBBank Karlsruhe"]);
  removeDetail(p, "bic", "GENODE61BBB");
  syncDetails(p);
  assert.equal(keys().includes("bic: GENODE61BBB"), false, "removed stays removed");
  addDetail(p, "phone", " 0761 123456 ");
  syncDetails(p);
  assert.ok(keys().includes("phone: 0761 123456"));
  assert.equal(detailsOf(p).find((d) => d.key === "phone")?.confirmed, true, "yours is confirmed");
});

test("details: a RevTag — after RevTag or Revolut, or as a revolut.me link — kept as @tag; a mail address or an @-mention without Revolut is none", async () => {
  const { detailsFromText } = await import("@/plugins/people/details");
  const pick = (text: string) => detailsFromText(text).map((d) => `${d.key}: ${d.value}`);
  assert.deepEqual(pick("Chris' RevTag ist @Chris.B."), ["revtag: @chris.b"]);
  assert.deepEqual(pick("Revolut: @chrisb93"), ["revtag: @chrisb93"]);
  assert.deepEqual(pick("Zahlen geht über https://revolut.me/chrisb93"), ["revtag: @chrisb93"]);
  assert.deepEqual(pick("Mail an chris@example.org, im Chat @chris erwähnt"), []);
  // Called a RevTag, the @ may be missing.
  assert.deepEqual(pick("Chris' RevTag ist christu8gw."), ["revtag: @christu8gw"]);
  assert.deepEqual(pick("RevTag von Chris: christu8gw"), ["revtag: @christu8gw"]);
  assert.deepEqual(pick("Revolut Support hat geantwortet"), [], "a word after Revolut is no tag");
});

test("the Revolut action: a payment by RevTag opens their revolut.me page — never without a tag", async () => {
  const { REVOLUT_ACTIONS, revtagOf } = await import("@/plugins/revolut/actions");
  const a = REVOLUT_ACTIONS[0];
  const op = a.clean({ name: "Chris Ballhaus", revtag: "@ChrisB93", amount: "150 €", note: "Zurück, danke!" }, { ticket: "" })!;
  assert.deepEqual(op, { type: "revolut-pay", name: "Chris Ballhaus", revtag: "chrisb93", amount: "150.00", note: "Zurück, danke!" });
  assert.equal(a.href!(op), "https://revolut.me/chrisb93?currency=EUR&amount=15000&note=Zur%C3%BCck%2C%20danke%21", "amount (in cents) and note in the link");
  assert.equal(a.href!({ ...op, amount: "", note: "" }), "https://revolut.me/chrisb93?currency=EUR");
  assert.equal(new URL(a.href!({ ...op, note: "x".repeat(80) })).searchParams.get("note")!.length, 64, "the note at most 64 characters");
  assert.match(a.title(op), /150,00 €.*Chris Ballhaus/);
  assert.equal(a.clean({ name: "Chris", revtag: "" }, { ticket: "" }), null);
  assert.equal(revtagOf("revolut.me/chrisb93?x=1"), "chrisb93");
});

test("the phones' codes: past the Revolut app (it drops the amount and the note) into the browser — Safari on an iPhone, Chrome on Android — with the same page", async () => {
  const { revolutLink, revolutPhoneLinks } = await import("@/plugins/revolut/actions");
  const web = revolutLink("chrisb93", "150.00", "Zurück, danke!");
  const { ios, android } = revolutPhoneLinks("chrisb93", "150.00", "Zurück, danke!");
  assert.equal(ios, `x-safari-${web}`);
  assert.ok(android.startsWith(`intent://revolut.me/chrisb93?${web.split("?")[1]}#Intent;scheme=https;package=com.android.chrome;`));
  assert.ok(android.endsWith(`S.browser_fallback_url=${encodeURIComponent(web)};end`), "no Chrome: the page as it is");
});
