import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const LONG = "Die Sanddünen wandern jedes Jahr nach Osten. ".repeat(60);

async function collection() {
  const { createPage, addRow } = await import("@/plugins/workspace/store");
  const id = createPage({ parentId: null, title: "Recherche", kind: "database", schema: { titleName: "Name", properties: [{ id: "src", name: "Quelle", type: "text" }], views: [{ id: "v", name: "Liste", type: "table", filter: { op: "and", rules: [] }, sorts: [], hidden: [] }] } });
  const short = addRow(id, { title: "Kurznotiz", cells: { src: "Zuckerrüben brauchen Regen." } });
  const long = addRow(id, { title: "Dünenstudie", cells: { src: LONG } });
  return { id, short, long };
}

/** A fake AI: says what it was asked for, and counts. */
function fake() {
  const calls: string[] = [];
  const ask = async (prompt: string, schema: object) => {
    calls.push(prompt);
    const wants = Object.keys((schema as { properties: object }).properties);
    if (wants.includes("digest")) return { digest: "Dünen wandern nach Osten." };
    if (wants.includes("markdown")) return { markdown: "# Überblick\nDünen und Rüben." };
    return { answer: "Sie wandern nach Osten [1].", sources: [1] };
  };
  return { ask, calls };
}

test("compiled: a long source costs one AI call, a short one none, the dossier one — and again nothing, until a source changes", async () => {
  const { compileDatabase, dossierOf } = await import("@/plugins/workspace/dossier");
  const { setCell, addRow } = await import("@/plugins/workspace/store");
  const { id, long } = await collection();
  assert.equal(dossierOf(id).pending, 2);
  assert.equal(dossierOf(id).stale, true);

  const ai = fake();
  const r = await compileDatabase(id, { ask: ai.ask, focus: "Was wandert?" });
  assert.deepEqual(r, { digested: 2, left: 0, compiled: true });
  assert.equal(ai.calls.length, 2, "the long source and the dossier");
  assert.match(ai.calls[1], /Zuckerrüben brauchen Regen/, "a short one goes in as it is");
  assert.match(ai.calls[1], /Was wandert\?/, "the focus");
  const d = dossierOf(id);
  assert.match(d.markdown, /Überblick/);
  assert.equal(d.pending, 0);
  assert.equal(d.stale, false);

  ai.calls.length = 0;
  assert.deepEqual(await compileDatabase(id, { ask: ai.ask }), { digested: 0, left: 0, compiled: false });
  assert.equal(ai.calls.length, 0, "nothing changed: nothing paid");

  setCell(long, "src", `${LONG} Neu: nach Westen.`);
  assert.equal(dossierOf(id).pending, 1);
  await compileDatabase(id, { ask: ai.ask });
  assert.equal(ai.calls.length, 2, "only the changed source, and the dossier");
  assert.match(ai.calls[1], /Was wandert\?/, "the focus stays");

  ai.calls.length = 0;
  addRow(id, { title: "Dritte", cells: { src: "Kurz." } });
  await compileDatabase(id, { ask: ai.ask });
  assert.equal(ai.calls.length, 1, "a short new one: only the dossier");
});

test("a big collection comes in over several runs; what is done stays done; a failure keeps it", async () => {
  const { compileDatabase, MAX_DIGESTS, dossierOf } = await import("@/plugins/workspace/dossier");
  const { createPage, addRow } = await import("@/plugins/workspace/store");
  const id = createPage({ parentId: null, title: "Viel", kind: "database", schema: { titleName: "Name", properties: [{ id: "src", name: "Quelle", type: "text" }], views: [] } });
  for (let i = 0; i < MAX_DIGESTS + 3; i++) addRow(id, { title: `Quelle ${i}`, cells: { src: `${i} ${LONG}` } });
  const ai = fake();
  const first = await compileDatabase(id, { ask: ai.ask });
  assert.deepEqual(first, { digested: MAX_DIGESTS, left: 3, compiled: false });
  let n = 0;
  await assert.rejects(compileDatabase(id, { ask: async (p, s) => (++n === 2 ? Promise.reject(new Error("AI down")) : ai.ask(p, s)) }), /AI down/);
  assert.equal(dossierOf(id).pending, 2, "the one before the failure is kept");
  assert.equal((await compileDatabase(id, { ask: ai.ask })).compiled, true);
});

test("a question: the rows that fit, only of this database, numbered; the answer names them", async () => {
  const { askDatabase } = await import("@/plugins/workspace/dossier");
  const { createPage, addRow } = await import("@/plugins/workspace/store");
  const { id, long } = await collection();
  const other = createPage({ parentId: null, title: "Anderes", kind: "database", schema: { titleName: "Name", properties: [{ id: "src", name: "Quelle", type: "text" }], views: [] } });
  addRow(other, { title: "Geheim", cells: { src: "Sanddünen in einer anderen Sammlung." } });
  for (let i = 0; i < 13; i++) addRow(id, { title: `Rübe ${i}`, cells: { src: "Zucker." } });

  const ai = fake();
  const r = await askDatabase(id, "Wohin wandern die Sanddünen?", ai.ask);
  assert.equal(r.answer, "Sie wandern nach Osten [1].");
  assert.deepEqual(r.sources, [{ n: 1, id: long, title: "Dünenstudie" }]);
  assert.match(ai.calls[0], /Quelle \[1\]: Dünenstudie/);
  assert.doesNotMatch(ai.calls[0], /Geheim/);

  ai.calls.length = 0;
  assert.equal((await askDatabase(id, "qqqqzzzz xxxyyy", ai.ask)).answer, "", "nothing fits in a big collection: no AI");
  assert.equal(ai.calls.length, 0);

  // (A number the AI made up leads nowhere.)
  const made = await askDatabase(id, "Wohin wandern Sanddünen?", async () => ({ answer: "Siehe [9].", sources: [9] }));
  assert.deepEqual(made.sources, []);
});

test("a small collection is read whole: a question with no word to find still has its sources", async () => {
  const { askDatabase } = await import("@/plugins/workspace/dossier");
  const { id } = await collection();
  const ai = fake();
  await askDatabase(id, "Was sind die Hauptthemen?", ai.ask);
  assert.match(ai.calls[0], /Kurznotiz/);
  assert.match(ai.calls[0], /Dünenstudie/);
});

test("a document on the web becomes a row: its whole text its page, its address in the url property; the same address again adds nothing", async () => {
  const { addRowFromUrl } = await import("@/plugins/workspace/from-url");
  const { createPage, getPage, rawRows } = await import("@/plugins/workspace/store");
  const { docText } = await import("@/plugins/workspace/doc");
  const real = globalThis.fetch;
  const body = "Dünen wandern. ".repeat(2000);
  let reads = 0;
  globalThis.fetch = (async () => (reads++, new Response(`<html><title>Studie</title><body><p>${body}</p></body></html>`, { headers: { "content-type": "text/html" } }))) as typeof fetch;
  try {
    const id = createPage({ parentId: null, title: "Quellen", kind: "database", schema: { titleName: "Name", properties: [{ id: "link", name: "Adresse", type: "url" }], views: [] } });
    const made = await addRowFromUrl(id, "https://93.184.216.34/studie");
    assert.equal(made.title, "Studie");
    assert.ok(made.chars > 20000, "not cut to what a tool's answer holds");
    const row = rawRows(id)[0];
    assert.equal(row.cells.link, "https://93.184.216.34/studie");
    assert.ok(docText(getPage(row.id)!.content).length > 20000);
    const again = await addRowFromUrl(id, "https://93.184.216.34/studie/");
    assert.equal(again.existed, true);
    assert.equal(reads, 1);
    assert.equal(rawRows(id).length, 1);
    await assert.rejects(addRowFromUrl(id, "http://127.0.0.1:9333/"), /not allowed/);
  } finally {
    globalThis.fetch = real;
  }
});

test("a search needs no key: the Claude login — a key of Brave goes first, Google only where it was set up", async () => {
  const { getSearchConfig, saveSearchConfig, webSearch } = await import("@/plugins/web-search/search");
  assert.equal(getSearchConfig().provider, "brave");
  await assert.rejects(webSearch("dune"), /Claude CLI/, "neither a key nor the CLI here");
  const free = await webSearch("dune", { count: 3, language: "de" }, { claude: async (q, count, language) => [{ title: `${q} ${count} ${language}`, url: "https://example.org/", snippet: "" }] });
  assert.equal(free[0].title, "dune 3 de", "no key, no card: the Claude login");
  saveSearchConfig({ provider: "google" });
  assert.equal(getSearchConfig().provider, "brave", "Google without a key isn't set up");
  saveSearchConfig({ provider: "google", googleKey: "k", googleCx: "c" });
  assert.equal(getSearchConfig().provider, "google");
  saveSearchConfig({ provider: "brave", googleKey: "", googleCx: "", braveKey: "b" });
  const real = globalThis.fetch;
  let header = "";
  globalThis.fetch = (async (_u: string, init: RequestInit) => ((header = new Headers(init.headers).get("x-subscription-token") ?? ""), Response.json({ web: { results: [{ title: "Dune", url: "https://example.org/d", description: "x" }] } }))) as typeof fetch;
  try {
    assert.deepEqual(await webSearch("dune"), [{ title: "Dune", url: "https://example.org/d", snippet: "x" }]);
    assert.equal(header, "b");
  } finally {
    globalThis.fetch = real;
  }
});

test("what the assistant can do it reads from its tools, not from instructions about this", async () => {
  const { INSTRUCTIONS, workspaceChat } = await import("@/plugins/workspace/agent");
  assert.doesNotMatch(INSTRUCTIONS, /Notizbuch|<ask>|<lookup>|<dossier>/);
  let prompt = "";
  await workspaceChat([{ role: "user", text: "x" }], undefined, async (p) => ((prompt = p), { calls: [], reply: "ok" }));
  for (const tool of ["web_search", "web_fetch", "workspace_add_row_from_url", "workspace_ask_database", "workspace_view_template_docs"]) assert.match(prompt, new RegExp(`### ${tool}\\n`));
});

test("a button can hand a request to the assistant — what was typed, never what a row says", async () => {
  const { renderView, viewReference } = await import("@/plugins/workspace/view-template");
  const view = (src: string) => renderView(src, { rows: [{ id: 1, title: "Zeile", icon: "", cells: {}, createdAt: "", updatedAt: "" }], props: [], titleName: "Name", state: { topic: "Dünen" }, app: {}, db: { id: 1, title: "x" } });
  const ok = view('<button action="assistant" label="Mehr finden" request="Finde Material zu {{ state.topic }}"/>');
  assert.deepEqual(ok.errors, []);
  assert.equal((ok.nodes.find((n) => typeof n !== "string") as { a: Record<string, string> }).a.request, "Finde Material zu Dünen");
  assert.match(view('<button action="assistant" label="x"/>').errors[0].message, /needs request/);
  assert.match(view('<list source="rows"><button action="assistant" label="x" request="{{ title }}"/></list>').errors[0].message, /can't stand in a row/);
  assert.match(viewReference(), /assistant \(hand a request/);
});

test("a view: <ask> and <dossier> are tags of the language", async () => {
  const { renderView, viewReference } = await import("@/plugins/workspace/view-template");
  const r = renderView('<ask placeholder="Frag"/><dossier focus="Thesen" empty="Noch nichts"/>', { rows: [], props: [], titleName: "Name", state: {}, app: {}, db: { id: 1, title: "x" } });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.nodes.filter((n) => typeof n !== "string").map((n) => (n as { t: string }).t), ["ask", "dossier"]);
  assert.match(viewReference(), /<ask /);
  assert.match(viewReference(), /<dossier /);
});
