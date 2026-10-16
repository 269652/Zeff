import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

/**
 * Jobs for agents: rows of a jobs database. Starting one (a click) hands it to a worker with what the job says and the hints
 * of the rules; the job goes "In Arbeit". When the worker's run has ended the job moves to "Zur Prüfung" (or "Fehlgeschlagen")
 * and the result is in the row. Nothing starts by itself. The worker system is injected here: no CLI, no cost.
 */
setupTempData();

type Run = { status: string; todoId: number; summary: string | null; error: string | null; result: string | null };
// (Run and todo numbers run on across the tests: a job of an earlier test must not find a later test's run.)
let nextRun = 7;
let nextTodo = 101;
function fakeDeps() {
  const runs = new Map<number, Run>();
  const calls = { todos: [] as string[], instructions: [] as string[], closed: [] as number[] };
  const deps = {
    addTodo: (v: { ticket: string; text: string }) => (calls.todos.push(v.text), { id: nextTodo++ }),
    dispatch: (todoId: number, v: { instruction: string }) => {
      calls.instructions.push(v.instruction);
      const id = nextRun++;
      runs.set(id, { status: "running", todoId, summary: null, error: null, result: null });
      return { id };
    },
    run: (id: number) => runs.get(id),
    closeTodo: (id: number) => void calls.closed.push(id),
  };
  return { deps, runs, calls };
}

test("a job is started by a click: instruction with the rules' hints, state 'In Arbeit', the worker on it", async () => {
  const w = await import("@/plugins/workspace/store");
  const { createJobsDatabase, addJob, dispatchJob, stateOf, JOB } = await import("@/plugins/workspace/jobs");
  const { createRulesDatabase, addRule } = await import("@/plugins/workspace/rules");
  const rules = createRulesDatabase(null);
  addRule(rules, { title: "Immer Deutsch", then: "Hinweis für Agenten", target: "Schreib auf Deutsch, nüchtern.", why: "Hausstil" });
  addRule(rules, { title: "Nur für Mails", field: "Betreff", op: "enthält", value: "Rechnung", then: "Hinweis für Agenten", target: "Rechnungen nie bezahlen." });
  addRule(rules, { title: "Pausiert", then: "Hinweis für Agenten", target: "Das nicht.", paused: true });
  const jobs = createJobsDatabase(null);
  const id = addJob(jobs, { title: "Angebot zusammenfassen", instruction: "Fasse das Angebot in fünf Sätzen zusammen.", by: "Regel „Angebote“" });
  assert.equal(stateOf(id), "Offen");

  const { deps, calls } = fakeDeps();
  const r = await dispatchJob(id, deps);
  assert.equal(stateOf(id), "In Arbeit");
  assert.equal(w.getPage(id)!.props[JOB.run], `W-${r.run}`);
  const text = calls.instructions[0];
  assert.match(text, /Angebot zusammenfassen/);
  assert.match(text, /fünf Sätzen/);
  assert.match(text, new RegExp(`workspace_update_row \\(row: ${id}\\)`), "where the result goes");
  assert.match(text, /Schreib auf Deutsch, nüchtern\. \(Hausstil\)/, "a hint that holds for every job");
  assert.doesNotMatch(text, /Rechnungen nie bezahlen/, "a hint whose condition doesn't hold for this job");
  assert.doesNotMatch(text, /Das nicht/, "a paused rule's hint");

  await assert.rejects(() => dispatchJob(id, deps), /In Arbeit/, "a job at work isn't started again");
  assert.equal(calls.instructions.length, 1);
});

test("settling: a finished run moves the job to review with its summary, a failed one to failed with the reason", async () => {
  const w = await import("@/plugins/workspace/store");
  const { createJobsDatabase, addJob, dispatchJob, settleJobs, stateOf, setState, JOB } = await import("@/plugins/workspace/jobs");
  const jobs = createJobsDatabase(null, "Settle");
  const a = addJob(jobs, { title: "A", instruction: "a" });
  const b = addJob(jobs, { title: "B", instruction: "b" });
  const c = addJob(jobs, { title: "C", instruction: "c" });
  const { deps, runs, calls } = fakeDeps();
  const [ja, jb, jc] = [await dispatchJob(a, deps), await dispatchJob(b, deps), await dispatchJob(c, deps)];
  const [ra, rb, rc] = [ja.run, jb.run, jc.run];

  assert.equal(await settleJobs(deps), 0, "all three still running: nothing settles");

  runs.get(ra)!.status = "done";
  runs.get(ra)!.result = JSON.stringify({ summary: "Fünf Sätze.", draft: "Entwurf an Frau X" });
  runs.get(rb)!.status = "failed";
  runs.get(rb)!.error = "The run ended without a result.";
  runs.get(rc)!.status = "done";
  runs.get(rc)!.summary = "Fertig und eingetragen.";
  w.setCell(c, JOB.result, "Von dem Agenten selbst geschrieben.");
  setState(c, "Zur Prüfung"); // it moved its own job already: left as it is

  assert.equal(await settleJobs(deps), 2, "A and B settle; C was already moved by the agent");
  assert.equal(stateOf(a), "Zur Prüfung");
  assert.equal(String(w.getPage(a)!.props[JOB.result]), "Fünf Sätze.\n\nEntwurf an Frau X");
  assert.equal(stateOf(b), "Fehlgeschlagen");
  assert.match(String(w.getPage(b)!.props[JOB.result]), /without a result/);
  assert.equal(String(w.getPage(c)!.props[JOB.result]), "Von dem Agenten selbst geschrieben.", "what the agent wrote isn't overwritten");
  assert.deepEqual(calls.closed.sort(), [ja.todo, jb.todo].sort(), "the helper todos of the settled jobs are put away");

  assert.equal(await settleJobs(deps), 0, "settled once");
  // A failed job can be started again.
  await dispatchJob(b, deps);
  assert.equal(stateOf(b), "In Arbeit");
});

test("start all: only the open jobs, each once", async () => {
  const { createJobsDatabase, addJob, dispatchOpenJobs, stateOf, setState } = await import("@/plugins/workspace/jobs");
  const jobs = createJobsDatabase(null, "Alle");
  const x = addJob(jobs, { title: "X", instruction: "x" });
  const y = addJob(jobs, { title: "Y", instruction: "y" });
  addJob(jobs, { title: "Z", instruction: "z" });
  setState(y, "Fertig");
  const { deps, calls } = fakeDeps();
  const r = await dispatchOpenJobs(jobs, deps);
  assert.deepEqual([r.started, r.failed.length], [2, 0]);
  assert.equal(calls.instructions.length, 2);
  assert.equal(stateOf(x), "In Arbeit");
  assert.equal(stateOf(y), "Fertig", "a done job stays done");
  assert.deepEqual((await dispatchOpenJobs(jobs, deps)).started, 0);
});

test("with the real worker system: a queued run with the job's text, a todo for it — and the run's end settles the job", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli", "work", "todos", "workspace"]) setInstalled(id, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  const { createRun, updateRun, getRun, getWorkSettings } = await import("@/lib/work/store");
  const { getTodo } = await import("@/lib/boards/store");
  const w = await import("@/plugins/workspace/store");
  const { createJobsDatabase, addJob, dispatchJob, settleJobs, stateOf, JOB } = await import("@/plugins/workspace/jobs");
  // The workers are all busy: the queue starts nothing (no process, no cost).
  const base = { ticket: "BUSY-1", todoId: 9100, mode: "instruct", provider: "claude", model: null, permissionMode: null, repo: null, prompt: "busy" };
  for (let i = 0; i < getWorkSettings().parallel; i++) updateRun(createRun(base).id, { status: "running" });

  const jobs = createJobsDatabase(null, "Echt");
  const id = addJob(jobs, { title: "Rechnung prüfen", instruction: "Prüfe die Rechnung auf Rechenfehler." });
  const r = await dispatchJob(id);
  const run = getRun(r.run)!;
  assert.equal(run.status, "queued");
  assert.match(run.prompt, /Rechnung prüfen/);
  assert.match(run.prompt, /Rechenfehler/);
  assert.ok(run.prompt.includes(`workspace_update_row (row: ${id})`));
  assert.equal(getTodo(r.todo)!.text, "Rechnung prüfen");
  assert.equal(stateOf(id), "In Arbeit");
  assert.equal(await settleJobs(), 0, "still queued: nothing to take in");

  updateRun(run.id, { status: "done", summary: "Ein Rechenfehler auf Seite 2." });
  assert.equal(await settleJobs(), 1);
  assert.equal(stateOf(id), "Zur Prüfung");
  assert.equal(String(w.getPage(id)!.props[JOB.result]), "Ein Rechenfehler auf Seite 2.");
  assert.equal(getTodo(r.todo)!.status, "dismissed", "the helper todo is put away");
});
