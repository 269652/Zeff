import assert from "node:assert/strict";
import test from "node:test";
import { cleanSnippet, entitiesFor, pagePlace, pageSource, pagesFor, type KnowledgeEntity, type KnowledgePage } from "../src/plugins/knowledge/shared";

const page = (id: string, space: string, title = id): KnowledgePage => ({ id, title, space, url: "", summary: null, snippet: "", heading: "", score: 1, updatedAt: null });
const entity = (id: number, name: string, type: string): KnowledgeEntity => ({ id, name, type, summary: "", aliases: [], pages: 1, related: [] });

/** A todo's knowledge: never the todo itself; where each page is from, short. */
test("the panel leaves out the todo itself and names each page's source", () => {
  const pages = [page("zeff:todo:28", "Zeff · Todos"), page("zeff:todo:24", "Zeff · Todos"), page("n-7", "Keep · Zeff"), page("keep:abc", "Google Keep"), page("123", "DEV")];
  assert.deepEqual(pagesFor(pages, 28).map((p) => p.id), ["zeff:todo:24", "n-7", "keep:abc", "123"]);
  assert.deepEqual(pages.map(pageSource), ["zeff", "zeff", "keep", "keep", "confluence"]);
  assert.deepEqual(pages.map(pagePlace), ["Todos", "Todos", "Zeff", "Google Keep", "DEV"]);
});

/** Checkboxes and list markers out of a passage; the found words kept. */
test("a snippet reads as text", () => {
  assert.equal(cleanSnippet("… Board „Zeff“ - [ ] ⟦Schuldenübersicht⟧ erstellen - [x] Unterlagen\n  * Termin"), "… Board „Zeff“ · ⟦Schuldenübersicht⟧ erstellen · Unterlagen · Termin");
});

/** Entity chips: not the documents and tickets the pages already are. */
test("entities a page already shows get no chip", () => {
  const pages = [page("1", "DEV", "KB-2 Schuldnerberatung: Vorbereitung")];
  const entities = [entity(1, "KB-2", "ticket"), entity(2, "Schuldenübersicht", "document"), entity(3, "Schuldnerberatung", "topic"), entity(4, "Nadine", "person")];
  assert.deepEqual(entitiesFor(entities, pages).map((e) => e.name), ["Nadine"]);
});
