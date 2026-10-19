import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

/**
 * The jobs database as a receiving board: tickets sent to it land in "Eingang"; a card you move to "Ready" is taken by an agent
 * by itself — when you switched that on, at most `parallel` at a time and `perDay` a day. A job that came from a ticket tells
 * the worker the ticket (its key, its fields, its text); one without an instruction of its own gets the board's default.
 * The worker system is injected: no CLI, no cost.
 */
setupTempData();

type Run = { status: string; todoId: number; summary: string | null; error: string | null; result: string | null };
let nextRun = 500;
let nextTodo = 900;
function fakeDeps() {
  const runs = new Map<number, Run>();
  const calls = { instructions: [] as string[], tickets: [] as string[] };
  const deps = {
    addTodo: (v: { ticket: string; text: string }) => (calls.tickets.push(v.ticket), { id: nextTodo++ }),
    dispatch: (todoId: number, v: { instruction: string }) => {
      calls.instructions.push(v.instruction);
      const id = nextRun++;
      runs.set(id, { status: "running", todoId, summary: null, error: null, result: null });
      return { id };
    },
    run: (id: number) => runs.get(id),
    closeTodo: () => undefined,
  };
  return { deps, runs, calls };
}

test("a new jobs database receives tickets in Eingang and has a Ready column", async () => {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { createJobsDatabase, JOB } = await import("@/plugins/workspace/jobs");
  const { sendRow } = await import("@/plugins/workspace/links");
  const jobs = createJobsDatabase(null, "Auto 1");
  const d = w.getDatabase(jobs)!;
  const names = d.schema.properties.find((p) => p.id === JOB.status)!.options!.map((o) => o.name);
  assert.deepEqual(names, ["Eingang", "Ready", "In Arbeit", "Rückfrage", "Zur Prüfung", "Fertig", "Fehlgeschlagen"]);
  const inbox = d.schema.properties.find((p) => p.id === JOB.status)!.options![0].id;
  assert.deepEqual(d.schema.receive, { prop: JOB.status, value: inbox });

  const src = w.createPage({ kind: "database", title: "Lage", schema: { titleName: "Ticket", properties: [], views: [m.newView("Table")] } });
  const t = w.addRow(src, { title: "PROJ-1 Fix" });
  const { row } = sendRow(t, jobs);
  assert.equal(w.getPage(row)!.props[JOB.status], inbox, "sent tickets land in Eingang");
});

test("an older jobs database gets Eingang (its Offen renamed), Ready and the receiving setting", async () => {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { ensureJobStates, JOB } = await import("@/plugins/workspace/jobs");
  const old = w.createPage({
    kind: "database",
    title: "Alt",
    schema: {
      titleName: "Auftrag",
      properties: [{ id: JOB.status, name: "Status", type: "status", options: [{ id: "o_open", name: "Offen", color: "gray", group: "todo" }, { id: "o_work", name: "In Arbeit", color: "blue", group: "doing" }] }],
      views: [m.newView("Board")],
      jobs: true,
    },
  });
  const row = w.addRow(old, { title: "A", cells: { [JOB.status]: "o_open" } });
  ensureJobStates(old);
  const d = w.getDatabase(old)!;
  const opts = d.schema.properties.find((p) => p.id === JOB.status)!.options!;
  assert.deepEqual(opts.map((o) => o.name), ["Eingang", "Ready", "In Arbeit", "Rückfrage"], "Offen is Eingang now (same id: its cards stay), Ready after it");
  assert.equal(opts[0].id, "o_open");
  assert.equal(w.getPage(row)!.props[JOB.status], "o_open");
  assert.deepEqual(d.schema.receive, { prop: JOB.status, value: "o_open" });
  ensureJobStates(old);
  assert.equal(w.getDatabase(old)!.schema.properties.find((p) => p.id === JOB.status)!.options!.length, 3, "once");
});

test("the agents setting is kept to sane limits", async () => {
  const m = await import("@/plugins/workspace/model");
  const s = (agents: unknown) => m.normalizeSchema({ titleName: "N", properties: [], views: [], agents }).agents;
  assert.deepEqual(s({ auto: true, parallel: 3, perDay: 12, defaultInstruction: " Arbeite das Ticket ab. " }), { auto: true, parallel: 3, perDay: 12, defaultInstruction: "Arbeite das Ticket ab." });
  assert.deepEqual(s({ auto: true, parallel: 99, perDay: 99999 }), { auto: true, parallel: 8, perDay: 200 }, "capped");
  assert.deepEqual(s({ auto: true }), { auto: true, parallel: 1, perDay: 20 }, "one worker, twenty a day when nothing is said");
  assert.equal(s({ auto: false, parallel: 2 })?.auto, undefined, "off is the default: not kept as true");
  assert.equal(s("nonsense"), undefined);
});

test("auto: Ready cards are taken up to the workers' number and the day's limit — never when it's off", async () => {
  const w = await import("@/plugins/workspace/store");
  const { createJobsDatabase, addJob, pumpJobs, settleJobs, setState, stateOf } = await import("@/plugins/workspace/jobs");
  const jobs = createJobsDatabase(null, "Auto 2");
  const ids = [1, 2, 3, 4].map((n) => addJob(jobs, { title: `J${n}`, instruction: `tu ${n}` }));
  for (const id of ids) setState(id, "Ready");
  const { deps, runs } = fakeDeps();

  assert.equal((await pumpJobs(jobs, deps)).started, 0, "off: nothing starts by itself");
  const cur = w.getDatabase(jobs)!.schema;
  w.updateSchema(jobs, { ...cur, agents: { auto: true, parallel: 2, perDay: 3 } });

  assert.equal((await pumpJobs(jobs, deps)).started, 2, "two workers: two jobs");
  assert.deepEqual(ids.map((i) => stateOf(i)), ["In Arbeit", "In Arbeit", "Ready", "Ready"], "in the board's order, the others wait");
  assert.equal((await pumpJobs(jobs, deps)).started, 0, "both workers busy");

  // One run ends: its slot is free, the next one goes — the third of the day.
  const firstRun = [...runs.keys()][0];
  runs.get(firstRun)!.status = "done";
  runs.get(firstRun)!.summary = "ok";
  assert.equal(await settleJobs(deps), 1);
  assert.equal((await pumpJobs(jobs, deps)).started, 1);
  assert.equal(stateOf(ids[2]), "In Arbeit");

  // The day's limit (3) is used up: the fourth waits for tomorrow, though a worker is free.
  const secondRun = [...runs.keys()][1];
  runs.get(secondRun)!.status = "done";
  await settleJobs(deps);
  const r = await pumpJobs(jobs, deps);
  assert.deepEqual([r.started, r.limited], [0, true]);
  assert.equal(stateOf(ids[3]), "Ready");
  // By hand it still starts (a click isn't the day's automation).
  const { dispatchJob } = await import("@/plugins/workspace/jobs");
  await dispatchJob(ids[3], deps);
  assert.equal(stateOf(ids[3]), "In Arbeit");
});

test("moving a card to Ready starts it by itself when auto is on", async () => {
  const w = await import("@/plugins/workspace/store");
  const { createJobsDatabase, addJob, stateId, useJobDeps, stateOf, JOB } = await import("@/plugins/workspace/jobs");
  const jobs = createJobsDatabase(null, "Auto 3");
  const cur = w.getDatabase(jobs)!.schema;
  w.updateSchema(jobs, { ...cur, agents: { auto: true, parallel: 1, perDay: 20 } });
  const id = addJob(jobs, { title: "Los", instruction: "tu was" });
  const { deps, calls } = fakeDeps();
  useJobDeps(deps);
  try {
    w.setCell(id, JOB.status, stateId(jobs, "Ready")!); // dragged on the board
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(stateOf(id), "In Arbeit");
    assert.equal(calls.instructions.length, 1);
  } finally {
    useJobDeps(undefined);
  }
});

test("a job from a ticket tells the worker the ticket; one without words of its own gets the board's default", async () => {
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { createJobsDatabase, addJob, dispatchJob, jobInstruction } = await import("@/plugins/workspace/jobs");
  const { sendRow } = await import("@/plugins/workspace/links");
  const jobs = createJobsDatabase(null, "Auto 4");
  const cur = w.getDatabase(jobs)!.schema;
  w.updateSchema(jobs, { ...cur, agents: { auto: false, parallel: 1, perDay: 20, defaultInstruction: "Arbeite das verknüpfte Ticket ab und berichte." } });
  const lage = w.createPage({
    kind: "database",
    title: "Lage-Board",
    schema: { titleName: "Ticket", properties: [{ id: "ticketkey", name: "Key", type: "text" }, { id: "p_lead", name: "Lage", type: "text" }, { id: "p_att", name: "Attention", type: "text" }], views: [m.newView("Table")] },
  });
  const t = w.addRow(lage, { title: "Footer-Links umbauen", cells: { ticketkey: "PROJ-501", p_lead: "Wartet auf Freigabe vom Kunden", p_att: "feedback" } });
  w.updatePage(t, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Die Links sollen hängenden Einzug bekommen." }] }] } });
  const { row } = sendRow(t, jobs);
  const text = await jobInstruction(row);
  assert.match(text, /Arbeite das verknüpfte Ticket ab und berichte\./, "the board's default: the job has no words of its own");
  assert.match(text, /Verknüpftes Ticket/);
  assert.match(text, /PROJ-501/);
  assert.match(text, /Wartet auf Freigabe vom Kunden/, "the source's fields");
  assert.match(text, /hängenden Einzug/, "the source's text");
  assert.match(text, /todo_context|search_context/, "where to read more about the ticket");

  const own = addJob(jobs, { title: "Eigener", instruction: "Mach genau das." });
  assert.doesNotMatch(await jobInstruction(own), /Arbeite das verknüpfte Ticket ab/, "a job with an instruction of its own keeps it alone");

  const { deps, calls } = fakeDeps();
  await dispatchJob(row, deps);
  assert.equal(calls.tickets[0], "PROJ-501", "the worker's todo is on the ticket (it knows Jira's side)");
});
