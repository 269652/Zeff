import assert from "node:assert/strict";
import test from "node:test";
import { computeTree, nextSteps, layers, type TreeInput } from "@/plugins/learn/tree";

// A small course: a year with two phases; phase 2 requires phase 1. Skill b requires skill a; its steps run in order.
const course = (mastered: string[] = [], active: string[] = []): TreeInput => ({
  nodes: [
    { id: 1, key: "y1", kind: "year", parent: null, requires: [], path: null, xp: 500 },
    { id: 2, key: "p1", kind: "phase", parent: "y1", requires: [], path: null, xp: 150 },
    { id: 3, key: "p2", kind: "phase", parent: "y1", requires: ["p1"], path: null, xp: 150 },
    { id: 4, key: "a", kind: "skill", parent: "p1", requires: [], path: "Core", xp: 50 },
    { id: 5, key: "a1", kind: "step", parent: "a", requires: [], path: null, xp: 10 },
    { id: 6, key: "a2", kind: "step", parent: "a", requires: ["a1"], path: null, xp: 10 },
    { id: 7, key: "b", kind: "skill", parent: "p1", requires: ["a"], path: "Riemann", xp: 50 },
    { id: 8, key: "b1", kind: "step", parent: "b", requires: [], path: null, xp: 10 },
    { id: 9, key: "c", kind: "skill", parent: "p2", requires: [], path: "Riemann", xp: 50 },
    { id: 10, key: "c1", kind: "step", parent: "c", requires: [], path: null, xp: 10 },
    { id: 11, key: "d", kind: "skill", parent: "p1", requires: [], path: "Topology", xp: 50 },
    { id: 12, key: "d1", kind: "step", parent: "d", requires: [], path: null, xp: 10 },
  ],
  mastered: new Set(mastered),
  active: new Set(active),
});

test("at the start: the first steps of what requires nothing are available, the rest locked", () => {
  const t = computeTree(course());
  assert.equal(t.status.get("a1"), "available");
  assert.equal(t.status.get("a2"), "locked", "a2 requires a1");
  assert.equal(t.status.get("b1"), "locked", "b requires a");
  assert.equal(t.status.get("c1"), "locked", "p2 requires p1 — its whole subtree waits");
  assert.equal(t.status.get("d1"), "available");
  assert.equal(t.status.get("a"), "available", "a skill with an available step is available");
  assert.equal(t.status.get("p2"), "locked");
});

test("mastering steps unlocks the next ones; a skill is mastered when all its steps are", () => {
  let t = computeTree(course(["a1"]));
  assert.equal(t.status.get("a1"), "mastered");
  assert.equal(t.status.get("a2"), "available");
  assert.equal(t.status.get("a"), "available", "half done: not mastered yet");
  t = computeTree(course(["a1", "a2"]));
  assert.equal(t.status.get("a"), "mastered");
  assert.equal(t.status.get("b1"), "available", "b's requirement a is mastered");
});

test("a phase is mastered when all its skills are, and the phase after it opens", () => {
  const t = computeTree(course(["a1", "a2", "b1", "d1"]));
  assert.equal(t.status.get("p1"), "mastered");
  assert.equal(t.status.get("c1"), "available");
  assert.equal(t.status.get("y1"), "available", "p2 not done yet");
  const all = computeTree(course(["a1", "a2", "b1", "d1", "c1"]));
  assert.equal(all.status.get("y1"), "mastered");
});

test("a step being worked on is active; its skill too", () => {
  const t = computeTree(course([], ["a1"]));
  assert.equal(t.status.get("a1"), "active");
  assert.equal(t.status.get("a"), "active");
});

test("progress: mastered xp of the whole, and per path", () => {
  const t = computeTree(course(["a1", "a2"]));
  assert.equal(t.progress.mastered, 2, "two steps");
  assert.equal(t.progress.steps, 5, "a1 a2 b1 c1 d1");
  assert.ok(Math.abs(t.progress.share - 2 / 5) < 1e-9);
  assert.equal(t.paths.get("Core")?.mastered, 2);
  assert.equal(t.paths.get("Core")?.steps, 2);
  assert.equal(t.paths.get("Riemann")?.steps, 2, "a step belongs to its skill's path");
});

test("next steps: the available ones, the paths you care about first, the active one before all", () => {
  const steps = nextSteps(course(["a1", "a2"]), { Topology: 3, Riemann: 1 });
  assert.deepEqual(steps.map((s) => s.key), ["d1", "b1"]);
  const withActive = nextSteps(course(["a1", "a2"], ["b1"]), { Topology: 3 });
  assert.equal(withActive[0].key, "b1", "what you're in the middle of comes first");
});

test("layers: every node one column after what it requires (for drawing the tree left to right)", () => {
  const l = layers(course());
  assert.equal(l.get("a"), 0);
  assert.equal(l.get("b"), 1);
  assert.equal(l.get("d"), 0);
  assert.equal(l.get("c"), 2, "p2 requires p1, whose skills go to column 1: c comes after them");
});
