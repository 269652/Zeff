import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A fact per subject: found again, its text replaced and its sources added — never two "Nadines Geburtstag". */
test("facts are kept one per subject", async () => {
  const { addFact, factsByRefs, listFacts } = await import("@/lib/facts");
  const a = addFact({ subject: "Nadines Geburtstag", text: "16.10.", refs: ["mail:wa:Karla|1"] })!;
  const b = addFact({ subject: "nadines geburtstag", text: "16. Oktober", refs: ["mail:wa:Karla|2"] })!;
  assert.equal(a.id, b.id);
  assert.equal(b.text, "16. Oktober");
  assert.deepEqual(b.refs, ["mail:wa:Karla|1", "mail:wa:Karla|2"]);
  assert.equal(listFacts().length, 1);
  assert.equal(addFact({ subject: " ", text: "x", refs: [] }), null);
  assert.equal(factsByRefs([a.ref, "fact:999", "mail:x"]).get(a.ref)?.subject, "Nadines Geburtstag");
});
