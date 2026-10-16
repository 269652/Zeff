import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { setupTempData } from "./helpers";

/**
 * The pipeline source "knowledge": the addresses of the systems the knowledge base holds for some search terms (test, prod …),
 * each once as a record with its environment and the page it stands on. What the database holds by hand already (or a database
 * named in `excludeDb`) isn't suggested again.
 */
setupTempData();

const LINKS: Record<string, { env: string; label: string; url: string; pageTitle: string; pageUrl?: string }[]> = {
  "PROJ Relaunch": [
    { env: "test", label: "Test", url: "https://test.relaunch.example/", pageTitle: "Digitas (INTERN)", pageUrl: "https://wiki.example/digitas" },
    { env: "prod", label: "Prod", url: "https://relaunch.example/", pageTitle: "Digitas (INTERN)" },
  ],
  "PROJ Support": [
    { env: "prod", label: "Live", url: "https://relaunch.example/", pageTitle: "Technische Dokumentation" },
    { env: "other", label: "Storybook", url: "https://story.example/", pageTitle: "Technische Dokumentation" },
  ],
};

async function fakeKnowledge(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const text = String((JSON.parse(body || "{}") as { text?: string }).text ?? "");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ links: LINKS[text] ?? [] }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  process.env.KNOWLEDGE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return server;
}

test("the knowledge source keeps its criteria", async () => {
  const { normalizePipeline } = await import("@/plugins/workspace/model");
  const p = normalizePipeline({ steps: [{ id: "a", kind: "source", from: "knowledge", knowledge: { terms: [" PROJ Relaunch ", "", "PROJ Support"], excludeDb: 7 } }, { id: "b", kind: "source", from: "knowledge" }] });
  assert.deepEqual(p.steps[0].knowledge, { terms: ["PROJ Relaunch", "PROJ Support"], excludeDb: 7 });
  assert.deepEqual(p.steps[1].knowledge, undefined, "no terms, nothing to look for");
});

test("addresses from the knowledge base as records: each once, not the ones already held by hand", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("knowledge", true);
  const server = await fakeKnowledge();
  try {
    const w = await import("@/plugins/workspace/store");
    const m = await import("@/plugins/workspace/model");
    const { runPipeline } = await import("@/plugins/workspace/pipeline");
    // The database kept by hand: it has the prod address of the relaunch already.
    const hand = w.createPage({ kind: "database", title: "Umgebungen", schema: { titleName: "Name", properties: [{ id: "p_url", name: "URL", type: "url" }], views: [m.newView("Table")] } });
    w.addRow(hand, { title: "Relaunch Prod", cells: { p_url: "https://relaunch.example/" } });

    const id = w.createPage({
      kind: "database",
      title: "Vorschläge",
      schema: { titleName: "Name", properties: [], views: [m.newView("Table")], pipeline: { steps: [{ id: "s", kind: "source", from: "knowledge", knowledge: { terms: ["PROJ Relaunch", "PROJ Support"], excludeDb: hand } }] } },
    });
    const r = await runPipeline(id, { ai: false });
    assert.equal(r.ok, true, r.error);
    const d = w.getDatabase(id)!;
    const cell = (row: ReturnType<typeof w.rawRows>[number], name: string) => row.cells[d.schema.properties.find((p) => p.name === name)!.id];
    const rows = w.rawRows(id);
    assert.deepEqual(rows.map((x) => x.title).sort(), ["Storybook – story.example", "Test – test.relaunch.example"], "the prod address is held by hand; the same one on two pages only once");
    const test_ = rows.find((x) => x.title.startsWith("Test"))!;
    assert.equal(cell(test_, "URL"), "https://test.relaunch.example/");
    assert.equal(cell(test_, "Environment"), "Test");
    assert.equal(cell(test_, "Page"), "https://wiki.example/digitas", "the page it stands on, as a link (its title when it has none)");
    assert.equal(cell(rows.find((x) => x.title.startsWith("Storybook"))!, "Page"), "Technische Dokumentation");

    const again = await runPipeline(id, { ai: false });
    assert.deepEqual([again.created, again.updated, again.archived], [0, 0, 0], "a second run changes nothing");
  } finally {
    server.close();
  }
});

test("a row ticked in the keep checkbox is final: a refresh neither changes nor archives it, the AI leaves it", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("knowledge", true);
  const server = await fakeKnowledge();
  try {
    const w = await import("@/plugins/workspace/store");
    const m = await import("@/plugins/workspace/model");
    const { runPipeline } = await import("@/plugins/workspace/pipeline");
    const id = w.createPage({
      kind: "database",
      title: "Kept",
      schema: { titleName: "Name", properties: [{ id: "p_ok", name: "Checked", type: "checkbox" }], views: [m.newView("Table")], pipeline: { keepProp: "p_ok", steps: [{ id: "s", kind: "source", from: "knowledge", knowledge: { terms: ["PROJ Relaunch"] } }] } },
    });
    await runPipeline(id, { ai: false });
    const rows = () => w.rawRows(id);
    assert.equal(rows().length, 2);
    const mine = rows().find((r) => r.title.startsWith("Test"))!;
    w.updatePage(mine.id, { title: "Mein Test" });
    w.setCell(mine.id, "p_ok", true);
    const other = rows().find((r) => r.id !== mine.id)!;
    LINKS["PROJ Relaunch"] = [{ env: "dev", label: "Dev", url: "https://dev.relaunch.example/", pageTitle: "x" }];
    const r = await runPipeline(id, { ai: false });
    assert.equal(r.ok, true, r.error);
    assert.equal(w.getPage(mine.id)!.title, "Mein Test", "ticked: its title stays as you set it");
    assert.equal(w.getPage(mine.id)!.archivedAt, null, "ticked: kept although the knowledge no longer has it");
    assert.equal(w.getPage(other.id)!.archivedAt !== null, true, "not ticked: gone with the source");
  } finally {
    LINKS["PROJ Relaunch"] = [
      { env: "test", label: "Test", url: "https://test.relaunch.example/", pageTitle: "Digitas (INTERN)", pageUrl: "https://wiki.example/digitas" },
      { env: "prod", label: "Prod", url: "https://relaunch.example/", pageTitle: "Digitas (INTERN)" },
    ];
    server.close();
  }
});

test("the keep checkbox is part of a pipeline as stored", async () => {
  const { normalizePipeline } = await import("@/plugins/workspace/model");
  assert.equal(normalizePipeline({ keepProp: " p_ok ", steps: [] }).keepProp, "p_ok");
  assert.equal(normalizePipeline({ steps: [] }).keepProp, undefined);
});
