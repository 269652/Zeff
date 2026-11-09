import assert from "node:assert/strict";
import test from "node:test";
import { hashValue, stableStringify, isReplicaOp, isTmp, diffManifest, decideField } from "../src/lib/replica/shared";

test("stable text of a value: keys sorted at every depth, so the same data hashes alike however it was built", () => {
  assert.equal(stableStringify({ b: 1, a: { d: [2, { y: 1, x: 0 }], c: null } }), '{"a":{"c":null,"d":[2,{"x":0,"y":1}]},"b":1}');
  assert.equal(hashValue({ a: 1, b: 2 }), hashValue({ b: 2, a: 1 }));
  assert.notEqual(hashValue({ a: 1 }), hashValue({ a: 2 }));
  assert.equal(hashValue(undefined), hashValue(null), "missing and null are one");
  assert.match(hashValue("x"), /^[0-9a-z]+$/);
});

test("temporary ids: what the phone made offline, until the PC gives it a real one", () => {
  assert.equal(isTmp("tmp:abc"), true);
  assert.equal(isTmp(12), false);
  assert.equal(isTmp("12"), false);
});

test("ops are checked like any request: known kinds, ids, fields — anything else is not an op", () => {
  const at = "2026-11-09T10:00:00.000Z";
  assert.ok(isReplicaOp({ id: "a", at, kind: "todo.add", tmp: "tmp:1", text: "Milch kaufen" }));
  assert.ok(isReplicaOp({ id: "b", at, kind: "todo.set", todo: 5, field: "status", value: "done", base: "x1" }));
  assert.ok(isReplicaOp({ id: "c", at, kind: "todo.set", todo: "tmp:1", field: "due", value: null, base: "x" }));
  assert.ok(isReplicaOp({ id: "d", at, kind: "page.set", page: 3, field: "content", value: { type: "doc", content: [] }, base: "y" }));
  assert.ok(isReplicaOp({ id: "e", at, kind: "row.cell", row: 9, prop: "status", value: "opt2", base: "z" }));
  assert.ok(isReplicaOp({ id: "f", at, kind: "row.add", tmp: "tmp:r", db: 4, title: "Neu", cells: { p: 1 } }));
  assert.ok(isReplicaOp({ id: "g", at, kind: "event.add", tmp: "tmp:e", calendarId: 1, title: "Arzt", start: "2026-11-10T09:00", end: "2026-11-10T10:00" }));
  assert.ok(isReplicaOp({ id: "h", at, kind: "event.set", event: "1:abc", field: "title", value: "Zahnarzt", base: "q" }));
  assert.ok(isReplicaOp({ id: "i", at, kind: "event.delete", event: "1:abc" }));
  assert.ok(isReplicaOp({ id: "j", at, kind: "page.add", tmp: "tmp:p", parent: null, title: "Einkauf" }));
  assert.ok(isReplicaOp({ id: "k", at, kind: "page.archive", page: 3 }));
  assert.ok(isReplicaOp({ id: "l", at, kind: "row.place", row: 9, after: 8, before: null }));
  assert.ok(isReplicaOp({ id: "m", at, kind: "todo.note", todo: 5, text: "angerufen" }));

  assert.equal(isReplicaOp({ id: "x", at, kind: "todo.set", todo: 5, field: "owner", value: "x", base: "b" }), false, "a field the phone can't change");
  assert.equal(isReplicaOp({ id: "x", at, kind: "todo.set", todo: 5, field: "status", value: "gone", base: "b" }), false, "a status that doesn't exist");
  assert.equal(isReplicaOp({ id: "x", at, kind: "page.set", page: 3, field: "schema", value: {}, base: "b" }), false);
  assert.equal(isReplicaOp({ id: "x", at, kind: "todo.add", tmp: "5", text: "x" }), false, "a tmp id must look like one");
  assert.equal(isReplicaOp({ id: "x", at: "yesterday", kind: "todo.note", todo: 5, text: "x" }), false);
  assert.equal(isReplicaOp({ id: "", at, kind: "todo.note", todo: 5, text: "x" }), false);
  assert.equal(isReplicaOp({ id: "x", at, kind: "todo.note", todo: 5, text: "x".repeat(20001) }), false);
  assert.equal(isReplicaOp({ id: "x", at, kind: "event.add", tmp: "tmp:e", calendarId: 1, title: "x", start: "morgen", end: "2026-11-10T10:00" }), false);
  assert.equal(isReplicaOp(null), false);
});

test("a manifest compared: what to fetch (new or changed) and what to drop (gone on the PC)", () => {
  const have = { "todo:1": "a", "todo:2": "b", "page:3": "c" };
  const now = { "todo:1": "a", "todo:2": "B", "page:4": "d" };
  assert.deepEqual(diffManifest(have, now), { fetch: ["todo:2", "page:4"], drop: ["page:3"] });
});

test("last write wins, field by field: unchanged on the PC → applied; changed there → the later one stays, the other is reported", () => {
  const base = hashValue("Milch");
  // The PC still has what the phone saw.
  assert.deepEqual(decideField({ current: "Milch", base, value: "Hafermilch", opAt: "2026-11-09T10:00:00Z", pcAt: "2026-11-09T12:00:00Z" }), { apply: true });
  // Already so: nothing to do.
  assert.deepEqual(decideField({ current: "Hafermilch", base, value: "Hafermilch", opAt: "2026-11-09T10:00:00Z", pcAt: "2026-11-09T12:00:00Z" }), { apply: false, same: true });
  // Changed on the PC too, the phone's change is later: it wins, the PC's value is reported as overwritten.
  assert.deepEqual(decideField({ current: "Sojamilch", base, value: "Hafermilch", opAt: "2026-11-09T13:00:00Z", pcAt: "2026-11-09T12:00:00Z" }), { apply: true, conflict: { kept: "phone", lost: "Sojamilch" } });
  // Changed on the PC later: the PC's stays, the phone's is reported as not applied.
  assert.deepEqual(decideField({ current: "Sojamilch", base, value: "Hafermilch", opAt: "2026-11-09T11:00:00Z", pcAt: "2026-11-09T12:00:00Z" }), { apply: false, conflict: { kept: "pc", lost: "Hafermilch" } });
});
