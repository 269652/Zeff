import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.KNOWLEDGE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-k-"));

/** Two entities for one person ("U. Nathanael", "Nathanael"), each with a page. */
async function seed() {
  const { db } = await import("../knowledge/lib/db");
  const d = db();
  const now = "2026-10-20T00:00:00.000Z";
  d.prepare("insert into pages (id, space, title, url, body, fetched_at, version) values ('p1', 'S', 'Brief 1', '', 'x', ?, 1), ('p2', 'S', 'Brief 2', '', 'y', ?, 1)").run(now, now);
  d.prepare("insert into entities (id, key, name, type, aliases, summary, updated_at) values (2226, 'u nathanael', 'U. Nathanael', 'person', ?, 'Gerichtsvollzieherin', ?)").run(JSON.stringify(["Obergerichtsvollzieherin Nathanael"]), now);
  d.prepare("insert into entities (id, key, name, type, aliases, summary, updated_at) values (2880, 'nathanael', 'Nathanael', 'person', ?, '', ?)").run(JSON.stringify(["Obergerichtsvollzieherin Nathanael"]), now);
  d.prepare("insert into entities (id, key, name, type, aliases, summary, updated_at) values (10, 'amtsgericht', 'Amtsgericht', 'org', '[]', '', ?)").run(now);
  d.prepare("insert into entity_pages (entity_id, page_id) values (2226, 'p1'), (2880, 'p2')").run();
  d.prepare("insert into relations (src, dst, rel, fact, page_id) values (2880, 10, 'arbeitet bei', '', 'p2')").run();
  return d;
}

test("person facts: a confirmed fact becomes a page of the entity at once — one line per ref, replaced, removed", async () => {
  await seed();
  const { addPersonFact } = await import("../knowledge/lib/person-facts");
  const { entityDetail } = await import("../knowledge/lib/graph");
  const pageId = addPersonFact(2226, { ref: "claim:7", text: "Nicht im Dienst bis 29.10.2026" });
  assert.equal(pageId, "own:person-2226");
  addPersonFact(2226, { ref: "claim:8", text: "IBAN DE02 1203 0000 0000 2020 51" });
  let e = entityDetail(2226)!;
  const page = e.pages.find((p) => p.id === pageId);
  assert.ok(page, "linked to the entity without compiling");
  const { db } = await import("../knowledge/lib/db");
  const body = () => (db().prepare("select body, version, compiled_version from pages where id = ?").get(pageId) as { body: string; version: number; compiled_version: number | null });
  assert.match(body().body, /Nicht im Dienst bis 29\.10\.2026/);
  assert.match(body().body, /IBAN DE02/);
  assert.equal(body().compiled_version, body().version, "not compiled again (no new entities from it)");
  // The same ref again: its line replaced, not a second one.
  addPersonFact(2226, { ref: "claim:7", text: "Nicht im Dienst bis 30.10.2026" });
  assert.doesNotMatch(body().body, /29\.10\.2026/);
  assert.match(body().body, /30\.10\.2026/);
  // Empty text: the line goes.
  addPersonFact(2226, { ref: "claim:8", text: "" });
  assert.doesNotMatch(body().body, /IBAN/);
  // Searchable like any page.
  const n = db().prepare("select count(*) n from chunks_fts where chunks_fts match 'Dienst' and page_id = ?").get(pageId) as { n: number };
  assert.equal(n.n, 1);
  e = entityDetail(2226)!;
  assert.equal(e.pages.filter((p) => p.id === pageId).length, 1);
  assert.throws(() => addPersonFact(999999, { ref: "claim:1", text: "x" }), /not found/i);
});

test("merge people: the dropped entities' pages, relations and names go to the kept one", async () => {
  const { mergePersonEntities } = await import("../knowledge/lib/person-facts");
  const { entityDetail, entityIdByKey } = await import("../knowledge/lib/graph");
  const kept = mergePersonEntities(2226, [2880]);
  assert.equal(kept.id, 2226);
  assert.equal(kept.name, "U. Nathanael", "the kept one keeps its name");
  assert.equal(entityDetail(2880), null);
  const e = entityDetail(2226)!;
  assert.deepEqual(e.pages.map((p) => p.id).filter((id) => id.startsWith("p")).sort(), ["p1", "p2"]);
  assert.ok(e.relations.some((r) => r.other.id === 10));
  assert.ok(e.aliases.includes("Nathanael"));
  assert.equal(entityIdByKey("nathanael"), 2226, "the dropped key points to it");
  assert.throws(() => mergePersonEntities(2226, [2226]), /nothing to merge/i);
  assert.throws(() => mergePersonEntities(4242, [2226]), /not found/i);
});
