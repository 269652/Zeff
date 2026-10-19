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
  assert.equal(stateOf(id), "Eingang");

  const { deps, calls } = fakeDeps();
  const r = await dispatchJob(id, deps);
  assert.equal(stateOf(id), "In Arbeit");
  assert.equal(w.getPage(id)!.props[JOB.run], `W-${r.run}`);
  const text = calls.instructions[0];
  assert.match(text, /Angebot zusammenfassen/);
  assert.match(text, /fünf Sätzen/);
  assert.match(text, new RegExp(`workspace_update_row \\(row: ${id}\\)`), "where the result goes");
  // What the job asks for happens where it says (pages, rows in the Workspace); the field only reports it.
  assert.match(text, /workspace_create_page/, "the tools to make pages and rows are named");
  assert.match(text, /workspace_tree|workspace_search/, "how to find the place the job names");
  assert.match(text, /nicht nur/, "make it for real, don't describe it");
  assert.match(text, /kurzen Bericht/, "the result field holds a short report of what was made, not the content");
  assert.doesNotMatch(text, /Schreib dein Ergebnis mit dem MCP-Werkzeug/, "no rule that sends all content into the field");
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

test("starting a job again: the earlier result is material on the page, not the work done — the field starts empty", async () => {
  const w = await import("@/plugins/workspace/store");
  const { docToMarkdown } = await import("@/plugins/workspace/doc");
  const { createJobsDatabase, addJob, dispatchJob, setState, JOB } = await import("@/plugins/workspace/jobs");
  const jobs = createJobsDatabase(null, "Neustart");
  const id = addJob(jobs, { title: "Seiten in Ideen anlegen", instruction: "Schreibe ein paar Seiten in Ideen." });
  w.setCell(id, JOB.result, "# Ideenpapier\n\nAcht Abschnitte über selbstentwickelnde Software.");
  setState(id, "Fehlgeschlagen");
  const { deps, calls } = fakeDeps();
  await dispatchJob(id, deps);
  assert.equal(w.getPage(id)!.props[JOB.result], undefined, "the result field starts empty: the agent has to deliver again");
  assert.match(docToMarkdown(w.getPage(id)!.content), /Früheres Ergebnis[\s\S]*Acht Abschnitte/, "the earlier result is kept on the job's page");
  const text = calls.instructions[0];
  assert.match(text, /Acht Abschnitte über selbstentwickelnde Software/, "the worker sees it, as material");
  assert.match(text, /Material — nicht die Erledigung/, "and is told it isn't the job done");
  assert.match(text, /wirklich existiert/, "it checks that what the job asks for really exists");
});

/** A jobs database whose agents take the Ready column by themselves. */
async function autoJobs() {
  const w = await import("@/plugins/workspace/store");
  const { createJobsDatabase } = await import("@/plugins/workspace/jobs");
  const jobs = createJobsDatabase(null);
  w.updateSchema(jobs, { ...w.getDatabase(jobs)!.schema, agents: { auto: true, parallel: 3, perDay: 50 } });
  return jobs;
}

test("a job is started by one taker only: a second one at the same time backs off and does not mark it failed", async () => {
  const { addJob, dispatchJob, stateOf, JOB } = await import("@/plugins/workspace/jobs");
  const w = await import("@/plugins/workspace/store");
  const jobs = await autoJobs();
  const id = addJob(jobs, { title: "Einmal starten", instruction: "Tu es." });
  const { deps, calls } = fakeDeps();
  const results = await Promise.allSettled([dispatchJob(id, deps), dispatchJob(id, deps)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "one start");
  assert.equal(calls.instructions.length, 1, "the worker got it once");
  assert.equal(stateOf(id), "In Arbeit");
  assert.match(String(w.getPage(id)!.props[JOB.run]), /^W-\d+$/);
});

test("the agents taking Ready: a job another process took meanwhile stays 'In Arbeit'; a real failure says why in the result", async () => {
  const { addJob, pumpJobs, setState, stateOf, JOB } = await import("@/plugins/workspace/jobs");
  const w = await import("@/plugins/workspace/store");
  const jobs = await autoJobs();
  const taken = addJob(jobs, { title: "Schon genommen", instruction: "a" });
  const broken = addJob(jobs, { title: "Kaputt", instruction: "b" });
  setState(taken, "Ready");
  setState(broken, "Ready");
  const { deps } = fakeDeps();
  const failing = {
    ...deps,
    dispatch: (todoId: number, v: { instruction: string }) => {
      if (stateOf(taken) === "Ready") {
        // (another process dispatched it and flipped the state, then ours trips over the todo)
        setState(taken, "In Arbeit");
        w.setCell(taken, JOB.run, "W-1");
        throw new Error("T-9 is with W-1 already.");
      }
      throw new Error("The CLI is not installed.");
    },
  };
  await pumpJobs(jobs, failing);
  assert.equal(stateOf(taken), "In Arbeit", "not marked failed over the other taker's start");
  assert.equal(stateOf(broken), "Fehlgeschlagen");
  assert.match(String(w.getPage(broken)!.props[JOB.result]), /The CLI is not installed/, "the reason is in the row");
});

test("settling: a failed job whose worker is in fact still running goes back to 'In Arbeit'", async () => {
  const { addJob, settleJobs, setState, stateOf, JOB } = await import("@/plugins/workspace/jobs");
  const w = await import("@/plugins/workspace/store");
  const jobs = await autoJobs();
  const id = addJob(jobs, { title: "Zu Unrecht gescheitert", instruction: "c" });
  const { deps, runs } = fakeDeps();
  runs.set(4242, { status: "running", todoId: 5, summary: null, error: null, result: null });
  w.setCell(id, JOB.run, "W-4242");
  setState(id, "Fehlgeschlagen");
  await settleJobs(deps);
  assert.equal(stateOf(id), "In Arbeit");
});

// ---- Rückfragen, the feature branch, the delivery proposed under the job ----

test("a jobs database has the Rückfrage state and the question/delivery fields — an older one is brought up to date", async () => {
  const w = await import("@/plugins/workspace/store");
  const { createJobsDatabase, ensureJobStates, stateId, JOB } = await import("@/plugins/workspace/jobs");
  const fresh = createJobsDatabase(null);
  assert.ok(stateId(fresh, "Rückfrage"));
  const props = (id: number) => w.getDatabase(id)!.schema.properties.map((p) => p.id);
  assert.ok(props(fresh).includes(JOB.question) && props(fresh).includes(JOB.delivery));
  // An older one: without them.
  const old = createJobsDatabase(null);
  const s = w.getDatabase(old)!.schema;
  w.updateSchema(old, { ...s, properties: s.properties.filter((p) => p.id !== JOB.question && p.id !== JOB.delivery).map((p) => (p.id === JOB.status ? { ...p, options: p.options!.filter((o) => o.name !== "Rückfrage") } : p)) });
  assert.equal(stateId(old, "Rückfrage"), undefined);
  ensureJobStates(old);
  assert.ok(stateId(old, "Rückfrage"));
  assert.ok(props(old).includes(JOB.question) && props(old).includes(JOB.delivery));
});

test("a worker that asks (todo_needs_input) puts the job in 'Rückfrage' with its question; the answer goes to the running worker", async () => {
  const w = await import("@/plugins/workspace/store");
  const { addJob, dispatchJob, settleJobs, answerJob, stateOf, JOB } = await import("@/plugins/workspace/jobs");
  const jobs = await autoJobs();
  const id = addJob(jobs, { title: "Mit Rückfrage", instruction: "Mach X." });
  const { deps, runs } = fakeDeps();
  const sent: { run: number; text: string }[] = [];
  let question: string | null = null;
  const d = { ...deps, asking: () => question, message: async (run: number, text: string) => void sent.push({ run, text }) };
  const { run, todo } = await dispatchJob(id, d);
  void todo;
  await settleJobs(d);
  assert.equal(stateOf(id), "In Arbeit", "nothing asked yet");
  question = "Soll das auch für PNG gelten?";
  await settleJobs(d);
  assert.equal(stateOf(id), "Rückfrage");
  assert.equal(w.getPage(id)!.props[JOB.question], "Soll das auch für PNG gelten?");
  await answerJob(id, "Nein, nur SVG.", d);
  assert.deepEqual(sent, [{ run, text: "Nein, nur SVG." }]);
  assert.equal(stateOf(id), "In Arbeit");
  assert.equal(w.getPage(id)!.props[JOB.question], undefined, "the question is answered");
  question = null;
  runs.get(run)!.status = "done";
  await settleJobs(d);
  assert.equal(stateOf(id), "Zur Prüfung");
});

test("a question whose worker is gone is answered by a new run that knows the question and the answer", async () => {
  const w = await import("@/plugins/workspace/store");
  const { addJob, dispatchJob, settleJobs, answerJob, stateOf, JOB } = await import("@/plugins/workspace/jobs");
  const jobs = await autoJobs();
  const id = addJob(jobs, { title: "Worker weg", instruction: "Mach Y." });
  const { deps, runs, calls } = fakeDeps();
  let question: string | null = "Welchen Branch?";
  const d = { ...deps, asking: () => question };
  const first = await dispatchJob(id, d);
  await settleJobs(d);
  assert.equal(stateOf(id), "Rückfrage");
  runs.get(first.run)!.status = "stopped"; // (the worker ended while waiting: no session to answer into)
  question = null;
  const before = calls.instructions.length;
  await answerJob(id, "Den von main.", d);
  assert.equal(calls.instructions.length, before + 1, "started again");
  const again = calls.instructions.at(-1)!;
  assert.match(again, /Welchen Branch\?/);
  assert.match(again, /Den von main\./);
  assert.equal(stateOf(id), "In Arbeit");
  assert.notEqual(w.getPage(id)!.props[JOB.run], `W-${first.run}`, "a new worker is on it");
});

test("a finished job with commits gets the delivery proposed: its todo (push, merge request) is named in the row", async () => {
  const w = await import("@/plugins/workspace/store");
  const { addJob, dispatchJob, settleJobs, stateOf, JOB } = await import("@/plugins/workspace/jobs");
  const jobs = await autoJobs();
  const withCode = addJob(jobs, { title: "Mit Code", instruction: "Baue es." });
  const noCode = addJob(jobs, { title: "Ohne Code", instruction: "Fasse zusammen." });
  const { deps, runs } = fakeDeps();
  const proposed: number[] = [];
  const d = { ...deps, propose: (run: number) => (proposed.push(run), runs.get(run)?.summary === "code" ? { todoId: 777, text: "Deliver feature/X-1-y" } : null) };
  const a = await dispatchJob(withCode, d);
  const b = await dispatchJob(noCode, d);
  runs.get(a.run)!.status = "done";
  runs.get(a.run)!.summary = "code";
  runs.get(b.run)!.status = "done";
  await settleJobs(d);
  assert.equal(stateOf(withCode), "Zur Prüfung");
  assert.equal(w.getPage(withCode)!.props[JOB.delivery], "T-777");
  assert.equal(w.getPage(noCode)!.props[JOB.delivery], undefined);
  assert.deepEqual(proposed.sort(), [a.run, b.run].sort());
});

test("what a worker is told: the feature branch's name, to commit but not push, and to ask through todo_needs_input", async () => {
  const { addJob, jobInstruction } = await import("@/plugins/workspace/jobs");
  const jobs = await autoJobs();
  const id = addJob(jobs, { title: "Anweisungen", instruction: "Tu etwas." });
  const text = await jobInstruction(id);
  assert.match(text, /feature\/<TICKET>-/);
  assert.match(text, /todo_needs_input/);
  assert.match(text, /nicht pushen|nicht push/i);
});

test("what a job's card shows: the question it waits on, and the delivery proposed under it with its actions", async () => {
  const w = await import("@/plugins/workspace/store");
  const { addJob, setState, jobPanels, JOB } = await import("@/plugins/workspace/jobs");
  const { addFollowUp } = await import("@/lib/boards/store");
  const jobs = await autoJobs();
  const asking = addJob(jobs, { title: "Fragt", instruction: "a" });
  const done = addJob(jobs, { title: "Fertig mit Code", instruction: "b" });
  const quiet = addJob(jobs, { title: "Still", instruction: "c" });
  w.setCell(asking, JOB.question, "Welche Variante?");
  setState(asking, "Rückfrage");
  const t = addFollowUp({ ticket: "DEL-1", text: "Deliver feature/DEL-1-x: push, merge request into main", kind: "merge", parentId: null, workRunId: null, source: "test", ops: [{ type: "git-push", repo: "C:\r", branch: "feature/DEL-1-x", remote: "feature/DEL-1-x", target: "main", title: "t", description: "d" }], owner: "me" });
  w.setCell(done, JOB.delivery, `T-${t.id}`);
  const panels = await jobPanels(w.rawRows(jobs));
  assert.equal(panels[asking].question, "Welche Variante?");
  assert.equal(panels[done].delivery?.todoId, t.id);
  assert.equal(panels[done].delivery?.status, "open");
  assert.deepEqual(panels[done].delivery!.ops.map((o) => o.type), ["git-push"]);
  assert.equal(panels[quiet], undefined, "a quiet job has no panel");
  // The question only shows while it is asked.
  setState(asking, "In Arbeit");
  assert.equal((await jobPanels(w.rawRows(jobs)))[asking], undefined);
});

test("links on a job's card: the branch (a link once it is pushed) and the merge request", async () => {
  const { jobLinks } = await import("@/plugins/workspace/jobs");
  const base = { baseUrl: "https://git.example.com/", project: "grp/proj", local: "feature/PROJ-1-x", remote: "feature/PROJ-1-x-neu" };
  // Not pushed yet: the branch by name, no link; no merge request.
  assert.deepEqual(jobLinks({ ...base, pushed: false, mrs: [] }), { branch: { name: "feature/PROJ-1-x", url: null }, mr: null });
  // Pushed: the branch at GitLab (under the name it was pushed as).
  assert.deepEqual(jobLinks({ ...base, pushed: true, mrs: [] }), { branch: { name: "feature/PROJ-1-x-neu", url: "https://git.example.com/grp/proj/-/tree/feature/PROJ-1-x-neu" }, mr: null });
  // A merge request of that branch (the open one first): its link, state and number.
  const mrs = [
    { ref: "!4", url: "https://git.example.com/grp/proj/-/merge_requests/4", state: "closed", branch: "feature/PROJ-1-x-neu" },
    { ref: "!5", url: "https://git.example.com/grp/proj/-/merge_requests/5", state: "opened", branch: "feature/PROJ-1-x-neu" },
    { ref: "!6", url: "https://git.example.com/grp/proj/-/merge_requests/6", state: "opened", branch: "other" },
  ];
  const l = jobLinks({ ...base, pushed: false, mrs });
  assert.deepEqual(l.mr, { label: "!5", url: "https://git.example.com/grp/proj/-/merge_requests/5", state: "opened" });
  assert.equal(l.branch?.url, "https://git.example.com/grp/proj/-/tree/feature/PROJ-1-x-neu", "a merge request means it is pushed");
  // Nothing known: nothing shown.
  assert.deepEqual(jobLinks({ baseUrl: "", project: "", local: "", remote: "", pushed: false, mrs: [] }), { branch: null, mr: null });
});


test("the card follows the branch: when the named delivery is closed, the open todo that now carries its actions is shown (the merge request after the push)", async () => {
  const w = await import("@/plugins/workspace/store");
  const { addJob, setState, jobPanels, JOB } = await import("@/plugins/workspace/jobs");
  const store = await import("@/lib/boards/store");
  const { createRun } = await import("@/lib/work/store");
  const jobs = await autoJobs();
  const id = addJob(jobs, { title: "Folgt dem Branch", instruction: "x" });
  const run = createRun({ ticket: "FOL-1", todoId: 1, mode: "instruct", provider: "claude", model: "sonnet", permissionMode: "auto", repo: "C:\r", prompt: "p", branch: "feature/FOL-1-x" });
  w.setCell(id, JOB.run, `W-${run.id}`);
  setState(id, "Zur Prüfung");
  const push = { type: "git-push" as const, repo: "C:\r", branch: "feature/FOL-1-x", remote: "feature/FOL-1-x", target: "main", title: "t", description: "d" };
  const first = store.deliveryTodo({ ticket: "FOL-1", text: "Deliver", runId: run.id, branch: "feature/FOL-1-x", ops: [push] });
  w.setCell(id, JOB.delivery, `T-${first.todo.id}`);
  assert.equal((await jobPanels(w.rawRows(jobs)))[id].delivery?.todoId, first.todo.id, "the named delivery while it is open");
  // Its push is done (the todo is closed) and the merge request lives on another todo of the ticket.
  store.setTodoStatus(first.todo.id, "dismissed", "pushed");
  const mr = store.addManualTodo({ ticket: "FOL-1", text: "Merge request für feature/FOL-1-x öffnen" });
  store.setTodoOps(mr.id, [{ type: "gitlab-open-mr", repo: "C:\r", project: "grp/p", source: "feature/FOL-1-x", target: "main", title: "t", description: "d" }]);
  const panel = (await jobPanels(w.rawRows(jobs)))[id];
  assert.equal(panel.delivery?.todoId, mr.id, "the one that carries the branch's actions now");
  assert.deepEqual(panel.delivery?.ops.map((o) => o.type), ["gitlab-open-mr"]);
  assert.equal(panel.delivery?.status, "open");
});

test("a job that had a worker goes on in its session: same todo, same branch and folder — no new branch, no new todo", async () => {
  const w = await import("@/plugins/workspace/store");
  const { addJob, dispatchJob, settleJobs, setState, stateOf, JOB } = await import("@/plugins/workspace/jobs");
  const jobs = await autoJobs();
  const id = addJob(jobs, { title: "Zweite Runde", instruction: "Baue es." });
  const { deps, runs, calls } = fakeDeps();
  const continued: { todo: number; run: number | undefined }[] = [];
  let canContinue = true;
  const d = {
    ...deps,
    dispatch: (todoId: number, v: { instruction: string; continueRun?: number }) => {
      continued.push({ todo: todoId, run: v.continueRun });
      return deps.dispatch(todoId, v);
    },
    previous: (runId: number) => (runs.has(runId) ? { todoId: runs.get(runId)!.todoId, canContinue } : undefined),
  };
  const first = await dispatchJob(id, d);
  runs.get(first.run)!.status = "done";
  await settleJobs(d);
  assert.equal(stateOf(id), "Zur Prüfung");
  // The user moves it back to Ready: the next round goes on in that session.
  setState(id, "Ready");
  const second = await dispatchJob(id, d);
  assert.equal(second.todo, first.todo, "the same todo");
  assert.deepEqual(continued.at(-1), { todo: first.todo, run: first.run }, "continuing the first worker's session");
  assert.equal(calls.todos.length, 1, "no second todo was made");
  assert.match(calls.instructions.at(-1)!, /Ergebnis/, "told to write the result anew for the current state");
  assert.match(String(w.getPage(id)!.props[JOB.run]), new RegExp(`W-${second.run}`));
  // No session to go on in (the folder is gone): a fresh start like the first.
  runs.get(second.run)!.status = "done";
  await settleJobs(d);
  canContinue = false;
  setState(id, "Ready");
  const third = await dispatchJob(id, d);
  assert.notEqual(third.todo, first.todo);
  assert.equal(continued.at(-1)!.run, undefined);
});

test("links: the ticket's open merge request is shown when the worker's own branch has none", async () => {
  const { jobLinks } = await import("@/plugins/workspace/jobs");
  const l = jobLinks({ baseUrl: "https://git.example.com", project: "grp/proj", local: "feature/PROJ-9-responsive-fuer-3", remote: "", pushed: false, ticket: "PROJ-9", mrs: [{ ref: "!185", url: "https://git.example.com/grp/proj/-/merge_requests/185", state: "opened", branch: "feature/PROJ-9-svg-direct-output" }] });
  assert.equal(l.mr?.label, "!185");
  assert.deepEqual(l.branch, { name: "feature/PROJ-9-svg-direct-output", url: "https://git.example.com/grp/proj/-/tree/feature/PROJ-9-svg-direct-output" });
});
