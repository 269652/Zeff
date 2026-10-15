import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const run = { id: 45, ticket: "PROJ-306", todoId: 23, mode: "code", model: "sonnet", repo: "proj", branch: "feature/PROJ-306-typography-tokens" };
const answer = (o: Record<string, unknown> = {}) => ({
  outcome: "partial" as const,
  summary: "Typografie abgeglichen.",
  entry: "Typografie-Werte abgeglichen",
  completedTodos: [] as number[],
  followUps: [{ kind: "test" as const, text: "Schriften per Playwright prüfen", channel: "none" as const }],
  changes: ["_themes.scss: Tokens ergänzt"],
  checks: ["Stylelint: nicht gelaufen: kein node_modules"],
  ...o,
});

test("a report has its fixed shape: result, summary, changes, checks, open, where", async () => {
  const { buildReport } = await import("@/lib/work/report");
  const r = buildReport(run, answer({ completedTodos: [23] }));
  assert.equal(r.title, "Typografie-Werte abgeglichen");
  assert.match(r.body, /^# Typografie-Werte abgeglichen\n\n\*\*Ergebnis:\*\* Teilweise erledigt · W-45 \(sonnet\) · T-23 · PROJ-306/);
  for (const h of ["## Änderungen\n- _themes.scss: Tokens ergänzt", "## Geprüft\n- Stylelint: nicht gelaufen: kein node_modules", "## Offen\n- Schriften per Playwright prüfen", "## Ort\n- Branch `feature/PROJ-306-typography-tokens` (proj)\n- Als erledigt gemeldet: T-23"])
    assert.ok(r.body.includes(h), h);
  // The order is always the same.
  const at = (h: string) => r.body.indexOf(h);
  assert.ok(at("## Änderungen") < at("## Geprüft") && at("## Geprüft") < at("## Offen") && at("## Offen") < at("## Ort"));
});

test("a code run that reports no changes or checks has the gap told; a draft or a blocked run doesn't owe them", async () => {
  const { buildReport } = await import("@/lib/work/report");
  const bare = buildReport(run, answer({ changes: undefined, checks: undefined, followUps: [] }));
  assert.match(bare.body, /## Änderungen\n- Keine Änderungen gemeldet\./);
  assert.match(bare.body, /## Geprüft\n- Keine Prüfung gemeldet\./);
  assert.ok(!bare.body.includes("## Offen"));
  const draft = buildReport({ ...run, mode: "draft", branch: null }, answer({ outcome: "done", changes: undefined, checks: undefined, followUps: [] }));
  assert.ok(!draft.body.includes("## Änderungen") && !draft.body.includes("## Geprüft") && !draft.body.includes("## Ort"));
  const blocked = buildReport(run, answer({ outcome: "blocked", changes: undefined, checks: undefined }));
  assert.ok(!blocked.body.includes("Keine Änderungen gemeldet"));
});

test("a section the worker wrote into its summary stays as it wrote it — only the missing ones are added", async () => {
  const { buildReport } = await import("@/lib/work/report");
  const summary = ["Fertig.", "", "## Erledigt", "- a", "", "## Offen", "- Build lief nicht", "", "## Geprüft", "- Stylelint: nicht gelaufen"].join("\n");
  const r = buildReport(run, answer({ summary, completedTodos: [] }));
  assert.equal(r.body.match(/^## Offen$/gm)?.length, 1);
  assert.equal(r.body.match(/^## Geprüft$/gm)?.length, 1);
  assert.ok(!r.body.includes("Schriften per Playwright prüfen")); // its follow-up is in the columns, not repeated in the text
  assert.ok(r.body.includes(["## Änderungen", "- _themes.scss: Tokens ergänzt"].join("\n"))); // the summary has no such section: added
  assert.ok(r.body.includes(["## Ort", "- Branch"].join("\n"))); // likewise
  assert.deepEqual(r.openItems, ["Schriften per Playwright prüfen"]);
});

test("a title falls back to the summary's first line", async () => {
  const { buildReport } = await import("@/lib/work/report");
  assert.equal(buildReport(run, answer({ entry: "", summary: "## Ergebnis\nAlles gut." })).title, "Ergebnis");
});

test("a finished run leaves a report filed under its todo and the todos it reported done — one per run", async () => {
  const { addFollowUp, getTodo } = await import("@/lib/boards/store");
  const { applyOutcome } = await import("@/lib/work/outcome");
  const { createRun, getRun } = await import("@/lib/work/store");
  const { reportsForTodo, getReport, reportList } = await import("@/lib/work/report");

  const mk = (text: string) => addFollowUp({ ticket: "ABC-1", text, kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  const a = mk("Do the thing");
  const b = mk("Also this");
  const r = getRun(createRun({ ticket: "ABC-1", todoId: a.id, mode: "code", provider: "claude", model: "sonnet", permissionMode: null, repo: null, prompt: "x" }).id)!;
  const res = { outcome: "done" as const, summary: "x".repeat(6000) + "\n\n## Offen\n- nichts", entry: "Sache erledigt", completedTodos: [a.id, b.id], followUps: [], changes: ["a.ts: neu"], checks: ["npm test: 12 grün"] };

  applyOutcome(r, res);
  const own = reportsForTodo(a.id);
  assert.equal(own.length, 1);
  // The comment on the todo is cut short; the report is whole.
  assert.ok(getTodo(a.id)!.userNotes.at(-1)!.text.length <= 4000);
  assert.ok(own[0].body.length > 6000);
  assert.deepEqual(reportList(own[0], "checks"), ["npm test: 12 grün"]);
  assert.equal(own[0].byWho, `W-${r.id} · sonnet`);

  // Filed under the other todo it reported done as well (the same report).
  assert.deepEqual(reportsForTodo(b.id).map((x) => x.id), [own[0].id]);
  assert.deepEqual(reportsForTodo(a.id + b.id + 99), []);

  // The same run answering again replaces its report.
  applyOutcome(getRun(r.id)!, { ...res, entry: "Besser erledigt" });
  assert.equal(reportsForTodo(a.id).length, 1);
  assert.equal(getReport(own[0].id)!.title, "Besser erledigt");
});

test("the knowledge export carries the reports as pages of their own", async () => {
  const { knowledgeDocs } = await import("@/plugins/knowledge/export");
  const docs = knowledgeDocs("http://zeff.test").docs.filter((d) => d.space === "Zeff · Berichte");
  assert.equal(docs.length, 1);
  assert.match(docs[0].id, /^zeff:report:\d+$/);
  assert.match(docs[0].title, /^Bericht W-\d+ zu T-\d+ · ABC-1: Besser erledigt/);
  assert.ok(docs[0].body.includes("## Geprüft\n- npm test: 12 grün"));
  assert.match(docs[0].url, /^http:\/\/zeff\.test\/t\/\d+$/);
});

test("runs that finished before reports were kept get theirs from their stored answer — once, as old as the run", async () => {
  const { addFollowUp } = await import("@/lib/boards/store");
  const { createRun } = await import("@/lib/work/store");
  const { backfillReports, reportsForTodo } = await import("@/lib/work/report");
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const todo = addFollowUp({ ticket: "BF-1", text: "Alte Aufgabe", kind: "other", parentId: null as unknown as number, workRunId: null, source: "test" });
  const old = createRun({ ticket: "BF-1", todoId: todo.id, mode: "code", provider: "claude", model: "sonnet", permissionMode: null, repo: null, prompt: "x" });
  const answer = { outcome: "done", summary: "Früher erledigt.", entry: "Alt erledigt", completedTodos: [], followUps: [], changes: ["a.ts: neu"], checks: [] };
  getDb().update(schema.workRuns).set({ result: JSON.stringify(answer), finishedAt: "2026-10-01T08:00:00.000Z" }).where(eq(schema.workRuns.id, old.id)).run();
  // A run without an answer (never finished) and one with a broken answer get none.
  createRun({ ticket: "BF-1", todoId: todo.id, mode: "code", provider: "claude", model: "sonnet", permissionMode: null, repo: null, prompt: "y" });
  const broken = createRun({ ticket: "BF-1", todoId: todo.id, mode: "code", provider: "claude", model: "sonnet", permissionMode: null, repo: null, prompt: "z" });
  getDb().update(schema.workRuns).set({ result: "{ not json" }).where(eq(schema.workRuns.id, broken.id)).run();

  delete (globalThis as { __zeffReportsBackfilled?: unknown }).__zeffReportsBackfilled; // (an earlier test in this process has used the once-per-start guard)
  assert.ok(backfillReports() >= 1);
  const reports = reportsForTodo(todo.id);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].runId, old.id);
  assert.equal(reports[0].title, "Alt erledigt");
  assert.equal(reports[0].createdAt, "2026-10-01T08:00:00.000Z");
  // Again: nothing more (and a report kept already isn't made again).
  assert.equal(backfillReports(), 0);
});
