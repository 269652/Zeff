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
