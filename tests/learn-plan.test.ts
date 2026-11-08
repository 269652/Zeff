import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlan } from "@/plugins/learn/plan";

const raw = (nodes: unknown[], extra: Record<string, unknown> = {}) => ({ title: "Differential geometry", summary: "From curves to manifolds.", years: 2, sources: [{ id: "s1", title: "do Carmo" }], nodes, ...extra });

test("a well-formed plan comes through as it is, with default xp and order", () => {
  const { plan, problems } = normalizePlan(
    raw([
      { key: "y1", kind: "year", parent: null, title: "Year 1" },
      { key: "y1.p1", kind: "phase", parent: "y1", title: "Curves" },
      { key: "y1.p1.s1", kind: "skill", parent: "y1.p1", title: "Curvature", path: "Core" },
      { key: "y1.p1.s1.a", kind: "step", parent: "y1.p1.s1", title: "Arc length", sources: ["s1"] },
      { key: "y1.p1.s1.b", kind: "step", parent: "y1.p1.s1", title: "Frenet frame", requires: ["y1.p1.s1.a"], xp: 25 },
    ]),
  );
  assert.deepEqual(problems, []);
  assert.equal(plan.nodes.length, 5);
  const byKey = new Map(plan.nodes.map((n) => [n.key, n]));
  assert.equal(byKey.get("y1.p1.s1.a")?.xp, 10, "a step's default xp");
  assert.equal(byKey.get("y1.p1.s1.b")?.xp, 25, "its own xp is kept");
  assert.equal(byKey.get("y1.p1")?.xp, 150);
  assert.deepEqual(byKey.get("y1.p1.s1.b")?.requires, ["y1.p1.s1.a"]);
  assert.equal(plan.years, 2);
});

test("unknown parents, kinds and requirements are dropped with a note — never a node that can't be placed", () => {
  const { plan, problems } = normalizePlan(
    raw([
      { key: "y1", kind: "year", parent: null, title: "Year 1" },
      { key: "x", kind: "chapter", parent: "y1", title: "Odd kind" },
      { key: "y1.s", kind: "skill", parent: "nowhere", title: "Orphan skill" },
      { key: "y1.p", kind: "phase", parent: "y1", title: "Phase", requires: ["ghost", "y1"] },
    ]),
  );
  const keys = plan.nodes.map((n) => n.key);
  assert.ok(!keys.includes("x"), "an unknown kind is dropped");
  assert.ok(keys.includes("y1.s"), "an orphan is kept…");
  assert.equal(plan.nodes.find((n) => n.key === "y1.s")?.parent, null, "…at the top");
  assert.deepEqual(plan.nodes.find((n) => n.key === "y1.p")?.requires, [], "requiring a missing node or its own ancestor is dropped");
  assert.ok(problems.length >= 3);
});

test("duplicate keys keep the first; a node without a title is dropped", () => {
  const { plan } = normalizePlan(
    raw([
      { key: "y1", kind: "year", parent: null, title: "Year 1" },
      { key: "y1", kind: "year", parent: null, title: "Again" },
      { key: "y2", kind: "year", parent: null, title: "  " },
    ]),
  );
  assert.deepEqual(
    plan.nodes.map((n) => [n.key, n.title]),
    [["y1", "Year 1"]],
  );
});

test("a cycle of requirements is broken (the edge closing it goes), the rest stays", () => {
  const { plan, problems } = normalizePlan(
    raw([
      { key: "a", kind: "skill", parent: null, title: "A", requires: ["c"] },
      { key: "b", kind: "skill", parent: null, title: "B", requires: ["a"] },
      { key: "c", kind: "skill", parent: null, title: "C", requires: ["b"] },
    ]),
  );
  const req = Object.fromEntries(plan.nodes.map((n) => [n.key, n.requires]));
  const edges = Object.values(req).reduce((n, r) => n + (r?.length ?? 0), 0);
  assert.equal(edges, 2, "one of the three edges is gone");
  assert.ok(problems.some((p) => /cycle/i.test(p)));
});

test("a parent loop is broken too (a node can't be its own ancestor)", () => {
  const { plan } = normalizePlan(
    raw([
      { key: "p", kind: "phase", parent: "s", title: "P" },
      { key: "s", kind: "skill", parent: "p", title: "S" },
    ]),
  );
  const roots = plan.nodes.filter((n) => n.parent === null);
  assert.equal(roots.length, 1);
});

test("sources: only the plan's own ids are kept on a node; the plan's sources need an id and a title", () => {
  const { plan } = normalizePlan(
    raw([{ key: "s", kind: "skill", parent: null, title: "S", sources: ["s1", "nope"] }], {
      sources: [{ id: "s1", title: "do Carmo", url: "https://example.org" }, { id: "s2" }, { title: "no id" }],
    }),
  );
  assert.deepEqual(plan.sources.map((s) => s.id), ["s1"]);
  assert.deepEqual(plan.nodes[0].sources, ["s1"]);
});

test("not a plan at all: an empty plan and a problem", () => {
  const { plan, problems } = normalizePlan("nonsense");
  assert.equal(plan.nodes.length, 0);
  assert.ok(problems.length > 0);
});

const chainPlan = {
  title: "T",
  years: 1,
  nodes: [
    { key: "y1", kind: "year", parent: null, title: "Y" },
    { key: "p1", kind: "phase", parent: "y1", title: "P1" },
    { key: "a", kind: "skill", parent: "p1", title: "A", path: "Grundlagen" },
    { key: "b", kind: "skill", parent: "p1", title: "B", path: "Grundlagen", requires: ["a"] },
    { key: "c", kind: "skill", parent: "p1", title: "C", path: "Grundlagen", requires: ["b"] },
    { key: "p2", kind: "phase", parent: "y1", title: "P2", requires: ["p1"] },
    { key: "d", kind: "skill", parent: "p2", title: "D", path: "Grundlagen" },
    { key: "e", kind: "skill", parent: "p2", title: "E", path: "Grundlagen", requires: ["d"] },
  ],
};

test("a plan's shape: a chain of skills on one path is linear", async () => {
  const { normalizePlan, planShape } = await import("@/plugins/learn/plan");
  const s = planShape(normalizePlan(chainPlan).plan);
  assert.equal(s.paths, 1);
  assert.deepEqual(s.widths, [1, 1]);
  assert.equal(s.linear, true);
});

test("a plan's shape: parallel skills on several paths branch", async () => {
  const { normalizePlan, planShape } = await import("@/plugins/learn/plan");
  const branching = {
    ...chainPlan,
    nodes: chainPlan.nodes.map((n) =>
      n.key === "b" ? { ...n, path: "Anschauung" } : n.key === "c" ? { ...n, requires: ["a"], path: "Rechnen" } : n.key === "e" ? { ...n, requires: [], path: "Physik" } : n,
    ),
  };
  const s = planShape(normalizePlan(branching).plan);
  assert.equal(s.paths, 4);
  assert.deepEqual(s.widths, [2, 2], "b and c both follow a; d and e side by side");
  assert.equal(s.linear, false);
});
