import assert from "node:assert/strict";
import test from "node:test";
import { contrastRatio, parseHex, textOn } from "../src/lib/contrast";
import { nudgeOf, nudged } from "../src/plugins/calendar/nudge";

test("textOn picks black or white by contrast", () => {
  assert.equal(textOn("#ffffff"), "#111111");
  assert.equal(textOn("#000"), "#ffffff");
  assert.equal(textOn("#FFEB3B"), "#111111");
  assert.equal(textOn("#1a237e"), "#ffffff");
  assert.equal(textOn("not a colour"), "#ffffff");
  for (const c of ["#7A869A", "#6366F1", "#e53935", "#43a047", "#fb8c00"]) {
    const rgb = parseHex(c)!;
    const pick = textOn(c) === "#111111" ? [17, 17, 17] : [255, 255, 255];
    assert.ok(contrastRatio(rgb, pick as [number, number, number]) >= 3.9, c);
  }
});

test("nudge keys", () => {
  assert.deepEqual(nudgeOf("ArrowDown", false), { dMinutes: 15 });
  assert.deepEqual(nudgeOf("ArrowUp", true), { dMinutes: -15, resize: true });
  assert.deepEqual(nudgeOf("ArrowLeft", false), { dDays: -1 });
  assert.equal(nudgeOf("ArrowLeft", true), null);
  assert.equal(nudgeOf("a", false), null);
});

test("nudged moves and resizes", () => {
  assert.deepEqual(nudged("2026-10-14T10:00", "2026-10-14T11:00", false, { dMinutes: 15 }), { start: "2026-10-14T10:15", end: "2026-10-14T11:15" });
  assert.deepEqual(nudged("2026-10-14T23:50", "2026-10-15T00:30", false, { dMinutes: 15 }), { start: "2026-10-15T00:05", end: "2026-10-15T00:45" });
  assert.deepEqual(nudged("2026-10-14T10:00", "2026-10-14T11:00", false, { dDays: 1 }), { start: "2026-10-15T10:00", end: "2026-10-15T11:00" });
  assert.deepEqual(nudged("2026-10-14T10:00", "2026-10-14T11:00", false, { dMinutes: -15, resize: true }), { start: "2026-10-14T10:00", end: "2026-10-14T10:45" });
  assert.equal(nudged("2026-10-14T10:00", "2026-10-14T10:15", false, { dMinutes: -15, resize: true }), null);
  assert.deepEqual(nudged("2026-10-31", "2026-11-01", true, { dDays: 1 }), { start: "2026-11-01", end: "2026-11-02" });
  assert.equal(nudged("2026-10-31", "2026-11-01", true, { dMinutes: 15 }), null);
});
