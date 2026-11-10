import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const plan = (extra: { key: string; kind: string; parent: string | null; title: string; requires?: string[]; path?: string }[] = []) => ({
  title: "Psychiatrie",
  summary: "",
  years: 1,
  sources: [],
  nodes: [
    { key: "y1", kind: "year", parent: null, title: "Jahr 1" },
    { key: "y1.p1", kind: "phase", parent: "y1", title: "Grundlagen" },
    { key: "y1.p1.s1", kind: "skill", parent: "y1.p1", title: "Neuroanatomie", path: "Neuro" },
    { key: "y1.p1.s1.a", kind: "step", parent: "y1.p1.s1", title: "Hirnlappen" },
    { key: "y1.p1.s2", kind: "skill", parent: "y1.p1", title: "Neurophysiologie", path: "Neuro" },
    { key: "y1.p1.s2.a", kind: "step", parent: "y1.p1.s2", title: "Synapse" },
    { key: "y1.p1.s3", kind: "skill", parent: "y1.p1", title: "Diagnostik", path: "Klinik" },
    { key: "y1.p1.s3.a", kind: "step", parent: "y1.p1.s3", title: "ICD" },
    { key: "y1.p2", kind: "phase", parent: "y1", title: "Klinik", requires: ["y1.p1"] },
    { key: "y1.p2.s1", kind: "skill", parent: "y1.p2", title: "Depression", path: "Klinik", requires: ["y1.p1.s1", "y1.p1.s2"] },
    { key: "y1.p2.s1.a", kind: "step", parent: "y1.p2.s1", title: "Symptome" },
    ...extra,
  ],
});

test("the foundations are learned one after another; what builds on them follows the last", async () => {
  const { normalizePlan } = await import("@/plugins/learn/plan");
  const { plan: p } = normalizePlan(plan());
  const req = (k: string) => p.nodes.find((n) => n.key === k)!.requires;
  assert.deepEqual(req("y1.p1.s1"), []);
  assert.deepEqual(req("y1.p1.s2"), ["y1.p1.s1"]);
  assert.deepEqual(req("y1.p1.s3"), ["y1.p1.s2"]);
  assert.deepEqual(req("y1.p2.s1"), ["y1.p1.s3"], "from the last foundation only");
});

test("Update planning: the plan revised, what's done stays — even a step the answer left out", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("learn", true);
  const store = await import("@/plugins/learn/store");
  const { runPlanUpdate } = await import("@/plugins/learn/research");
  const id = store.createCourse({ topic: "Psychiatrie", goal: "", level: "" });
  store.savePlan(id, plan());
  store.masterNode(id, "y1.p1.s1.a", new Date(), "gezeigt");
  let prompt = "";
  // The answer: a new skill, the mastered step left out (it comes back), a renamed step kept by its key.
  const revised = plan([{ key: "y1.p2.s2", kind: "skill", parent: "y1.p2", title: "Psychopharmakologie", path: "Klinik", requires: ["y1.p1.s3"] }]);
  revised.nodes = revised.nodes.filter((n) => n.key !== "y1.p1.s1.a");
  await runPlanUpdate(id, "mehr Pharmakologie", { ask: async (p) => ((prompt = p), revised) });
  assert.match(prompt, /mehr Pharmakologie/);
  assert.match(prompt, /Bereits gemeistert[^\n]*y1\.p1\.s1\.a/);
  const after = store.courseNodes(id);
  assert.ok(after.some((n) => n.key === "y1.p2.s2"), "the new skill is there");
  assert.ok(after.find((n) => n.key === "y1.p1.s1.a")?.masteredAt, "the mastered step stays mastered (put back)");
  assert.equal(store.getCourse(id)?.status, "ready");
});

test("Plan anew (a fresh research) doesn't carry progress over to steps that only share a key", async () => {
  const store = await import("@/plugins/learn/store");
  const id = store.createCourse({ topic: "x", goal: "", level: "" });
  store.savePlan(id, plan());
  store.masterNode(id, "y1.p1.s1.a", new Date(), "gezeigt");
  store.savePlan(id, plan());
  assert.equal(store.courseNodes(id).find((n) => n.key === "y1.p1.s1.a")?.masteredAt, null);
});
