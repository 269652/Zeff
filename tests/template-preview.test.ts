import assert from "node:assert/strict";
import test from "node:test";
import { previewParts, type MadePage } from "@/plugins/workspace/template-preview";

/** (The labels as they are written — the test reads the names, not a language.) */
const t = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

const db = (id: number, parentId: number | null, title: string, extra: Partial<MadePage> = {}): MadePage => ({
  id,
  parentId,
  title,
  icon: "📚",
  kind: "database",
  titleName: "Titel",
  properties: [
    { name: "Autor", type: "text" },
    { name: "Status", type: "status" },
  ],
  views: ["Tabelle", "Board"],
  examples: ["Shape Up", "Refactoring UI"],
  rows: 2,
  ...extra,
});
const page = (id: number, parentId: number | null, title: string, content: unknown = null): MadePage & { content: unknown; fullWidth: boolean } => ({
  id,
  parentId,
  title,
  icon: "📓",
  kind: "page",
  properties: [],
  views: [],
  examples: [],
  rows: 0,
  content,
  fullWidth: false,
});
const doc = (...content: unknown[]) => ({ type: "doc", content });
const textOf = (x: unknown) => JSON.stringify(x);

test("the preview: blocks that point at what the template makes are static cards — the database's fields and views, the sub page's title", () => {
  const root = page(10, null, "Journal", doc({ type: "paragraph", content: [{ type: "text", text: "Hallo" }] }, { type: "databaseView", attrs: { dbId: 11, viewId: "v1", title: "" } }, { type: "pageEmbed", attrs: { pageId: 12, title: "" } }));
  const made = [root, db(11, 10, "Lesestapel"), page(12, 10, "Wochenrückblick")];
  const p = previewParts(root, made, t);
  const blocks = (p.page.content as { content: { type: string; attrs?: Record<string, unknown> }[] }).content;
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["paragraph", "callout", "callout"],
    "the embeds are cards",
  );
  const card = textOf(blocks[1]);
  for (const w of ["Lesestapel", "Titel", "Autor", "Status", "Tabelle", "Board", "Shape Up"]) assert.ok(card.includes(w), `${w} in ${card}`);
  assert.ok(textOf(blocks[2]).includes("Wochenrückblick"));
  assert.ok(!/"(dbId|pageId)":1[12]/.test(textOf(p.page)), "nothing left that points at a made id");
});

test("the preview: nested embeds, forms, to-do lists, widgets and a routine's controls pointing at made ids become cards; what points elsewhere stays live", () => {
  const root = page(
    20,
    null,
    "Projekte",
    doc(
      { type: "flexBox", attrs: { dir: "row" }, content: [{ type: "flexBox", attrs: { dir: "col" }, content: [{ type: "databaseView", attrs: { dbId: 21, viewId: "", title: "" } }] }] },
      { type: "zeffForm", attrs: { formId: 21 } },
      { type: "todoListEmbed", attrs: { pageId: 22, listId: "x" } },
      { type: "zeffWidget", attrs: { widget: "workspace.database", config: JSON.stringify({ database: "21" }), title: "" } },
      { type: "zeffWidget", attrs: { widget: "todos.done", config: JSON.stringify({ limit: 5 }), title: "" } },
      { type: "databaseView", attrs: { dbId: 999, viewId: "", title: "" } },
      { type: "zeffRoutine" },
      { type: "paragraph", content: [{ type: "zeffRef", attrs: { kind: "page", ref: "22", label: "Aufgaben", href: "/workspace/22" } }] },
    ),
  );
  const made = [root, db(21, 20, "Projekte DB"), page(22, 20, "Notizen")];
  const blocks = (previewParts(root, made, t).page.content as { content: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }[] }).content;
  assert.ok(textOf(blocks[0]).includes('"callout"') && !textOf(blocks[0]).includes("databaseView"), "inside columns too");
  assert.deepEqual(
    blocks.slice(1, 4).map((b) => b.type),
    ["callout", "callout", "callout"],
  );
  assert.equal(blocks[4].type, "zeffWidget", "a widget of your data stays live");
  assert.equal(blocks[5].type, "databaseView", "a database that is there already stays live");
  assert.equal(blocks[6].type, "callout", "the routine's controls (its page is not made) are a card");
  assert.equal(textOf(blocks[7]).includes("zeffRef"), false, "a mention of a made page is its name as text");
  assert.ok(textOf(blocks[7]).includes("Aufgaben"));
});

test("the preview's lists: what is below the page, and the databases that are not shown on it already (a database template: itself)", () => {
  const root = page(30, null, "Journal", doc({ type: "databaseView", attrs: { dbId: 31, viewId: "", title: "" } }));
  const made = [root, db(31, 30, "Einträge"), db(32, 30, "Rückblicke"), page(33, 30, "Wochen-Agent"), page(34, 33, "Tiefer")];
  const p = previewParts(root, made, t);
  assert.deepEqual(
    p.children.map((c) => c.title),
    ["Einträge", "Rückblicke", "Wochen-Agent"],
  );
  assert.deepEqual(
    p.databases.map((d) => d.title),
    ["Rückblicke"],
    "the one on the page is its card already",
  );
  const tasks = db(40, null, "Aufgaben");
  const only = previewParts({ ...tasks, content: null, fullWidth: false }, [tasks], t);
  assert.deepEqual(
    only.databases.map((d) => [d.title, d.views, d.rows]),
    [["Aufgaben", ["Tabelle", "Board"], 2]],
  );
  assert.deepEqual(
    only.databases[0].properties.map((x) => x.name),
    ["Autor", "Status"],
  );
});
