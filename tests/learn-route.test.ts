import assert from "node:assert/strict";
import test from "node:test";
import { courseRoute } from "@/plugins/learn/map";

const n = (key: string, kind: "skill" | "step", parent: string | null, path: string | null = null, at: { masteredAt?: string; activeSince?: string } = {}) => ({
  key,
  kind,
  parent,
  path,
  masteredAt: at.masteredAt ?? null,
  activeSince: at.activeSince ?? null,
});

test("the red thread: what was begun first (by when), then the foundations one after another, then by interest", () => {
  const nodes = [
    n("f1", "skill", null), n("f1.a", "step", "f1"),
    n("f2", "skill", null), n("f2.a", "step", "f2", null, { activeSince: "2026-11-09T10:00:00Z" }),
    n("f3", "skill", null), n("f3.a", "step", "f3"),
    n("x", "skill", null, "Clinic"), n("x.a", "step", "x"),
    n("y", "skill", null, "Research"), n("y.a", "step", "y"),
  ];
  const graph = [
    { key: "f1", after: [] },
    { key: "f2", after: [] },
    { key: "f3", after: [] },
    { key: "x", after: ["f1", "f2", "f3"] },
    { key: "y", after: ["f1", "f2", "f3"] },
  ];
  const r = courseRoute(nodes, graph, { Research: 3 });
  assert.deepEqual(r.keys, ["f2", "f1", "f3", "y", "x"]);
  assert.equal(r.walked, 1);
});
