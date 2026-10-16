import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// The AI review of a database: its AI properties filled for the rows that changed — a choice where the property has
// choices — reading the row and, by its key, what Zeff knows about its ticket. Fake Claude CLI: no cost.
const dir = setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;

test("reviewDatabase: the AI properties of the changed rows, choices kept to, unchanged rows left", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli", "workspace", "todos"]) setInstalled(id, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { reviewDatabase, reviewDatabases } = await import("@/plugins/workspace/review");
  const { addManualTodo } = await import("@/lib/boards/store");

  const attention: import("@/plugins/workspace/model").Property = { id: "att", name: "Attention", type: "ai", aiPrompt: "How it stands.", aiChoices: ["blocked", "active", "ready"] };
  const lead: import("@/plugins/workspace/model").Property = { id: "lead", name: "Lead", type: "ai", aiPrompt: "One sentence: what's next." };
  const key = { ...m.newProperty("Key", "text"), id: "ticketkey" };
  const dbId = w.createPage({ kind: "database", title: "Review", schema: { titleName: "Name", properties: [attention, lead, key], views: [m.newView("Table")], review: { on: true } } });
  const a = w.addRow(dbId, { title: "Steuer", cells: { ticketkey: "WS-900" } });
  const b = w.addRow(dbId, { title: "Urlaub buchen" });
  w.updatePage(b, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Flug nach Lissabon" }] }] } });
  addManualTodo({ ticket: "WS-900", text: "Belege sammeln" });

  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({
    rows: [
      { id: a, values: { att: "blocked", lead: "Wartet auf Belege." } },
      { id: b, values: { att: "nonsense", lead: "Flug buchen." } },
    ],
  });
  const r = await reviewDatabase(dbId);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.reviewed, 2);
  const prompt = fs.readFileSync(promptFile, "utf8");
  assert.match(prompt, /„Attention“.*How it stands\./);
  assert.match(prompt, /blocked \| active \| ready/, "the choices are named");
  assert.match(prompt, /Flug nach Lissabon/, "the row's page");
  assert.match(prompt, /Belege sammeln/, "what Zeff knows about its ticket: its todos");
  const cell = (row: number, p: string) => w.getPage(row)!.props[p];
  assert.equal(cell(a, "att"), "blocked");
  assert.equal(cell(a, "lead"), "Wartet auf Belege.");
  assert.equal(cell(b, "att"), undefined, "not one of the choices: left empty");
  assert.equal(cell(b, "lead"), "Flug buchen.");

  fs.rmSync(promptFile);
  const again = await reviewDatabase(dbId);
  assert.equal(again.reviewed, 0, "unchanged: not again");
  assert.equal(again.unchanged, 2);
  assert.ok(!fs.existsSync(promptFile), "no AI call");

  w.updatePage(b, { title: "Urlaub buchen (Mai)" });
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ rows: [{ id: b, values: { att: "ready", lead: "Im Mai." } }] });
  const changed = await reviewDatabase(dbId);
  assert.equal(changed.reviewed, 1, "the changed row only");
  assert.equal(cell(b, "att"), "ready");

  const off = w.createPage({ kind: "database", title: "Off", schema: { titleName: "Name", properties: [lead], views: [m.newView("Table")] } });
  w.addRow(off, { title: "x" });
  const all = await reviewDatabases();
  assert.deepEqual(all.map((x) => x.dbId), [dbId], "only the databases with the review on");
});

test("reviewDatabase: a row ticked in the pipeline's keep checkbox is final — the AI leaves it", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli", "workspace"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { reviewDatabase } = await import("@/plugins/workspace/review");
  const ok: import("@/plugins/workspace/model").Property = { id: "ok", name: "Checked", type: "checkbox" };
  const kind: import("@/plugins/workspace/model").Property = { id: "kind", name: "Kind", type: "ai", aiPrompt: "What it is.", aiChoices: ["a", "b"] };
  const dbId = w.createPage({ kind: "database", title: "Final", schema: { titleName: "Name", properties: [ok, kind], views: [m.newView("Table")], review: { on: true }, pipeline: { steps: [], keepProp: "ok" } } });
  const done = w.addRow(dbId, { title: "Geprüft", cells: { ok: true, kind: "a" } });
  const open = w.addRow(dbId, { title: "Offen" });
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ rows: [{ id: done, values: { kind: "b" } }, { id: open, values: { kind: "b" } }] });
  const r = await reviewDatabase(dbId);
  assert.equal(r.ok, true, r.error);
  assert.equal(w.getPage(done)!.props.kind, "a", "ticked: its value stays");
  assert.equal(w.getPage(open)!.props.kind, "b", "not ticked: filled");
});
