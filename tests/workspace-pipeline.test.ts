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
  // As Jira's sync keeps some times: local, with the zone's name.
  const local = new Date(Date.now() - 864e5);
  const p2 = (n: number) => String(n).padStart(2, "0");
  ticket("PROJ-9", { summary: "Lokale Zeit", updatedAt: `${local.getFullYear()}-${p2(local.getMonth() + 1)}-${p2(local.getDate())} ${p2(local.getHours())}:${p2(local.getMinutes())}:00 Mitteleuropäische Sommerzeit` });
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
  // Changed within 14 days, no comment asked for: the local time read as a time.
  const plain = { ...w.getDatabase(dbId)!.schema };
  w.updateSchema(dbId, { ...plain, pipeline: { steps: [{ id: "src", kind: "source", from: "jira", jira: { mine: true, recentDays: 14, openOnly: true } }] } });
  const byTime = await runPipeline(dbId, { ai: false });
  assert.ok(w.rawRows(dbId).some((r) => r.cells.ticketkey === "PROJ-9"), `a ticket changed yesterday, by Jira's local time (${byTime.records} rows)`);
  for (const r of w.rawRows(dbId)) w.archivePage(r.id);
  w.updateSchema(dbId, plain);

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

  // Done lately: still in with doneDays; the who-criteria are either-or.
  ticket("PROJ-8", { mine: false, assignee: "Anna", statusCategory: "done", status: "Fertig", resolvedAt: daysAgo(1), updatedAt: daysAgo(1) });
  keepComments([{ id: "c8", ticket: "PROJ-8", author: "Anna", at: daysAgo(1), body: "Erledigt" }]);
  const { setFollowed } = await import("@/lib/todos/followed");
  setFollowed("PROJ-8", 1);
  const cur = w.getDatabase(dbId)!.schema.pipeline!.steps;
  w.updateSchema(dbId, { ...w.getDatabase(dbId)!.schema, pipeline: { steps: [{ ...cur[0], jira: { mine: true, involved: true, recentDays: 14, commented: true, openOnly: true, doneDays: 3 } }, ...cur.slice(1)] } });
  const withDone = await runPipeline(dbId, { ai: false });
  assert.equal(withDone.records, 3, "PROJ-8: not mine but followed, done yesterday");
  w.updateSchema(dbId, { ...w.getDatabase(dbId)!.schema, pipeline: { steps: cur } });
  await runPipeline(dbId, { ai: false });

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
  const { addManualTodo } = await import("@/lib/todos/store");
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

test("runPipeline: a database a sync keeps (My briefing) — the sync is its source, its AI steps run over the sync's rows", async () => {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { setDatabaseSource } = await import("@/plugins/workspace/collections");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const key = { ...m.newProperty("Key", "text"), id: "ticketkey" };
  const dbId = w.createPage({ kind: "database", title: "My briefing", schema: { titleName: "Summary", properties: [key], views: [m.newView("Board", "board")], review: { on: true, skipBriefed: true, openOnly: true, recentDays: 30 } } });
  w.updatePage(dbId, { locked: true });
  setDatabaseSource(dbId, "jira");
  const a = w.addRow(dbId, { title: "Login kaputt", cells: { ticketkey: "PROJ-7" } });
  w.updateSchema(dbId, { ...w.getDatabase(dbId)!.schema, pipeline: { steps: [
    { id: "src", kind: "source", from: "todos" }, // not for a synced database: its sync is the source
    { id: "f", kind: "filter", text: "nothing matches" },
    { id: "lage", kind: "ai", output: "field", name: "Lage", prompt: "Ein Satz." },
  ] } });

  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ rows: [{ id: a, values: { ai_lage: "Kaputt seit gestern." } }], text: "" });
  const r = await runPipeline(dbId, { ai: true });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.created, r.archived], [0, 0], "the sync's rows stay as the sync keeps them");
  assert.deepEqual(w.rawRows(dbId).map((x) => x.id), [a]);
  const d = w.getDatabase(dbId)!;
  assert.ok(d.schema.properties.some((p) => p.id === "ai_lage" && p.type === "ai"), "the AI step's field");
  assert.ok(!d.schema.properties.some((p) => p.id === "srcref"), "no source bookkeeping");
  assert.deepEqual(d.schema.review, { on: true, skipBriefed: true, openOnly: true, recentDays: 30 }, "the review's scope kept");
  assert.equal(r.reviewed, 1);
  assert.equal(w.getPage(a)!.props.ai_lage, "Kaputt seit gestern.");
});

test("runPipeline: a database's own status and select properties take the source's values (options added); a summary only again when the rows changed", async () => {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { getDb, schema } = await import("@/db");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  getDb().insert(schema.jiraTickets).values({ key: "SEL-1", summary: "Auswahl", status: "Review", statusCategory: "inprogress", priority: "Highest", mine: true, updatedAt: daysAgo(1) }).run();
  const status: import("@/plugins/workspace/model").Property = { id: "jirastatus", name: "Status", type: "status", options: [] };
  const prio: import("@/plugins/workspace/model").Property = { id: "jirapriority", name: "Priority", type: "select", options: [] };
  const dbId = w.createPage({ kind: "database", title: "Eigene", schema: { titleName: "Name", properties: [status, prio], views: [{ ...m.newView("Board", "board"), groupBy: "jirastatus" }], pipeline: { steps: [
    { id: "src", kind: "source", from: "jira", jira: { projects: ["SEL"] } },
    { id: "sum", kind: "ai", output: "summary", prompt: "Lage." },
  ] } } });
  const r = await runPipeline(dbId, { ai: false });
  assert.equal(r.ok, true, r.error);
  const d = w.getDatabase(dbId)!;
  assert.ok(!d.schema.properties.some((p) => p.id === "srcstatus"), "its own status property is used");
  const row = w.rawRows(dbId)[0];
  const opt = (pid: string) => d.schema.properties.find((p) => p.id === pid)!.options!.find((o) => o.id === row.cells[pid]);
  assert.equal(opt("jirastatus")?.name, "Review");
  assert.equal(opt("jirastatus")?.group, "doing");
  assert.equal(opt("jirapriority")?.name, "Highest", "a select gets the value as its option");

  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ text: "Eine Sache in Review." });
  if (fs.existsSync(promptFile)) fs.rmSync(promptFile);
  await runPipeline(dbId, { ai: true });
  assert.ok(fs.existsSync(promptFile), "the summary written");
  fs.rmSync(promptFile);
  await runPipeline(dbId, { ai: true });
  assert.ok(!fs.existsSync(promptFile), "rows unchanged: the summary not again");
  assert.equal(w.getDatabase(dbId)!.schema.pipeline!.steps.find((s) => s.id === "sum")!.result?.text, "Eine Sache in Review.");
});

test("instructions: Workspace pages under KI-Anweisungen, chosen by AI steps — their text goes with the field's and the summary's prompt", async () => {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { markdownToDoc } = await import("@/plugins/workspace/doc");
  const { listInstructions, newInstruction, instructionsFolder } = await import("@/plugins/workspace/instructions");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");

  const seeded = listInstructions();
  assert.ok(seeded.some((i) => i.title === "Lage"), "a first one: the Lage's rules");
  const folder = instructionsFolder();
  assert.equal(w.getPage(folder)!.title, "KI-Anweisungen");
  const id = await newInstruction("Ton");
  assert.equal(w.getPage(w.getPage(id)!.parentId!)!.title, "My prompts", "made under System → Prompts → My prompts");
  w.updatePage(id, { content: markdownToDoc("Schreib wie ein Pirat.") });
  assert.ok(listInstructions().some((i) => i.id === id));
  assert.equal(m.normalizePipeline({ steps: [{ id: "a", kind: "ai", output: "summary", instructions: [id, "x", -1] }] }).steps[0].instructions?.join(), String(id));

  const { addManualTodo } = await import("@/lib/todos/store");
  addManualTodo({ ticket: "WS-77", text: "Instruktion testen" });
  const dbId = w.createPage({ kind: "database", title: "Mit Anweisung", schema: { titleName: "Name", properties: [], views: [m.newView("Table")], pipeline: { steps: [
    { id: "s", kind: "source", from: "todos" },
    { id: "f", kind: "filter", text: "Instruktion" },
    { id: "lage", kind: "ai", output: "field", name: "Lage", prompt: "Ein Satz.", instructions: [id] },
    { id: "sum", kind: "ai", output: "summary", prompt: "Alles.", instructions: [id] },
  ] } } });
  const row = () => w.rawRows(dbId)[0];
  await runPipeline(dbId, { ai: false });
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ rows: [{ id: row().id, values: { ai_lage: "Arr." } }], text: "Arr, alles." });
  fs.writeFileSync(promptFile, "");
  await runPipeline(dbId, { ai: true });
  assert.match(fs.readFileSync(promptFile, "utf8"), /Schreib wie ein Pirat\./, "the instruction in the prompt (the last one: the summary's)");
  assert.equal(w.getPage(row().id)!.props.ai_lage, "Arr.");

  // The instruction changed: the rows read again.
  w.updatePage(id, { content: markdownToDoc("Schreib wie ein Seemann.") });
  fs.rmSync(promptFile);
  const again = await runPipeline(dbId, { ai: true });
  assert.equal(again.reviewed, 1, "a changed instruction: read again");
});

test("sort step: the rows in the order of a field — a field with choices by its choices (the most pressing first), empty ones last", async () => {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  assert.deepEqual(m.normalizePipeline({ steps: [{ id: "o", kind: "sort", by: " Attention ", dir: "desc" }, { kind: "sort" }] }).steps, [{ id: "o", kind: "sort", by: "Attention", dir: "desc" }], "a sort needs its field");
  const from = w.createPage({ kind: "database", title: "Unsortiert", schema: { titleName: "Name", properties: [], views: [m.newView("Table")] } });
  for (const x of ["Sortiert A", "Sortiert B", "Sortiert C"]) w.addRow(from, { title: x });
  const dbId = w.createPage({ kind: "database", title: "Sortiert", schema: { titleName: "Name", properties: [], views: [m.newView("Table")], pipeline: { steps: [
    { id: "s", kind: "source", from: "database", dbId: from },
    { id: "att", kind: "ai", output: "field", name: "Attention", choices: ["feedback", "active", "stale"] },
    { id: "o", kind: "sort", by: "Attention" },
  ] } } });
  await runPipeline(dbId, { ai: false });
  const id = (title: string) => w.rawRows(dbId).find((r) => r.title === title)!.id;
  const ids = { a: id("Sortiert A"), b: id("Sortiert B"), c: id("Sortiert C") };
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ rows: [{ id: ids.a, values: { ai_att: "stale" } }, { id: ids.c, values: { ai_att: "feedback" } }], text: "" });
  await runPipeline(dbId, { ai: true });
  assert.deepEqual(w.rawRows(dbId).map((r) => r.title), ["Sortiert C", "Sortiert A", "Sortiert B"], "feedback before stale, the one without last");
  await runPipeline(dbId, { ai: false });
  assert.deepEqual(w.rawRows(dbId).map((r) => r.title), ["Sortiert C", "Sortiert A", "Sortiert B"], "kept so by the next run");
});

test("startPipeline: a run in the background — one at a time per database, known as running until it's done", async () => {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { startPipeline, pipelineRunning } = await import("@/plugins/workspace/pipeline");
  const dbId = w.createPage({ kind: "database", title: "Hinten", schema: { titleName: "Name", properties: [], views: [m.newView("Table")], pipeline: { steps: [{ id: "s", kind: "source", from: "todos" }] } } });
  const first = startPipeline(dbId, { ai: false });
  assert.equal(first.started, true);
  assert.equal(pipelineRunning(dbId), true);
  assert.equal(startPipeline(dbId, { ai: false }).started, false, "already running: not twice");
  const r = await first.done;
  assert.equal(r.ok, true, r.error);
  assert.equal(pipelineRunning(dbId), false);
});

test("runPipeline: rows of your own (a card, a subtask) stay — only what came from a source goes when the source drops it", async () => {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const from = w.createPage({ kind: "database", title: "Quelle eigen", schema: { titleName: "Name", properties: [], views: [m.newView("Table")] } });
  const src = w.addRow(from, { title: "Aus der Quelle" });
  const dbId = w.createPage({ kind: "database", title: "Mit eigenen", schema: { titleName: "Name", properties: [], views: [m.newView("Table")], pipeline: { steps: [{ id: "s", kind: "source", from: "database", dbId: from }] } } });
  await runPipeline(dbId, { ai: false });
  const mine = w.addRow(dbId, { title: "Meine eigene Karte" });
  await runPipeline(dbId, { ai: false });
  assert.ok(w.rawRows(dbId).some((r) => r.id === mine), "my own row stays");
  w.archivePage(src);
  await runPipeline(dbId, { ai: false });
  assert.deepEqual(w.rawRows(dbId).map((r) => r.title), ["Meine eigene Karte"], "the source's row gone, mine kept");
});
