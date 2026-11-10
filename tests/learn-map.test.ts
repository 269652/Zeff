import assert from "node:assert/strict";
import test from "node:test";
import { skillGraph } from "../src/plugins/learn/map";

const N = (key: string, kind: string, parent: string | null, requires: string[] = []) => ({ key, kind: kind as "year", parent, requires });

test("the skill map's edges: a skill's own requirements, a container required stands for its last skills", () => {
  const g = skillGraph([
    N("y1", "year", null),
    N("p1", "phase", "y1"),
    N("a", "skill", "p1"),
    N("b", "skill", "p1", ["a"]),
    N("c", "skill", "p1", ["a"]),
    N("p2", "phase", "y1", ["p1"]),
    N("d", "skill", "p2"),
    N("e", "skill", "p2", ["d", "p1"]),
    N("x1", "step", "a"),
  ]);
  const after = Object.fromEntries(g.map((s) => [s.key, s.after.sort()]));
  assert.deepEqual(Object.keys(after), ["a", "b", "c", "d", "e"], "only skills");
  // The first phase's skills are the foundations: drawn one after another without lines between them (the map joins them
  // in order), and what builds on them follows only the last one.
  assert.deepEqual(after.a, []);
  assert.deepEqual(after.b, []);
  assert.deepEqual(g.filter((s) => s.foundation).map((s) => s.key), ["a", "b", "c"]);
  assert.deepEqual(after.d, ["c"], "the start of a phase follows the last foundation");
  assert.deepEqual(after.e, ["c", "d"]);
  assert.equal(g.find((s) => s.key === "d")?.phase, "p2");
});

test("a year required counts the same way, through its phases' last skills", () => {
  const g = skillGraph([N("y1", "year", null), N("p1", "phase", "y1"), N("a", "skill", "p1"), N("y2", "year", null, ["y1"]), N("p2", "phase", "y2"), N("b", "skill", "p2")]);
  assert.deepEqual(g.find((s) => s.key === "b")?.after, ["a"]);
});
