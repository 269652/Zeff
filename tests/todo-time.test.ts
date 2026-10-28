import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** Zeff's MCP tools, as registered — called directly. */
async function tools(): Promise<Record<string, Handler>> {
  const { registerZeffTools } = await import("@/mcp/server");
  const out: Record<string, Handler> = {};
  registerZeffTools({ registerTool: (name: string, _cfg: unknown, fn: Handler) => void (out[name] = fn) } as never);
  return out;
}
const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join("\n");

/** A ticket with a job, and todos on it. */
async function setup(ticket: string) {
  const { createJob } = await import("@/lib/jobs");
  const { getDb, schema } = await import("@/db");
  const { setTicketJob } = await import("@/lib/jira/store");
  const number = String(100000 + Math.floor(Math.random() * 800000));
  createJob({ number, name: `Job ${ticket}` });
  getDb().insert(schema.jiraTickets).values({ key: ticket, summary: `Ticket ${ticket}`, status: "Open", statusCategory: "indeterminate", syncedAt: new Date().toISOString() } as never).run();
  setTicketJob(ticket, number);
  return number;
}
async function todo(ticket: string, textOf: string, extra: { parentId?: number } = {}) {
  const { addFollowUp } = await import("@/lib/boards/store");
  return addFollowUp({ ticket, text: textOf, kind: "other", parentId: (extra.parentId ?? null) as unknown as number, workRunId: null, source: "test" });
}
async function finishToday(...ids: number[]) {
  const { setTodoStatus } = await import("@/lib/boards/store");
  for (const id of ids) setTodoStatus(id, "done");
}

test("a todo has many time records that add up; unbooked ones can be changed and deleted", async () => {
  const { addTodoTime, listTodoTimes, timeTotals, deleteTodoTime, updateTodoTime, markTimeBooked } = await import("@/lib/work/todo-time");
  const t = await todo("TT-1", "Many records");
  const a = addTodoTime({ todoId: t.id, minutes: 20, note: "research", by: "Claude Code" });
  addTodoTime({ todoId: t.id, minutes: 45, note: "implementation\nsecond line is dropped", by: "Claude Code" });
  const hand = addTodoTime({ todoId: t.id, minutes: 10, note: "call", by: "Du", source: "hand" });
  assert.equal(listTodoTimes([t.id]).length, 3);
  assert.equal(timeTotals([t.id]).get(t.id), 75);
  assert.equal(listTodoTimes([t.id])[1].note, "implementation");
  assert.equal(hand.source, "hand");
  assert.throws(() => addTodoTime({ todoId: t.id, minutes: 0 }), /Minutes/);
  assert.throws(() => addTodoTime({ todoId: t.id, minutes: 1441 }), /Minutes/);
  assert.throws(() => addTodoTime({ todoId: 999999, minutes: 5 }), /doesn't exist/);
  updateTodoTime(a.id, { minutes: 25 });
  assert.equal(timeTotals([t.id]).get(t.id), 80);
  markTimeBooked([a.id], 77);
  assert.throws(() => deleteTodoTime(a.id), /can't be changed/);
  deleteTodoTime(hand.id);
  assert.equal(listTodoTimes([t.id]).length, 2);
});

test("the MCP tool todo_time records only measured time — minutes given are no time; the instructions and the worker rules say so", async () => {
  const mcp = await tools();
  const { INSTRUCTIONS } = await import("@/mcp/server");
  const { workerRules } = await import("@/lib/work/brief");
  const { addTodoTime, listTodoTimes } = await import("@/lib/work/todo-time");
  const t = await todo("TT-2", "Reported by an agent");
  assert.match(text(await mcp.todo_time({ todo: "T-999999" })), /isn't a todo/);
  // "45 minutes of planning", no clock running: refused — nothing recorded.
  const guessed = await mcp.todo_time({ todo: `T-${t.id}`, minutes: 45, note: "Planung", agent: "Claude Code" });
  assert.equal(guessed.isError, true);
  assert.match(text(guessed), /only measured time/);
  assert.equal(listTodoTimes([t.id]).length, 0);
  // With a clock: a lap, measured (the minutes given count for nothing).
  await mcp.todo_clock_start({ todo: `T-${t.id}`, agent: "Claude Code" });
  const lap = await mcp.todo_time({ todo: `T-${t.id}`, minutes: 45, note: "first phase\nmore", agent: "Claude Code" });
  assert.match(text(lap), /Recorded TT-\d+: 1 min on T-\d+ .*measured by its clock/);
  await mcp.todo_clock_stop({ todo: `T-${t.id}`, agent: "Claude Code" });
  assert.equal(listTodoTimes([t.id])[0].note, "first phase");
  for (const r of listTodoTimes([t.id])) (await import("@/lib/work/todo-time")).deleteTodoTime(r.id);
  addTodoTime({ todoId: t.id, minutes: 30, note: "a", by: "Claude Code" });
  addTodoTime({ todoId: t.id, minutes: 30, note: "b", by: "Claude Code" });
  // list_todos shows the tracked time; todo_context the records.
  assert.match(text(await mcp.list_todos({})), new RegExp(`T-${t.id}[^\\n]*\\[tracked: 1 h\\]`));
  assert.match(text(await mcp.todo_context({ todo: `T-${t.id}` })), /## Erfasste Zeit \(1 h\)/);

  assert.match(INSTRUCTIONS, /todo_time/);
  assert.match(INSTRUCTIONS, /after each phase/);
  assert.match(INSTRUCTIONS, /ONLY MEASURED TIME IS BOOKED/);
  for (const opts of [{}, { conversation: true }, { conversation: true, live: true }]) {
    const rules = workerRules("", opts);
    assert.match(rules, /todo_time/, JSON.stringify(opts));
    assert.match(rules, /mcp__zeff__todo_time/);
    assert.match(rules, /report_time/); // still not allowed for booking
    assert.match(rules, /NUR gemessene Zeit/);
  }
  // The booking tools stay off for workers; todo_time isn't among them.
  const runner = (await import("node:fs")).readFileSync("src/lib/work/runner.ts", "utf8");
  assert.doesNotMatch(runner.match(/const ZEFF_TOOLS = \[[^\]]*\]/)![0], /todo_time/);
});

test("the time of related todos (same ticket, follow-up chain, session side todos) flows into one group", async () => {
  await setup("TT-3");
  await setup("TT-3B");
  const { addTodoTime } = await import("@/lib/work/todo-time");
  const { doneToday, relatedTodoIds } = await import("@/lib/work/booking");
  const { createRun, updateRun } = await import("@/lib/work/store");
  const a = await todo("TT-3", "Main");
  const b = await todo("TT-3", "Same ticket, still open");
  const child = await todo("TT-3", "Follow-up", { parentId: a.id });
  // A side todo of a session on another ticket: not in the done group, but touched by the session.
  const session = createRun({ ticket: "TT-3", todoId: a.id, mode: "instruct", provider: "claude", model: null, permissionMode: null, repo: null, prompt: "x" });
  const other = await todo("TT-3B", "Side todo of the session");
  const side = createRun({ ticket: "TT-3B", todoId: other.id, mode: "code", provider: "agent", model: `W-${session.id} · Session`, permissionMode: null, repo: null, prompt: "x" });
  updateRun(side.id, { status: "done" });
  const unrelated = await todo("TT-3B", "Not touched by anything");
  assert.deepEqual(new Set(relatedTodoIds(a.id)), new Set([a.id, b.id, child.id, other.id]));
  assert.ok(!relatedTodoIds(a.id).includes(unrelated.id));
  assert.ok(relatedTodoIds(other.id).includes(a.id));

  addTodoTime({ todoId: a.id, minutes: 20, note: "main work", by: "Claude Code" });
  addTodoTime({ todoId: a.id, minutes: 10, note: "tests", by: "Claude Code" });
  addTodoTime({ todoId: b.id, minutes: 7, note: "looked at the sibling", by: "Copilot" });
  addTodoTime({ todoId: other.id, minutes: 15, note: "side", by: `W-${session.id} · Session` });
  addTodoTime({ todoId: unrelated.id, minutes: 200, note: "elsewhere", by: "Copilot" });
  await finishToday(a.id);
  const group = doneToday().find((g) => g.ticket === "TT-3")!;
  // The sibling has time tracked today: it's in the group itself (still open); the side todo on the other ticket has its own group.
  assert.deepEqual(group.todoIds, [a.id, b.id]);
  // 20 + 10 + 7 = 37 min → 0.75 h (quarter-hour rounding up on the TOTAL, not per record).
  assert.equal(group.hours, 0.75);
  assert.equal(group.time.filter((l) => l.kind === "record").length, 3);
  assert.deepEqual(doneToday().find((g) => g.ticket === "TT-3B")?.todoIds.sort(), [other.id, unrelated.id].sort());
  assert.ok(group.time.every((l) => l.todo !== `T-${unrelated.id}`));
  assert.match(group.description, /main work/);
});

test("without records the runs' durations count; a record and its run are never both counted; by hand is a quarter", async () => {
  await setup("TT-4");
  const { addTodoTime } = await import("@/lib/work/todo-time");
  const { doneToday } = await import("@/lib/work/booking");
  const { createRun, updateRun } = await import("@/lib/work/store");
  const run = (todoId: number, ms: number, line: string) => {
    const r = createRun({ ticket: "TT-4", todoId, mode: "code", provider: "claude", model: "sonnet", permissionMode: null, repo: null, prompt: "x" });
    updateRun(r.id, { status: "done", durationMs: ms, entryLine: line });
    return r;
  };
  const noRecords = await todo("TT-4", "Worker only");
  run(noRecords.id, 40 * 60000, "worker line");
  const withRecords = await todo("TT-4", "Agent reported");
  const r2 = run(withRecords.id, 3 * 3600000, "wall clock of a live session");
  addTodoTime({ todoId: withRecords.id, minutes: 25, note: "real work", by: "Claude Code", runId: r2.id });
  const byHand = await todo("TT-4", "Done by hand");
  await finishToday(noRecords.id, withRecords.id, byHand.id);
  const g = doneToday().find((x) => x.ticket === "TT-4")!;
  // 40 min (run, no records) + 25 min (record; its run's 3 h is NOT counted) = 65 min → 1.25 h, + a quarter by hand.
  assert.equal(g.hours, 1.5);
  assert.equal(g.time.filter((l) => l.kind === "run").length, 1);
  assert.equal(g.time.filter((l) => l.kind === "hand").length, 1);
  assert.equal(g.time.find((l) => l.kind === "run")!.minutes, 40);
  // The live session's run took 3 h but only 25 min were reported on it: the rest is shown as a gap — not in the hours.
  const gap = g.time.find((l) => l.kind === "gap")!;
  assert.equal(gap.minutes, 155);
  assert.equal(gap.todoId, withRecords.id);
  assert.equal(g.hours, 1.5);
});

test("booking marks the records booked, links them as the entry's evidence and doesn't offer them again", async () => {
  await setup("TT-5");
  const { addTodoTime, listTodoTimes } = await import("@/lib/work/todo-time");
  const { doneToday, bookDoneToday } = await import("@/lib/work/booking");
  const { getDb, schema } = await import("@/db");
  const a = await todo("TT-5", "Booked");
  const b = await todo("TT-5", "Related, open");
  addTodoTime({ todoId: a.id, minutes: 30, note: "one", by: "Claude Code" });
  addTodoTime({ todoId: b.id, minutes: 15, note: "two", by: "Copilot" });
  await finishToday(a.id);
  const g = doneToday().find((x) => x.ticket === "TT-5")!;
  assert.equal(g.hours, 0.75);
  const r = bookDoneToday({ ticket: "TT-5", todoIds: g.todoIds, hours: g.hours, description: g.description });
  assert.ok(r.entryId);
  const recs = listTodoTimes([a.id, b.id]);
  assert.ok(recs.every((x) => x.entryId === r.entryId));
  const { timeLink } = await import("@/lib/entities-shared");
  const links = getDb().select().from(schema.contexts).all().flatMap((c) => c.links);
  for (const x of recs) assert.ok(links.some((l) => l.includes(timeLink(x.id))), `${x.ref} is linked`);
  assert.equal(doneToday().find((x) => x.ticket === "TT-5"), undefined);
});

test("a suggestion covers its records: not offered again; accepting books them; finish_todo records instead of suggesting twice", async () => {
  const number = await setup("TT-6");
  const mcp = await tools();
  const { addTodoTime, listTodoTimes } = await import("@/lib/work/todo-time");
  const { doneToday } = await import("@/lib/work/booking");
  const { acceptSuggestion, openSuggestions, getSuggestion } = await import("@/lib/work/suggestions");
  const { getTodo } = await import("@/lib/boards/store");

  // A record its clock measured on the way; finish_todo without a clock: the minutes it names are no time — ONE suggestion of the measured.
  const t = await todo("TT-6", "Agent work");
  addTodoTime({ todoId: t.id, minutes: 40, note: "phase one", by: "Claude Code" });
  const fin = text(await mcp.finish_todo({ todo: `T-${t.id}`, summary: "Done.", entry: "Feature built", minutes: 20, agent: "Claude Code", outcome: "done" }));
  assert.match(fin, /booking suggestion S-\d+/);
  assert.match(fin, /no measured time \(no clock ran\)/);
  const records = listTodoTimes([t.id]);
  assert.deepEqual(records.map((r) => r.minutes), [40], "the 20 minutes it named aren't recorded");
  assert.ok(records.every((r) => r.suggestionId != null));
  const mine = openSuggestions().filter((s) => s.todos.some((x) => x.id === t.id));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].hours, 0.75); // 40 min, to the next quarter hour
  assert.equal(mine[0].times.length, 1);

  // The todo is done, but the suggestion covers it: not offered by doneToday.
  const { setTodoStatus } = await import("@/lib/boards/store");
  setTodoStatus(t.id, "done");
  assert.equal(doneToday().find((g) => g.todoIds.includes(t.id)), undefined);

  // report_time: the hours are the todos' measured records — the hours it names count for nothing; none measured, refused.
  const u = await todo("TT-6", "Reported twice?");
  addTodoTime({ todoId: u.id, minutes: 10, note: "x", by: "Copilot" });
  const rt = text(await mcp.report_time({ jobNumber: number, hours: 3, description: "Quick fix", ticket: "TT-6", todos: [`T-${u.id}`], reportedBy: "Copilot" }));
  assert.match(rt, /Suggested S-\d+: 0\.25h/);
  assert.match(rt, /Measured: 10 min in 1 record/);
  assert.ok(listTodoTimes([u.id]).every((r) => r.suggestionId != null));
  const none = await todo("TT-6", "Never clocked");
  const refused = await mcp.report_time({ jobNumber: number, hours: 0.75, description: "Planung", ticket: "TT-6", todos: [`T-${none.id}`], reportedBy: "Copilot" });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /No measured time on T-\d+ — only measured time is booked/);
  const s0 = openSuggestions().find((x) => x.todos.some((y) => y.id === u.id))!;
  assert.match(text(await mcp.update_time_entry({ id: s0.ref, hours: 2 })), /can only be lowered/);

  // Accepting books the records with the entry.
  const e = acceptSuggestion(mine[0].id);
  assert.ok(listTodoTimes([t.id]).every((r) => r.entryId === e.entryId));
  assert.equal(getSuggestion(mine[0].id)!.status, "accepted");
  assert.equal(getTodo(t.id)!.status, "done");
});

test("measured: start_todo starts the todo's clock; todo_time without minutes records a lap, finish_todo the rest — no minutes needed", async () => {
  await setup("TT-7");
  const mcp = await tools();
  const { listTodoTimes } = await import("@/lib/work/todo-time");
  const { openClock } = await import("@/lib/work/todo-clock");
  const t = await todo("TT-7", "Measured work");
  assert.match(text(await mcp.start_todo({ todo: `T-${t.id}`, agent: "Claude Code" })), /Clock: running on T-\d+/);
  assert.ok(openClock(t.id, "Claude Code"));
  assert.match(text(await mcp.todo_time({ todo: `T-${t.id}`, note: "Recherche", agent: "Claude Code" })), /measured by its clock/);
  assert.match(text(await mcp.todo_needs_input({ todo: `T-${t.id}`, question: "Welche Variante?" })), /clock is paused/);
  assert.match(text(await mcp.todo_progress({ todo: `T-${t.id}`, message: "weiter" })), /Clock running again/);
  assert.match(text(await mcp.finish_todo({ todo: `T-${t.id}`, summary: "Done.", entry: "Feature built", agent: "Claude Code", outcome: "done" })), /booking suggestion S-\d+/);
  assert.equal(openClock(t.id, "Claude Code"), null, "finish stopped it");
  assert.deepEqual(listTodoTimes([t.id]).map((r) => r.note), ["Recherche", "Feature built"]);
  // A clock that went quiet: finish_todo with the agent's own log (read times) — Zeff computes from it.
  const q = await todo("TT-7", "Forgot to ping");
  await mcp.start_todo({ todo: `T-${q.id}`, agent: "VS Code Copilot" });
  const began = new Date(Date.now() - 50 * 60000).toISOString();
  const fq = text(await mcp.finish_todo({ todo: `T-${q.id}`, summary: "Done.", entry: "Built it", agent: "VS Code Copilot", outcome: "done", log: { from: began, to: new Date().toISOString() } }));
  assert.match(fq, /\d+ min measured/);
  assert.ok(listTodoTimes([q.id]).reduce((a, r) => a + r.minutes, 0) <= 2, "never before the clock started (just now): not 50 minutes");
  const bad = await mcp.todo_clock_stop({ todo: `T-${t.id}`, agent: "Claude Code", log: { from: "vorhin", to: "jetzt" } });
  assert.match(text(bad), /isn't a todo|No clock|isn't a time/);
  // The start answer gives the exact start time to keep (log.from).
  const s2 = await todo("TT-7", "Start time given");
  assert.match(text(await mcp.start_todo({ todo: `T-${s2.id}`, agent: "Codex" })), /since \d{4}-\d\d-\d\dT[\d:.]+Z [\s\S]*KEEP THIS START TIME/);
  await mcp.todo_clock_stop({ todo: `T-${s2.id}`, agent: "Codex" });
  // Without a clock and without minutes: told to start one.
  const u = await todo("TT-7", "No clock");
  assert.match(text(await mcp.todo_time({ todo: `T-${u.id}`, agent: "Claude Code" })), /No clock runs on T-\d+ — only measured time/);
  assert.match(text(await mcp.todo_clock_start({ todo: `T-${u.id}`, agent: "Claude Code" })), /Clock started/);
  assert.match(text(await mcp.todo_clock_stop({ todo: `T-${u.id}`, note: "kurz", agent: "Claude Code" })), /Clock stopped on T-\d+: 1 min recorded/);
});

test("every agent (Copilot too) reads the clock rule where it meets a todo: list_todos says it; todo_clock_ping keeps the clock running", async () => {
  await setup("TT-8");
  const mcp = await tools();
  const t = await todo("TT-8", "Copilot works on it");
  const list = text(await mcp.list_todos({ ticket: "TT-8" }));
  assert.match(list, /todo_clock_ping AT LEAST EVERY 10 MINUTES/);
  assert.match(list, /for every agent \(Copilot/);
  await mcp.start_todo({ todo: `T-${t.id}`, agent: "VS Code Copilot" });
  assert.match(text(await mcp.todo_clock_ping({ todo: `T-${t.id}`, agent: "VS Code Copilot" })), /clock running, \d+ min so far\. Next ping within 10 minutes/);
  assert.match(text(await mcp.todo_clock_ping({ todo: "T-999999", agent: "VS Code Copilot" })), /isn't a todo/);
});

test("an agent corrects a wrong time record (TT-<id>) or deletes it — not once it's suggested or booked", async () => {
  await setup("TT-9");
  const mcp = await tools();
  const { listTodoTimes, markTimeSuggested } = await import("@/lib/work/todo-time");
  const t = await todo("TT-9", "Too much booked");
  const { addTodoTime } = await import("@/lib/work/todo-time");
  const ref = addTodoTime({ todoId: t.id, minutes: 60, note: "Teaser columns", by: "Claude Code" }).ref;
  assert.match(text(await mcp.todo_time_update({ record: ref, hours: 0.5 })), /is now 30 ?min/);
  assert.match(text(await mcp.todo_time_update({ record: ref, minutes: 45 })), /only be lowered, never raised/);
  assert.equal(listTodoTimes([t.id])[0].minutes, 30);
  assert.match(text(await mcp.todo_time_update({ record: ref.slice(3), note: "Teaser columns 11:36–12:02" })), /Teaser columns 11:36–12:02/);
  assert.match(text(await mcp.todo_time_update({ record: "T-12" })), /isn't a time record/);
  const id = Number(ref.slice(3));
  markTimeSuggested([id], 1);
  assert.match(text(await mcp.todo_time_update({ record: ref, minutes: 10 })), /can't be changed any more/);
  markTimeSuggested([id], null);
  assert.match(text(await mcp.todo_time_delete({ record: ref })), /deleted/);
  assert.equal(listTodoTimes([t.id]).length, 0);
});
