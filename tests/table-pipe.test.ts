import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// Tables transformed on a page: steps (filter, sort, group, computed column, pick, rename, unique, limit) turn a table into
// another; pipes chain by name; a result table shows a pipe's output.
setupTempData();

const grid = { cols: ["Datum", "Beschreibung", "Betrag", "Kategorie"], rows: [
  ["2026-11-01", "Miete", "850", "Wohnen"],
  ["2026-11-02", "Supermarkt", "63,40", "Essen"],
  ["2026-11-10", "Buch", "19 €", "Freizeit"],
  ["2026-11-06", "Restaurant", "41,50", "Essen"],
] as (string | null)[][] };

test("filter, sort, group and total: numbers written as text count as numbers, dates sort as dates", async () => {
  const { runPipe } = await import("@/plugins/workspace/table-pipe");
  const big = runPipe(grid, [{ op: "filter", col: "Betrag", cmp: ">", value: "40" }, { op: "sort", col: "Betrag", dir: "desc" }]);
  assert.equal(big.error, undefined);
  assert.deepEqual(big.grid.rows.map((r) => r[1]), ["Miete", "Supermarkt", "Restaurant"]);
  const byDate = runPipe(grid, [{ op: "sort", col: "datum", dir: "desc" }]);
  assert.deepEqual(byDate.grid.rows.map((r) => r[1]), ["Buch", "Restaurant", "Supermarkt", "Miete"]);
  const sums = runPipe(grid, [{ op: "group", by: "Kategorie", agg: "sum", col: "Betrag", as: "Summe" }, { op: "sort", col: "Summe", dir: "desc" }]);
  assert.deepEqual(sums.grid.cols, ["Kategorie", "Summe"]);
  assert.deepEqual(sums.grid.rows, [["Wohnen", 850], ["Essen", 104.9], ["Freizeit", 19]]);
  const counts = runPipe(grid, [{ op: "group", by: "Kategorie", agg: "count" }]);
  assert.deepEqual(counts.grid.rows, [["Wohnen", 1], ["Essen", 2], ["Freizeit", 1]]);
});

test("a computed column, picking, renaming, doubles, the first N", async () => {
  const { runPipe } = await import("@/plugins/workspace/table-pipe");
  const g = { cols: ["Zutat", "Menge"], rows: [["Mehl", "250"], ["Milch", "0,5"], ["mehl", "10"]] as (string | null)[][] };
  const r = runPipe(g, [{ op: "add", name: "Für 6", formula: "[Menge] * 6 / 4" }, { op: "unique", col: "Zutat" }, { op: "rename", col: "Für 6", to: "Menge 6" }, { op: "pick", cols: ["Zutat", "Menge 6"] }, { op: "limit", n: 5 }]);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.grid.cols, ["Zutat", "Menge 6"]);
  assert.deepEqual(r.grid.rows, [["Mehl", 375], ["Milch", 0.75]]);
});

test("a step that cannot run stops the pipe and says which column is missing", async () => {
  const { runPipe } = await import("@/plugins/workspace/table-pipe");
  const r = runPipe(grid, [{ op: "limit", n: 2 }, { op: "sort", col: "Preis", dir: "asc" }]);
  assert.equal(r.failed, 1);
  assert.match(r.error ?? "", /no column “Preis”/);
  assert.equal(r.grid.rows.length, 2, "what ran before is kept");
});

test("steps are normalized: unknown ones dropped, text round-trips", async () => {
  const { normalizeSteps, stepsFromText, stepsToText } = await import("@/plugins/workspace/table-pipe");
  const s = normalizeSteps([{ op: "evil", x: 1 }, { op: "sort", col: "A", dir: "sideways" }, { op: "filter", col: "", cmp: "=" }, { op: "limit", n: -3 }, { op: "limit", n: 3 }]);
  assert.deepEqual(s, [{ op: "sort", col: "A", dir: "asc" }, { op: "limit", n: 3 }]);
  assert.deepEqual(stepsFromText(stepsToText(s)), s);
  assert.deepEqual(stepsFromText("not json"), []);
});

test("pipes chain by name, read the page's tables, and a loop is said", async () => {
  const { evaluatePipes, outcomeFor, gridOfCells } = await import("@/plugins/workspace/table-pipe");
  const head = ["Name", "Alter"].map((text) => ({ text, header: true }));
  const body = [["Ben", "30"], ["Anna", "25"], ["Cem", "41"]].map((r) => r.map((text) => ({ text, header: false })));
  const tables = [{ name: "Leute", grid: gridOfCells([head, ...body]) }];
  const pipes = [
    { name: "Alt", from: "Leute", steps: [{ op: "filter" as const, col: "Alter", cmp: ">=" as const, value: "30" }] },
    { name: "Sortiert", from: "Alt", steps: [{ op: "sort" as const, col: "Name", dir: "asc" as const }] },
    { name: "A", from: "B", steps: [] },
    { name: "B", from: "A", steps: [] },
  ];
  const out = evaluatePipes(tables, pipes);
  assert.deepEqual(outcomeFor("sortiert", tables, out).grid.rows, [["Ben", "30"], ["Cem", "41"]]);
  assert.match(outcomeFor("A", tables, out).error ?? "", /circle/);
  assert.match(outcomeFor("Nope", tables, out).error ?? "", /no table or pipe called/);
  assert.equal(outcomeFor("Leute", tables, out).grid.rows.length, 3, "a result table can show a page table as it is");
});

test("the ready-made examples run without an error", async () => {
  const { PIPE_EXAMPLES, runPipe } = await import("@/plugins/workspace/table-pipe");
  for (const e of PIPE_EXAMPLES) {
    const r = runPipe({ cols: e.cols, rows: e.rows }, e.steps);
    assert.equal(r.error, undefined, e.key);
    assert.ok(r.grid.rows.length > 0, e.key);
  }
  const budget = runPipe({ cols: PIPE_EXAMPLES[0].cols, rows: PIPE_EXAMPLES[0].rows }, PIPE_EXAMPLES[0].steps);
  assert.deepEqual(budget.grid.rows[0], ["Wohnen", 904]);
});

test("a page keeps its transform and result blocks as Markdown and back, and the sanitizer keeps only known steps", async () => {
  const { docToMarkdown, markdownToDoc, sanitizeDoc } = await import("@/plugins/workspace/doc");
  const steps = [{ op: "filter", col: "Betrag", cmp: ">", value: "50" }, { op: "sort", col: "Betrag", dir: "desc" }];
  const doc = { type: "doc", content: [
    { type: "tablePipe", attrs: { name: "Gross", from: "Ausgaben", steps: JSON.stringify(steps), desc: "Nur grosse Betraege", collapsed: true } },
    { type: "pipeResult", attrs: { of: "Gross", title: "Grosse Posten" } },
  ] };
  const md = docToMarkdown(doc as never);
  assert.match(md, /^:::pipe \{"name":"Gross","from":"Ausgaben","steps":\[/m);
  assert.match(md, /^:::result \{"of":"Gross","title":"Grosse Posten"\}$/m);
  const back = markdownToDoc(md);
  assert.equal(back.content[0].type, "tablePipe");
  assert.deepEqual(JSON.parse(String(back.content[0].attrs?.steps)), steps);
  assert.equal(back.content[0].attrs?.desc, "Nur grosse Betraege");
  assert.equal(back.content[0].attrs?.collapsed, true);
  assert.equal(back.content[1].attrs?.of, "Gross");
  // Steps longer than an ordinary attribute survive; unknown ones do not.
  const many = Array.from({ length: 20 }, (_, i) => ({ op: "filter", col: `Spalte ${i}`, cmp: "contains", value: "x".repeat(60) }));
  const clean = sanitizeDoc({ type: "doc", content: [{ type: "tablePipe", attrs: { name: "A", from: "B", steps: JSON.stringify([...many, { op: "evil" }]) } }] });
  assert.equal(JSON.parse(String(clean.content[0].attrs?.steps)).length, 20);
});

test("a panel holds blocks and is kept in Markdown (even nested in another); a container plan from the AI is made safe", async () => {
  const { docToMarkdown, markdownToDoc, sanitizeDoc } = await import("@/plugins/workspace/doc");
  const { normalizePlan } = await import("@/plugins/workspace/wrap-plan");
  const doc = { type: "doc", content: [{ type: "panel", attrs: { title: "Umsatz", desc: "Pro Verkäufer", collapsed: true }, content: [
    { type: "paragraph", content: [{ type: "text", text: "Hallo" }] },
    { type: "callout", attrs: { icon: "💡", tone: "gray" }, content: [{ type: "paragraph", content: [{ type: "text", text: "innen" }] }] },
  ] }] };
  const md = docToMarkdown(doc as never);
  assert.match(md, /^:::panel \{"title":"Umsatz","desc":"Pro Verkäufer","collapsed":true\}$/m);
  const back = markdownToDoc(md);
  assert.equal(back.content.length, 1);
  assert.equal(back.content[0].type, "panel");
  assert.deepEqual(back.content[0].attrs, { title: "Umsatz", desc: "Pro Verkäufer", collapsed: true });
  assert.deepEqual(back.content[0].content?.map((c) => c.type), ["paragraph", "callout"], "the box inside the panel stays inside it");
  assert.equal(sanitizeDoc(doc).content[0].type, "panel");

  assert.deepEqual(normalizePlan({ container: "Karte", title: "Umsatz", desc: "x" }), { container: "panel", title: "Umsatz", desc: "x" });
  assert.deepEqual(normalizePlan({ container: "columns", count: 9, tone: "red" }), { container: "columns", count: 4 });
  assert.deepEqual(normalizePlan({ container: "tabs", titles: ["A", "", "B"] }), { container: "tabs", titles: ["A", "B"] });
  assert.equal(normalizePlan({ container: "<script>" }), null);
  assert.equal(normalizePlan("panel"), null);
});

test("data flow: a transform reads a table, a result reads the block above, widgets share values — each link coloured, up or down", async () => {
  const { computeFlows, widgetFlows } = await import("@/plugins/workspace/data-flow");
  const blocks = [
    { pos: 0, kind: "table" as const, name: "Ausgaben", reads: [], writes: ["Ausgaben"] },
    { pos: 100, kind: "pipe" as const, name: "Summen", reads: ["Ausgaben"], writes: ["Summen"] },
    { pos: 200, kind: "result" as const, name: "", label: "Ergebnistabelle", reads: ["@above"], writes: [] },
  ];
  const { links, marks } = computeFlows(blocks);
  assert.deepEqual(links.map((l) => [l.name, l.from, l.to]), [["Ausgaben", 0, 100], ["Summen", 100, 200]]);
  assert.equal(links[0].color, links[1].color, "table, transform and result are one flow: one colour");
  const two = computeFlows([
    ...blocks,
    { pos: 300, kind: "table" as const, name: "Anderes", reads: [], writes: ["Anderes"] },
    { pos: 400, kind: "pipe" as const, name: "Zwei", reads: ["Anderes"], writes: ["Zwei"] },
  ]);
  assert.notEqual(two.marks.get(100)?.color, two.marks.get(400)?.color, "another pipeline has another colour");
  assert.equal(two.marks.get(300)?.color, two.marks.get(400)?.color);
  assert.deepEqual(marks.get(100)?.reads.map((r) => [r.name, r.dir]), [["Ausgaben", "up"]]);
  assert.deepEqual(marks.get(100)?.feeds.map((f) => f.name), ["Ergebnistabelle"], "it feeds the result table, not itself");
  assert.deepEqual(marks.get(0)?.feeds.map((f) => f.name), ["Summen"]);
  assert.equal(marks.get(200)?.reads[0].name, "Summen", "the block above is the transform, not the table beyond it");
  assert.equal(marks.get(0)?.reads.length, 0);

  const f = widgetFlows(`zeff.page.set("total", 5); zeff.emit('done'); zeff.publish("Umsatz", 1); const x = await zeff.page.get("limit"); zeff.on("page", f); zeff.on("refresh", g); zeff.on("changed", h)`);
  assert.deepEqual(f.writes.sort(), ["Umsatz", "done", "total"]);
  assert.deepEqual(f.reads.sort(), ["limit", "refresh"], "'page' and 'changed' name no value");
  const w = computeFlows([
    { pos: 0, kind: "widget" as const, name: "Anzeige", reads: ["total"], writes: [] },
    { pos: 50, kind: "widget" as const, name: "Regler", reads: [], writes: ["total"] },
  ]);
  assert.deepEqual(w.marks.get(0)?.reads.map((r) => r.dir), ["down"], "a widget further up may read one further down");
  assert.deepEqual(w.marks.get(50)?.feeds.map((r) => r.dir), ["up"]);
});

test("a table can be protected: its attribute is kept by the page", async () => {
  const { sanitizeDoc } = await import("@/plugins/workspace/doc");
  const cell = (t: string) => ({ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
  const doc = { type: "doc", content: [{ type: "table", attrs: { name: "Kosten", locked: true }, content: [{ type: "tableRow", content: [cell("a")] }] }] };
  assert.deepEqual(sanitizeDoc(doc).content[0].attrs, { name: "Kosten", locked: true });
});

test("a description from the AI is a sentence, never JSON", async () => {
  const { plainDescription } = await import("@/plugins/workspace/table-pipe");
  const sentence = "Zeigt die drei Verkäufer mit dem höchsten Gesamtumsatz.";
  assert.equal(plainDescription(sentence), sentence);
  assert.equal(plainDescription(`{"description":"${sentence}"}`), sentence);
  assert.equal(plainDescription({ description: sentence }), sentence);
  assert.equal(plainDescription("```json\n{\"description\":\"Nur Große.\"}\n```"), "Nur Große.");
  assert.equal(plainDescription(`"${sentence}"`), sentence);
  assert.equal(plainDescription('{"description":"Abgeschnitten …'), "Abgeschnitten …");
  assert.equal(plainDescription(undefined), "");
  assert.equal(plainDescription("[1,2]"), "");
});
