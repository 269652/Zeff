import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("absence: 'Urlaub … bis', 'nicht im Dienst bis', 'abwesend bis' with a date — only while that day hasn't passed", async () => {
  const { absenceIn } = await import("@/plugins/people/absence");
  const today = "2026-10-20";
  assert.deepEqual(absenceIn("Ist im Urlaub bis 31.10.2026, Vertretung Herr Kruger.", today), { until: "2026-10-31" });
  assert.deepEqual(absenceIn("Urlaub vom 12.10. bis einschließlich 2.11.2026", today), { until: "2026-11-02" });
  assert.deepEqual(absenceIn("Nicht im Dienst bis 20.10.2026.", today), { until: "2026-10-20" }, "today still counts");
  assert.deepEqual(absenceIn("abwesend bis zum 5.1.2027", today), { until: "2027-01-05" });
  assert.deepEqual(absenceIn("Abwesend bis 21.10.26 (Fortbildung)", today), { until: "2026-10-21" }, "a two-digit year");
  assert.equal(absenceIn("Im Urlaub bis 19.10.2026.", today), null, "over");
  assert.equal(absenceIn("Sprechstunden Montag bis Mittwoch 10–11 Uhr", today), null);
  assert.equal(absenceIn("Zahlung bis 31.10.2026 fällig", today), null, "a deadline is no absence");
  assert.equal(absenceIn("Urlaub bis 31.02.2026", today), null, "no such day");
});

test("person card: the role first, up to three details (phone, address, IBAN), open commitments with them and whether they are away", async () => {
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim, claimsOf, reviewClaim } = await import("@/plugins/people/graph");
  const { personCardExtras } = await import("@/plugins/people/card");
  const id = createPerson({ name: "Ulla Nathanael" });
  const other = createPerson({ name: "Hans Kruger" });
  addClaim({ personId: id, kind: "role", text: "Gerichtsvollzieherin (vermutet)", confidence: 0.6 });
  addClaim({ personId: id, kind: "role", text: "Obergerichtsvollzieherin am Amtsgericht Freiburg", confidence: 0.7 });
  reviewClaim(claimsOf(id).find((c) => c.text.startsWith("Ober"))!.id, "confirm");
  addClaim({ personId: id, kind: "fact", text: "Dienstkonto: IBAN DE22 6609 0800 0007 7773 02, BIC GENODE61BBB, Bank BBBank Karlsruhe.", confidence: 0.9 });
  addClaim({ personId: id, kind: "fact", text: "Sprechzeitenbüro Luisenstraße 2, 79098 Freiburg; Telefon 0172 3420865.", confidence: 0.9 });
  addClaim({ personId: id, kind: "fact", text: "Im Urlaub bis 31.10.2026, Vertretung Herr Kruger.", confidence: 0.9 });
  addClaim({ personId: id, kind: "commitment", text: "Schickt die Ratenvereinbarung", direction: "theirs", due: "2026-10-25", confidence: 0.9 });
  addClaim({ personId: id, kind: "commitment", text: "Erste Rate überweisen", direction: "mine", confidence: 0.9 });
  addClaim({ personId: other, kind: "commitment", text: "Schlüssel abholen", direction: "mine", confidence: 0.9 });
  const x = personCardExtras(id, "2026-10-20");
  assert.equal(x.role, "Obergerichtsvollzieherin am Amtsgericht Freiburg", "the confirmed role first");
  assert.deepEqual(x.details.map((d) => d.key), ["phone", "address", "iban"]);
  assert.equal(x.details[2].value, "DE22 6609 0800 0007 7773 02");
  assert.deepEqual(x.owed.map((o) => o.text), ["Erste Rate überweisen", "Schickt die Ratenvereinbarung"], "mine first, only theirs");
  assert.deepEqual(x.away, { until: "2026-10-31", text: "Im Urlaub bis 31.10.2026, Vertretung Herr Kruger." });
  assert.equal(personCardExtras(id, "2026-11-01").away, null, "back by then");
  const none = personCardExtras(other, "2026-10-20");
  assert.equal(none.role, null);
  assert.deepEqual(none.details, []);
});
