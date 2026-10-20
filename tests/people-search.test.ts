import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

async function nathanael() {
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim, reviewClaim, claimsOf } = await import("@/plugins/people/graph");
  const { addDetail } = await import("@/plugins/people/details");
  const id = createPerson({ name: "Ulla Nathanael", aliases: ["U. Nathanael"] });
  addClaim({ personId: id, kind: "fact", text: "Dienstkonto: IBAN DE22 6609 0800 0007 7773 02, BIC GENODE61BBB, Bank BBBank Karlsruhe.", sourceRef: "doc:1", confidence: 0.9 });
  addClaim({ personId: id, kind: "role", text: "Obergerichtsvollzieherin am Amtsgericht Freiburg", sourceRef: "doc:1", confidence: 0.6 });
  addClaim({ personId: id, kind: "fact", text: "Wohnt in der Rosengasse", sourceRef: "doc:1", confidence: 0.9 });
  reviewClaim(claimsOf(id).find((c) => c.text.startsWith("Wohnt"))!.id, "reject");
  addDetail(id, "address", "Luisenstraße 2, 79098 Freiburg");
  const other = createPerson({ name: "Hans Kruger" });
  addClaim({ personId: other, kind: "role", text: "Hausmeister", sourceRef: "mail:1", confidence: 0.9 });
  return { id, other };
}

test("people search: finds a person by what was read about them (claims) and their details — the best match first, a rejected claim not", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("people", true);
  const { id } = await nathanael();
  const { searchPeople } = await import("@/plugins/people/search");
  const top = (words: string[]) => searchPeople(words)[0];
  assert.equal(top(["iban", "nathanael"])?.personId, id);
  assert.equal(top(["iban", "nathanael"])?.score, 2);
  assert.match(top(["iban", "nathanael"])!.text, /IBAN DE22/);
  assert.equal(top(["dienstkonto"])?.personId, id);
  assert.equal(top(["luisenstraße"])?.personId, id, "a detail added by hand");
  assert.match(top(["luisenstraße"])!.text, /Luisenstraße 2/);
  assert.equal(top(["obergerichtsvollzieherin"])?.personId, id, "a proposed claim counts");
  assert.deepEqual(searchPeople(["rosengasse"]), [], "a rejected claim doesn't");
  // Only the name: not a hit — the search is over what is known of them.
  assert.deepEqual(searchPeople(["kruger"]), []);
  assert.equal(searchPeople(["hausmeister", "kruger"])[0]?.score, 2);
});

test("people search: a source of the context search (rag, search_context) — only with the People plugin installed", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("people", true);
  const { SEARCHERS, RAG_SOURCES, retrieve, wordsOf } = await import("@/lib/rag");
  assert.ok((RAG_SOURCES as readonly string[]).includes("people"));
  const hits = await SEARCHERS.people(wordsOf("IBAN Nathanael"), "IBAN Nathanael");
  const { listPeople } = await import("@/plugins/people/store");
  const id = listPeople().find((p) => p.name === "Ulla Nathanael")!.id;
  assert.equal(hits[0]?.ref, `person:${id}`);
  assert.equal(hits[0]?.source, "people");
  assert.match(hits[0]!.title, /Ulla Nathanael/);
  const r = await retrieve([{ query: "Dienstkonto", where: ["people"] }]);
  assert.match(r.text, new RegExp(`\\[person:${id}\\]`));
  setInstalled("people", false);
  assert.deepEqual(await SEARCHERS.people(["dienstkonto"], "Dienstkonto"), []);
  setInstalled("people", true);
});

test("people search: the command palette's people — every word must match, each linked to the person's page", async () => {
  const { peoplePaletteItems } = await import("@/plugins/people/search");
  const items = await peoplePaletteItems("IBAN Nathanael");
  assert.equal(items.length, 1);
  assert.equal(items[0].label, "Ulla Nathanael");
  assert.equal(items[0].group, "People");
  assert.match(items[0].href, /^\/workspace/);
  assert.match(items[0].hint ?? "", /IBAN/);
  assert.deepEqual(await peoplePaletteItems("IBAN Kruger"), [], "not every word in one person");
  assert.equal((await peoplePaletteItems("luisenstraße")).length, 1);
});
