import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

/**
 * A database's pipeline — its steps as blocks: sources (Jira by criteria, Google Keep, the todos, another database), filters,
 * AI steps (a field on each row, or one summary). What comes out is kept in the database (materialized): rows made, changed,
 * gone ones to the trash; the AI fields filled for the rows that changed. Fake Claude CLI: no cost.
 */
const dir = setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

test("normalizePipeline: steps kept to what they can be", async () => {
  const { normalizePipeline } = await import("@/plugins/workspace/model");
  const p = normalizePipeline({
    steps: [
      { id: "s1", kind: "source", from: "jira", jira: { mine: true, recentDays: "14", commented: true, junk: 1 } },
      { id: "s2", kind: "source", from: "nowhere" },
      { kind: "filter", text: "  Login ", openOnly: true },
      { id: "a1", kind: "ai", output: "field", name: "Lage", prompt: "Wie steht es?", choices: ["a", "", "b"] },
      { id: "a2", kind: "ai", output: "bogus" },
      "junk",
    ],
  });
  assert.equal(p.steps.length, 3, "the unknown source, the unknown output and the junk dropped");
  assert.deepEqual(p.steps[0], { id: "s1", kind: "source", from: "jira", jira: { mine: true, recentDays: 14, commented: true } });
  assert.equal(p.steps[1].kind, "filter");
  assert.ok(p.steps[1].id, "a step without an id gets one");
  assert.equal(p.steps[1].text, "Login");
  assert.deepEqual(p.steps[2].choices, ["a", "b"]);
  assert.deepEqual(normalizePipeline(null), { steps: [] });
});

test("runPipeline: Jira by criteria, a filter, an AI field and a summary — kept in the database", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli", "workspace", "todos", "jira-lage", "keep"]) setInstalled(id, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  const { getDb, schema } = await import("@/db");
  const { keepComments } = await import("@/lib/jira/comments");
  const w = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");

  const ticket = (key: string, extra: Record<string, unknown> = {}) =>
    getDb().insert(schema.jiraTickets).values({ key, summary: `Summary ${key}`, status: "In Arbeit", statusCategory: "inprogress", assignee: "Ich", priority: "High", url: `https://jira.example/browse/${key}`, mine: true, updatedAt: daysAgo(2), ...extra }).run();
  ticket("PROJ-1");
  ticket("PROJ-2", { summary: "Login kaputt" });
  ticket("PROJ-3", { mine: false, assignee: "Anna" }); // not mine
  ticket("PROJ-4", { updatedAt: daysAgo(40) }); // too old
  ticket("PROJ-5", { statusCategory: "done", status: "Fertig", resolvedAt: daysAgo(1) }); // done
  ticket("PROJ-6", { summary: "Login ohne Kommentar" }); // no comment lately
  keepComments([
    { id: "c1", ticket: "PROJ-1", author: "Anna", at: daysAgo(1), body: "Bitte prüfen" },
    { id: "c2", ticket: "PROJ-2", author: "Ich", at: daysAgo(3), body: "Login geht wieder nicht" },
    { id: "c6", ticket: "PROJ-6", author: "Anna", at: daysAgo(30), body: "Alt" },
  ]);

  const dbId = w.createPage({ kind: "database", title: "Meine Lage", schema: { titleName: "Ticket", properties: [], views: [{ id: "v1", name: "Board", type: "board", filter: { op: "and", rules: [] }, sorts: [], hidden: [] }] } });
  w.updateSchema(dbId, {
    ...w.getDatabase(dbId)!.schema,
    pipeline: {
      steps: [
        { id: "src", kind: "source", from: "jira", jira: { mine: true, recentDays: 14, commented: true, openOnly: true } },
        { id: "lage", kind: "ai", output: "field", name: "Lage", prompt: "Ein Satz: wie es steht." },
        { id: "sum", kind: "ai", output: "summary", prompt: "Die Gesamtlage." },
      ],
    },
  });

  // Without the AI: the rows only.
  const first = await runPipeline(dbId, { ai: false });
  assert.equal(first.ok, true, first.error);
  assert.deepEqual([first.records, first.created], [2, 2], "mine, open, commented within 14 days: PROJ-1, PROJ-2");
  const d = w.getDatabase(dbId)!;
  const rows = w.rawRows(dbId);
  const byKey = (k: string) => rows.find((r) => r.cells.ticketkey === k)!;
  assert.equal(byKey("PROJ-2").title, "Login kaputt");
  const status = d.schema.properties.find((p) => p.type === "status")!;
  assert.equal(status.options!.find((o) => o.id === byKey("PROJ-1").cells[status.id])?.group, "doing", "the status with its phase");
  assert.ok(d.schema.properties.some((p) => p.name === "Assignee"), "the source's fields as properties");
  const lage = d.schema.properties.find((p) => p.name === "Lage")!;
  assert.equal(lage.type, "ai", "the AI step's field");
  assert.equal(lage.aiPrompt, "Ein Satz: wie es steht.");
  assert.equal(d.schema.views[0].groupBy, status.id, "a board groups by the status");
  assert.ok(!fs.existsSync(promptFile), "no AI yet");

  // With the AI: the field per row, then the summary.
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ rows: [{ id: byKey("PROJ-1").id, values: { [lage.id]: "Wartet auf Prüfung." } }, { id: byKey("PROJ-2").id, values: { [lage.id]: "Login wieder kaputt." } }], text: "Zwei Tickets offen." });
  const second = await runPipeline(dbId, { ai: true });
  assert.equal(second.ok, true, second.error);
  assert.equal(second.reviewed, 2);
  assert.equal(w.getPage(byKey("PROJ-1").id)!.props[lage.id], "Wartet auf Prüfung.");
  const sum = w.getDatabase(dbId)!.schema.pipeline!.steps.find((s) => s.id === "sum")!;
  assert.equal(sum.result?.text, "Zwei Tickets offen.", "the summary kept with its step");
  assert.match(fs.readFileSync(promptFile, "utf8"), /PROJ-2/);

  // A filter step narrows; a row gone from the output goes to the trash; the rest stays (its AI field too).
  w.updateSchema(dbId, { ...w.getDatabase(dbId)!.schema, pipeline: { steps: [...w.getDatabase(dbId)!.schema.pipeline!.steps.slice(0, 1), { id: "f", kind: "filter", text: "login" }, ...w.getDatabase(dbId)!.schema.pipeline!.steps.slice(1)] } });
  const third = await runPipeline(dbId, { ai: false });
  assert.deepEqual([third.records, third.created, third.archived], [1, 0, 1]);
  assert.deepEqual(w.rawRows(dbId).map((r) => r.cells.ticketkey), ["PROJ-2"]);
  assert.equal(w.rawRows(dbId)[0].cells[lage.id], "Login wieder kaputt.");
});

test("runPipeline: another database, the todos and Google Keep as sources", async () => {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { addManualTodo } = await import("@/lib/boards/store");
  const g = await import("@/plugins/keep/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");

  const status: import("@/plugins/workspace/model").Property = { id: "st", name: "Status", type: "status", options: [{ id: "o1", name: "Offen", color: "gray", group: "todo" }, { id: "o2", name: "Fertig", color: "green", group: "done" }] };
  const lead: import("@/plugins/workspace/model").Property = { id: "lead", name: "Lead", type: "ai" };
  const other = w.createPage({ kind: "database", title: "Quelle", schema: { titleName: "Name", properties: [status, lead], views: [m.newView("Table")] } });
  const a = w.addRow(other, { title: "Steuer", cells: { st: "o1", lead: "Belege fehlen" } });
  w.addRow(other, { title: "Erledigt", cells: { st: "o2" } });
  addManualTodo({ ticket: "WS-1", text: "Belege sammeln" });
  g.saveKeepNotes([{ id: "g1", kind: "note", title: "Einkauf", text: "Milch", labels: ["Haushalt"], color: null, pinned: false, archived: false, createdAt: daysAgo(3), updatedAt: daysAgo(2), url: "" }], true);

  const dbId = w.createPage({ kind: "database", title: "Alles", schema: { titleName: "Name", properties: [], views: [m.newView("Table")], pipeline: { steps: [
    { id: "s1", kind: "source", from: "database", dbId: other },
    { id: "s2", kind: "source", from: "todos" },
    { id: "s3", kind: "source", from: "keep" },
    { id: "f", kind: "filter", openOnly: true },
  ] } } });
  const r = await runPipeline(dbId, { ai: false });
  assert.equal(r.ok, true, r.error);
  const rows = w.rawRows(dbId);
  assert.deepEqual(rows.map((x) => x.title).sort(), ["Belege sammeln", "Einkauf", "Steuer"], "the done row left out by the filter");
  const d = w.getDatabase(dbId)!;
  const leadHere = d.schema.properties.find((p) => p.name === "Lead")!;
  assert.equal(rows.find((x) => x.title === "Steuer")!.cells[leadHere.id], "Belege fehlen", "another board's AI field is consumed as a value");
  assert.equal(rows.find((x) => x.title === "Steuer")!.cells.srcref, `page:${a}`);
  assert.equal(rows.find((x) => x.title === "Einkauf")!.cells.srcref, "keep:g1");
  assert.match(String(rows.find((x) => x.title === "Belege sammeln")!.cells.srcref), /^todo:/);

  const again = await runPipeline(dbId, { ai: false });
  assert.deepEqual([again.created, again.updated, again.archived], [0, 0, 0], "nothing changed: nothing written");
});
