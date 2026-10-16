import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

/**
 * A database made from another (under it): its pipeline reads the other's rows with their fields as they are (same ids
 * and types — a mail stays a mail: the mail view shows it); an AI step filters them by an instruction ("important, urgent,
 * or needs me to act") — each row judged once (again when it changes), only new ones after a sync, the AI's reason with
 * the ones that pass.
 */
const dir = setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;
const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();

test("derived database with an AI filter: important mails only, judged once each, a mail database still", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli", "workspace", "outlook-mail", "mail-client"]) setInstalled(id, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  const { saveMails } = await import("@/lib/mail/store");
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createDerivedDatabase } = await import("@/plugins/workspace/derived");
  saveMails([
    { convId: "AAQk1", folder: "Posteingang", from: "Chef", fromEmail: "chef@example.com", subject: "Bitte bis heute freigeben", preview: "Brauche deine Freigabe bis 17 Uhr.", receivedAt: ago(1), unread: true },
    { convId: "AAQk2", folder: "Posteingang", from: "Newsletter", fromEmail: "news@example.com", subject: "Wochenrückblick", preview: "Die Highlights der Woche.", receivedAt: ago(2), unread: true },
  ]);
  const mail = w.createPage({ kind: "database", title: "Mail", schema: { titleName: "Subject", properties: [], views: [m.newView("Table")], pipeline: { steps: [{ id: "s", kind: "source", from: "mail" }] } } });
  await runPipeline(mail, { ai: false });

  const id = createDerivedDatabase(mail, "Wichtige Mails");
  const d = w.getDatabase(id)!;
  assert.equal(d.page.parentId, mail, "under the database it reads");
  assert.equal(d.schema.views[0].type, "app", "shown as the mail client");
  const steps = d.schema.pipeline!.steps;
  assert.deepEqual([steps[0].kind, steps[0].from, steps[0].dbId], ["source", "database", mail]);
  assert.equal(steps[1].kind, "ai");
  assert.equal(steps[1].output, "filter");

  // The AI's verdicts: the first record (the newest — the boss) yes, the newsletter no.
  w.updateSchema(id, { ...d.schema, pipeline: { steps: [steps[0], { ...steps[1], prompt: "Nur wichtige, dringende oder Mails, bei denen ich handeln muss." }] } });
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ rows: [{ n: 1, keep: true, why: "Freigabe bis heute" }, { n: 2, keep: false, why: "Newsletter" }] });
  const r = await runPipeline(id, { ai: false });
  assert.equal(r.ok, true, r.error);
  const prompt = fs.readFileSync(promptFile, "utf8");
  assert.match(prompt, /Nur wichtige, dringende/);
  assert.match(prompt, /Bitte bis heute freigeben/);
  const rows = w.rawRows(id);
  assert.deepEqual(rows.map((x) => x.title), ["Bitte bis heute freigeben"], "only what the AI kept");
  const after = w.getDatabase(id)!;
  assert.equal(after.schema.dataType, "mail", "still a mail database (the mail view's)");
  assert.equal(rows[0].cells.mailfrom, "Chef <chef@example.com>", "the mail's fields as they were");
  assert.equal(rows[0].cells.mailunread, true);
  assert.equal(rows[0].cells.filterwhy, "Freigabe bis heute", "the AI's reason");

  // Again: nothing new — no AI.
  fs.rmSync(promptFile);
  await runPipeline(id, { ai: false });
  assert.ok(!fs.existsSync(promptFile), "judged once each");
  assert.equal(w.rawRows(id).length, 1);

  // A new mail: only it goes to the AI.
  saveMails([{ convId: "AAQk3", folder: "Posteingang", from: "Kunde", fromEmail: "k@example.com", subject: "Server down!", preview: "Nichts geht mehr.", receivedAt: ago(0.2), unread: true }]);
  await runPipeline(mail, { ai: false });
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ rows: [{ n: 1, keep: true, why: "Ausfall" }] });
  await runPipeline(id, { ai: false });
  const again = fs.readFileSync(promptFile, "utf8");
  assert.match(again, /Server down!/);
  assert.doesNotMatch(again, /Wochenrückblick/, "the ones judged before aren't asked again");
  assert.deepEqual(w.rawRows(id).map((x) => x.title).sort(), ["Bitte bis heute freigeben", "Server down!"]);
});

test("any source or database derivable: a database from a data source; an AI filter without a condition lets everything through", async () => {
  const w = await import("@/plugins/workspace/store");
  const { createSourceDatabase, createDerivedDatabase } = await import("@/plugins/workspace/derived");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  for (const from of ["jira", "keep", "todos", "mail", "messages"] as const) {
    const id = createSourceDatabase(from);
    const steps = w.getDatabase(id)!.schema.pipeline!.steps;
    assert.equal(steps[0].from, from, `a database from ${from}`);
  }
  const todos = createSourceDatabase("todos");
  const { addManualTodo } = await import("@/lib/boards/store");
  addManualTodo({ ticket: "WS-5", text: "Steuererklärung abgeben" });
  await runPipeline(todos, { ai: false });
  const derived = createDerivedDatabase(todos);
  const s = w.getDatabase(derived)!.schema.pipeline!.steps;
  assert.equal(s[1].output, "filter");
  assert.equal(s[1].prompt, undefined, "no condition yet (not a mail's)");
  if (fs.existsSync(promptFile)) fs.rmSync(promptFile);
  await runPipeline(derived, { ai: false });
  assert.ok(!fs.existsSync(promptFile), "without a condition: no AI");
  assert.ok(w.rawRows(derived).some((r) => r.title.startsWith("Steuererklärung")), "everything through");
});

test("the AI filter's frame: strict (in doubt: not kept, notifications only when they ask something of me) — a change to it judges again", async () => {
  const { AI_FILTER } = await import("@/plugins/workspace/pipeline");
  assert.doesNotMatch(AI_FILTER, /lieber behalten/, "not: keep when in doubt");
  assert.match(AI_FILTER, /Im Zweifel: nicht behalten/);
  assert.match(AI_FILTER, /Benachrichtigungen/);
  const w = await import("@/plugins/workspace/store");
  const p = await import("@/lib/prompts");
  const { markdownToDoc } = await import("@/plugins/workspace/doc");
  const { createSourceDatabase, createDerivedDatabase } = await import("@/plugins/workspace/derived");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { addManualTodo } = await import("@/lib/boards/store");
  addManualTodo({ ticket: "WS-6", text: "Rahmen prüfen" });
  const src = createSourceDatabase("todos");
  await runPipeline(src, { ai: false });
  const id = createDerivedDatabase(src);
  const d = w.getDatabase(id)!;
  w.updateSchema(id, { ...d.schema, pipeline: { steps: [d.schema.pipeline!.steps[0], { ...d.schema.pipeline!.steps[1], prompt: "Nur Wichtiges." }] } });
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ rows: Array.from({ length: 30 }, (_, i) => ({ n: i + 1, keep: false, why: "nein" })) });
  await runPipeline(id, { ai: false });
  fs.rmSync(promptFile);
  await runPipeline(id, { ai: false });
  assert.ok(fs.existsSync(promptFile) === false, "judged: not again");
  await p.ensureSystemPrompts();
  const page = (await p.systemPrompts()).find((x) => x.key === "ai-filter")!;
  w.updatePage(page.pageId!, { content: markdownToDoc("Sei sehr streng. Bedingung: {{instruction}}") });
  await runPipeline(id, { ai: false });
  assert.match(fs.readFileSync(promptFile, "utf8"), /Sei sehr streng/, "the frame changed: judged again, by it");
});

test("folders from filters: a database's derived databases (count, unread) — and a derived one knows where it comes from", async () => {
  const w = await import("@/plugins/workspace/store");
  const { createSourceDatabase, createDerivedDatabase, derivedOf, derivedFrom } = await import("@/plugins/workspace/derived");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const mail = createSourceDatabase("mail");
  await runPipeline(mail, { ai: false });
  const important = createDerivedDatabase(mail, "Wichtig");
  await runPipeline(important, { ai: false }); // no condition yet: all through
  const n = w.rawRows(important).length;
  assert.ok(n > 0);
  const list = derivedOf(mail);
  assert.deepEqual(list.map((x) => [x.id, x.title, x.count]), [[important, "Wichtig", n]]);
  assert.equal(list[0].unread, w.rawRows(important).filter((r) => r.cells.mailunread).length);
  assert.equal(derivedFrom(w.getDatabase(important)!.schema), mail);
  assert.equal(derivedFrom(w.getDatabase(mail)!.schema), null);
});

test("refresh: a pipeline with an AI filter goes to the background whole; the filter's verdicts can be dropped (judged all again)", async () => {
  const w = await import("@/plugins/workspace/store");
  const { createSourceDatabase, createDerivedDatabase } = await import("@/plugins/workspace/derived");
  const { runPipeline, needsBackground, forgetVerdicts } = await import("@/plugins/workspace/pipeline");
  const mail = createSourceDatabase("mail");
  await runPipeline(mail, { ai: false });
  assert.equal(needsBackground(w.getDatabase(mail)!.schema), false, "rows only: right away");
  const id = createDerivedDatabase(mail, "Streng");
  const d = w.getDatabase(id)!;
  const step = { ...d.schema.pipeline!.steps[1], prompt: "Nur Chef." };
  w.updateSchema(id, { ...d.schema, pipeline: { steps: [d.schema.pipeline!.steps[0], step] } });
  assert.equal(needsBackground(w.getDatabase(id)!.schema), true, "an AI filter: in the background");
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ rows: Array.from({ length: 30 }, (_, i) => ({ n: i + 1, keep: i === 0, why: "x" })) });
  await runPipeline(id, { ai: false });
  fs.rmSync(promptFile);
  await runPipeline(id, { ai: false });
  assert.ok(!fs.existsSync(promptFile), "judged: not again");
  forgetVerdicts(step.id);
  await runPipeline(id, { ai: false });
  assert.ok(fs.existsSync(promptFile), "forgotten: all judged again");
});

test("run log: each run of a pipeline kept — what it did, how many the AI judged and kept, its calls and cost, how long, what failed", async () => {
  const w = await import("@/plugins/workspace/store");
  const { createSourceDatabase, createDerivedDatabase } = await import("@/plugins/workspace/derived");
  const { runPipeline, pipelineRuns, allPipelineRuns } = await import("@/plugins/workspace/pipeline");
  const { addManualTodo } = await import("@/lib/boards/store");
  addManualTodo({ ticket: "WS-31", text: "Laufprotokoll prüfen" });
  addManualTodo({ ticket: "WS-32", text: "Etwas ganz anderes erledigen" });
  const src = createSourceDatabase("todos");
  await runPipeline(src, { ai: false });
  const id = createDerivedDatabase(src, "Protokolliert");
  const d = w.getDatabase(id)!;
  w.updateSchema(id, { ...d.schema, pipeline: { ...d.schema.pipeline!, steps: [d.schema.pipeline!.steps[0], { ...d.schema.pipeline!.steps[1], prompt: "Nur Laufprotokoll." }] } });
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ rows: Array.from({ length: 30 }, (_, i) => ({ n: i + 1, keep: i === 0, why: i === 0 ? "ja" : "nein" })) });
  await runPipeline(id, { ai: false });
  const runs = pipelineRuns(id);
  assert.equal(runs.length, 1);
  const r = runs[0];
  assert.equal(r.ok, true);
  assert.ok(r.judged >= 2, `judged ${r.judged}`);
  assert.equal(r.kept, 1);
  assert.ok(r.judged <= 10, "only the rows of the batch, not the AI's extra verdicts");
  assert.equal(r.aiCalls, 1);
  assert.ok(r.costUsd > 0, "the call's cost");
  assert.ok(r.ms >= 0 && r.at);
  assert.equal(r.created, 1);
  await runPipeline(id, { ai: false });
  assert.equal(pipelineRuns(id)[0].aiCalls, 0, "the second run: nothing judged again");
  assert.equal(pipelineRuns(id).length, 2, "newest first");
  assert.ok(allPipelineRuns(7).some((x) => x.dbId === id), "the overview of all");
});
