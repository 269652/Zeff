import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const OPENALEX = {
  results: [
    { id: "https://openalex.org/W1", display_name: "Differential Geometry of Curves and Surfaces", publication_year: 1976, type: "book", cited_by_count: 9000, authorships: [{ author: { display_name: "Manfredo do Carmo" } }], primary_location: { landing_page_url: "https://doi.org/10.1/x" } },
    { id: "https://openalex.org/W2", display_name: "Riemannian Geometry", publication_year: 1992, type: "article", cited_by_count: 5000, authorships: [], doi: "https://doi.org/10.2/y" },
    { id: "https://openalex.org/W3", display_name: "", publication_year: 2000 },
  ],
};
const S2 = { data: [{ paperId: "abc", title: "Riemannian geometry", year: 1992, citationCount: 4000, url: "https://www.semanticscholar.org/paper/abc", authors: [{ name: "M. do Carmo" }] }, { paperId: "def", title: "Lectures on curvature", year: 2010, citationCount: 30, authors: [] }] };
const ARXIV = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>http://arxiv.org/abs/1234.5678v2</id><published>2019-03-01T00:00:00Z</published><title>An  introduction to
 curvature</title><author><name>A. Author</name></author><author><name>B. Author</name></author></entry>
</feed>`;

test("the sources' answers become one kind of source each", async () => {
  const { parseOpenAlex, parseSemanticScholar, parseArxiv } = await import("@/plugins/learn/sources");
  const oa = parseOpenAlex(OPENALEX);
  assert.equal(oa.length, 2, "one without a title is left out");
  assert.deepEqual(oa[0], { id: "oa:W1", title: "Differential Geometry of Curves and Surfaces", authors: "Manfredo do Carmo", year: 1976, url: "https://doi.org/10.1/x", kind: "book", citations: 9000 });
  assert.equal(oa[1].url, "https://doi.org/10.2/y", "the DOI when there's no landing page");
  assert.equal(oa[1].kind, "paper");
  const s2 = parseSemanticScholar(S2);
  assert.equal(s2[0].id, "s2:abc");
  assert.equal(s2[0].authors, "M. do Carmo");
  const ax = parseArxiv(ARXIV);
  assert.deepEqual(ax[0], { id: "arxiv:1234.5678", title: "An introduction to curvature", authors: "A. Author, B. Author", year: 2019, url: "https://arxiv.org/abs/1234.5678", kind: "paper", citations: 0 });
});

test("merged: duplicates by title go (the one with more to say stays), the most cited first", async () => {
  const { parseOpenAlex, parseSemanticScholar, parseArxiv, mergeSources } = await import("@/plugins/learn/sources");
  const all = mergeSources([parseOpenAlex(OPENALEX), parseSemanticScholar(S2), parseArxiv(ARXIV)], 10);
  assert.equal(all.filter((s) => /riemannian geometry/i.test(s.title)).length, 1);
  assert.equal(all[0].title, "Differential Geometry of Curves and Surfaces");
  assert.equal(all.length, 4);
});

test("fetching: each service asked, one failing doesn't stop the others", async () => {
  const { fetchSources } = await import("@/plugins/learn/sources");
  const asked: string[] = [];
  const fake = async (url: string | URL) => {
    const u = String(url);
    asked.push(u);
    if (u.includes("openalex")) return new Response(JSON.stringify(OPENALEX));
    if (u.includes("semanticscholar")) return new Response("rate limited", { status: 429 });
    return new Response(ARXIV);
  };
  const found = await fetchSources("Differentialgeometrie", { fetch: fake as typeof fetch });
  assert.equal(asked.length, 3);
  assert.ok(asked.every((u) => u.includes("Differentialgeometrie") || u.includes("Differentialgeometrie".toLowerCase()) || u.includes(encodeURIComponent("Differentialgeometrie"))));
  assert.equal(found.length, 3, "OpenAlex's two and arXiv's one");
});

const PLAN = {
  title: "Differentialgeometrie",
  summary: "Von Kurven zu Mannigfaltigkeiten.",
  years: 2,
  sources: [{ id: "oa:W1", title: "Differential Geometry of Curves and Surfaces" }, { id: "web1", title: "MIT OCW 18.950", url: "https://ocw.mit.edu/18-950", kind: "course" }],
  nodes: [
    { key: "y1", kind: "year", parent: null, title: "Jahr 1" },
    { key: "y1.s1", kind: "skill", parent: "y1", title: "Kurven", path: "Grundlagen" },
    { key: "y1.s1.a", kind: "step", parent: "y1.s1", title: "Bogenlänge", sources: ["oa:W1"] },
  ],
};

test("research: sources found, the plan asked for with them, stored — the course is ready", async () => {
  const store = await import("@/plugins/learn/store");
  const { runResearch } = await import("@/plugins/learn/research");
  const id = store.createCourse({ topic: "Differentialgeometrie", goal: "Riemannsche Geometrie", level: "Analysis I" });
  let prompt = "";
  await runResearch(id, {
    fetch: (async (u: string | URL) => new Response(String(u).includes("openalex") ? JSON.stringify(OPENALEX) : String(u).includes("arxiv") ? ARXIV : JSON.stringify(S2))) as typeof fetch,
    ask: async (p: string) => {
      prompt ||= p; // (the first: a one-skill plan is also sent back once to branch out)
      return PLAN;
    },
  });
  assert.match(prompt, /Differentialgeometrie/);
  assert.match(prompt, /Riemannsche Geometrie/);
  assert.match(prompt, /Analysis I/);
  assert.match(prompt, /oa:W1/, "the sources found go into the prompt with their ids");
  const c = store.getCourse(id)!;
  assert.equal(c.status, "ready");
  assert.equal(store.courseNodes(id).length, 3);
  assert.ok(c.sources.some((s) => s.id === "web1"), "the sources the AI added are kept");
  assert.ok(c.sources.some((s) => s.id === "oa:W1"));
});

test("research failing: the course says why; no sources is no reason to stop", async () => {
  const store = await import("@/plugins/learn/store");
  const { runResearch } = await import("@/plugins/learn/research");
  const id = store.createCourse({ topic: "Französisch", goal: "B2", level: "A2" });
  await runResearch(id, { fetch: (async () => new Response("down", { status: 503 })) as typeof fetch, ask: async () => PLAN });
  assert.equal(store.getCourse(id)?.status, "ready", "planned without sources");
  const id2 = store.createCourse({ topic: "x", goal: "", level: "" });
  await runResearch(id2, { fetch: (async () => new Response("{}")) as typeof fetch, ask: async () => Promise.reject(new Error("The AI didn't answer.")) });
  assert.equal(store.getCourse(id2)?.status, "failed");
  assert.match(store.getCourse(id2)?.error ?? "", /didn't answer/);
});

const LINEAR = {
  title: "Kette",
  summary: "",
  years: 1,
  nodes: [
    { key: "y1", kind: "year", parent: null, title: "Y" },
    { key: "p1", kind: "phase", parent: "y1", title: "P" },
    { key: "a", kind: "skill", parent: "p1", title: "A", path: "Grundlagen" },
    { key: "a1", kind: "step", parent: "a", title: "A1" },
    { key: "b", kind: "skill", parent: "p1", title: "B", path: "Grundlagen", requires: ["a"] },
    { key: "b1", kind: "step", parent: "b", title: "B1" },
  ],
};
const BRANCHED = {
  ...LINEAR,
  title: "Baum",
  nodes: [...LINEAR.nodes.map((n) => (n.key === "b" ? { ...n, requires: [], path: "Anwendungen" } : n)), { key: "c", kind: "skill", parent: "p1", title: "C", path: "Theorie", requires: ["a", "b"] }, { key: "c1", kind: "step", parent: "c", title: "C1" }],
};

test("research: a linear plan is sent back once to branch out — the branched one is kept", async () => {
  const store = await import("@/plugins/learn/store");
  const { runResearch } = await import("@/plugins/learn/research");
  const id = store.createCourse({ topic: "Differentialgeometrie", goal: "", level: "" });
  const prompts: string[] = [];
  await runResearch(id, { fetch: (async () => new Response("{}")) as typeof fetch, ask: async (p: string) => (prompts.push(p), prompts.length === 1 ? LINEAR : BRANCHED) });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /zu linear/);
  assert.match(prompts[1], /"Kette"/, "the first plan goes along to be reworked");
  assert.equal(store.getCourse(id)?.title, "Baum");
});

test("research: when the rework fails or is no better, the first plan stays", async () => {
  const store = await import("@/plugins/learn/store");
  const { runResearch } = await import("@/plugins/learn/research");
  const id = store.createCourse({ topic: "x", goal: "", level: "" });
  let n = 0;
  await runResearch(id, { fetch: (async () => new Response("{}")) as typeof fetch, ask: async () => (++n === 1 ? LINEAR : Promise.reject(new Error("timeout"))) });
  assert.equal(store.getCourse(id)?.status, "ready");
  assert.equal(store.getCourse(id)?.title, "Kette");
  const id2 = store.createCourse({ topic: "y", goal: "", level: "" });
  let m = 0;
  await runResearch(id2, { fetch: (async () => new Response("{}")) as typeof fetch, ask: async () => (++m, LINEAR) });
  assert.equal(m, 2, "asked once more, not in a loop");
  assert.equal(store.getCourse(id2)?.title, "Kette");
});

test("the research prompt asks for breadth: parallel skills, several paths, a graph", async () => {
  const { researchPrompt } = await import("@/plugins/learn/research");
  const p = researchPrompt({ topic: "Französisch", goal: "", level: "" }, []);
  assert.match(p, /parallel/i);
  assert.match(p, /keine Kette/i);
});
