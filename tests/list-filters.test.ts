import assert from "node:assert/strict";
import test from "node:test";

test("people list: search, starred only, sorts", async () => {
  const { filterPeople } = await import("@/plugins/people/list-filter");
  const row = (id: number, name: string, o: Partial<Parameters<typeof filterPeople>[0][number]> = {}) => ({ id, name, aliases: [], emails: [], note: "", starred: false, createdAt: `2026-01-0${id}`, nextDays: null, lastAt: null, ...o });
  const rows = [row(1, "Zoe", { aliases: ["Zozo"], nextDays: 3, lastAt: "2026-05-01" }), row(2, "Adam", { emails: ["adam@x.de"], note: "plays chess", nextDays: 1 }), row(3, "Mia", { starred: true, lastAt: "2026-06-01" })];
  const ids = (r: typeof rows) => r.map((p) => p.id);
  const base = { query: "", starredOnly: false };
  assert.deepEqual(ids(filterPeople(rows, { ...base, sort: "name" })), [3, 2, 1]); // starred first
  assert.deepEqual(ids(filterPeople(rows, { ...base, sort: "next" })), [3, 2, 1]);
  assert.deepEqual(ids(filterPeople(rows, { ...base, starredOnly: true, sort: "name" })), [3]);
  assert.deepEqual(ids(filterPeople(rows, { query: "zozo", starredOnly: false, sort: "name" })), [1]);
  assert.deepEqual(ids(filterPeople(rows, { query: "ADAM@x chess", starredOnly: false, sort: "name" })), [2]); // case-insensitive, words across fields
  assert.deepEqual(ids(filterPeople(rows, { query: "adam zoe", starredOnly: false, sort: "name" })), []);
  assert.deepEqual(ids(filterPeople(rows, { query: "chess x.de", starredOnly: false, sort: "name" })), [2]);
  assert.deepEqual(ids(filterPeople(rows, { query: "", starredOnly: false, sort: "recent" })), [3, 1, 2]);
  assert.deepEqual(ids(filterPeople(rows.map((r) => ({ ...r, starred: false })), { ...base, sort: "next" })), [2, 1, 3]);
  assert.deepEqual(ids(filterPeople(rows.map((r) => ({ ...r, starred: false })), { ...base, sort: "added" })), [3, 2, 1]);
});

test("documents list: search name/abstract/concepts, status, kind, sort", async () => {
  const { filterDocs } = await import("@/plugins/documents/list-filter");
  const doc = (id: number, name: string, o: Record<string, unknown> = {}) => ({ id, ref: `doc:${id}`, name, mime: "", size: id * 100, kind: "pdf", status: "ready", error: "", abstract: "", concepts: [], compiled: true, chars: 0, createdAt: `2026-01-0${id}`, updatedAt: "", ...o }) as import("@/plugins/documents/shared").DocView;
  const docs = [doc(1, "Invoice.pdf", { abstract: "Rent for May" }), doc(2, "photo.png", { kind: "image", status: "queued" }), doc(3, "notes.txt", { kind: "text", status: "failed", concepts: ["Budget"] }), doc(4, "scan.bin", { kind: "other", status: "unsupported" })];
  const ids = (r: typeof docs) => r.map((d) => d.id);
  const base = { query: "", status: "all", kind: "all", sort: "newest" } as const;
  assert.deepEqual(ids(filterDocs(docs, base)), [4, 3, 2, 1]);
  assert.deepEqual(ids(filterDocs(docs, { ...base, sort: "name" })), [1, 3, 2, 4]);
  assert.deepEqual(ids(filterDocs(docs, { ...base, sort: "size" })), [4, 3, 2, 1]);
  assert.deepEqual(ids(filterDocs(docs, { ...base, query: "rent may" })), [1]);
  assert.deepEqual(ids(filterDocs(docs, { ...base, query: "budget" })), [3]);
  assert.deepEqual(ids(filterDocs(docs, { ...base, status: "reading" })), [2]);
  assert.deepEqual(ids(filterDocs(docs, { ...base, status: "unsupported" })), [4]);
  assert.deepEqual(ids(filterDocs(docs, { ...base, kind: "text" })), [3]);
  assert.deepEqual(ids(filterDocs(docs, { ...base, kind: "text", status: "ready" })), []);
});
