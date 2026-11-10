import assert from "node:assert/strict";
import test from "node:test";
import { badgeSegments, DEFAULT_BADGE, parseBadge } from "../src/lib/todos/badge";

test("badge config: junk falls back to the default, unknown ids and colours dropped, missing parts added", () => {
  assert.deepEqual(parseBadge(null), DEFAULT_BADGE);
  const c = parseBadge([{ id: "activity", on: true, color: "violet" }, { id: "nope" }, { id: "late", on: true, color: "neon" }, { id: "activity", on: false }]);
  assert.deepEqual(c.map((p) => p.id), ["activity", "late", "open", "today"]);
  assert.equal(c[0].color, "violet");
  assert.equal(c[1].color, "red");
  assert.equal(c[1].on, true);
});

test("badge segments: only parts switched on with a number, in their order", () => {
  const c = parseBadge([{ id: "late", on: true, color: "red" }, { id: "open", on: true, color: "indigo" }, { id: "today", on: true, color: "amber" }, { id: "activity", on: false, color: "sky" }]);
  assert.deepEqual(badgeSegments(c, { open: 5, late: 2, today: 0, activity: 4 }), [
    { id: "late", n: 2, color: "red" },
    { id: "open", n: 5, color: "indigo" },
  ]);
});
