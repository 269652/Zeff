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

test("the MCP tool todo_time validates and records; the instructions and the worker rules mention it", async () => {
  const mcp = await tools();
  const { INSTRUCTIONS } = await import("@/mcp/server");
  const { workerRules } = await import("@/lib/work/brief");
  const { listTodoTimes } = await import("@/lib/work/todo-time");
  const t = await todo("TT-2", "Reported by an agent");
  assert.match(text(await mcp.todo_time({ todo: "T-999999", minutes: 5 })), /isn't a todo/);
  assert.match(text(await mcp.todo_time({ todo: `T-${t.id}` })), /minutes/i);
  const bad = await mcp.todo_time({ todo: `T-${t.id}`, minutes: 2000 });
  assert.equal(bad.isError, true);
  const ok = await mcp.todo_time({ todo: `T-${t.id}`, minutes: 30, note: "first phase\nmore", agent: "Claude Code" });
  assert.match(text(ok), /Recorded TT-\d+: 30 min on T-\d+/);
  await mcp.todo_time({ todo: `T-${t.id}`, hours: 0.5, note: "second phase", agent: "Claude Code" });
  const rec = listTodoTimes([t.id]);
  assert.deepEqual(rec.map((r) => r.minutes), [30, 30]);
  assert.equal(rec[0].note, "first phase");
  // list_todos shows the tracked time; todo_context the records.
  assert.match(text(await mcp.list_todos({})), new RegExp(`T-${t.id}[^\\n]*\\[tracked: 1 h\\]`));
  assert.match(text(await mcp.todo_context({ todo: `T-${t.id}` })), /## Erfasste Zeit \(1 h\)/);

  assert.match(INSTRUCTIONS, /todo_time/);
  assert.match(INSTRUCTIONS, /after each phase/);
  for (const opts of [{}, { conversation: true }, { conversation: true, live: true }]) {
    const rules = workerRules("", opts);
    assert.match(rules, /todo_time/, JSON.stringify(opts));
    assert.match(rules, /mcp__zeff__todo_time/);
    assert.match(rules, /report_time/); // still not allowed for booking
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
  assert.deepEqual(group.todoIds, [a.id]);
  // 20 + 10 + 7 + 15 = 52 min → 1 h (quarter-hour rounding on the TOTAL, not per record).
  assert.equal(group.hours, 1);
  assert.equal(group.time.filter((l) => l.kind === "record").length, 4);
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

  // start_todo, a record on the way, finish_todo with the rest: ONE suggestion with both as evidence.
  const t = await todo("TT-6", "Agent work");
  await mcp.start_todo({ todo: `T-${t.id}`, agent: "Claude Code" });
  const rec = await mcp.todo_time({ todo: `T-${t.id}`, minutes: 40, note: "phase one", agent: "Claude Code" });
  assert.match(text(rec), /Recorded/);
  const fin = text(await mcp.finish_todo({ todo: `T-${t.id}`, summary: "Done.", entry: "Feature built", minutes: 20, agent: "Claude Code", outcome: "done" }));
  assert.match(fin, /booking suggestion S-\d+/);
  const records = listTodoTimes([t.id]);
  assert.deepEqual(records.map((r) => r.minutes), [40, 20]);
  assert.equal(records[1].note, "Feature built");
  assert.ok(records.every((r) => r.suggestionId != null));
  const mine = openSuggestions().filter((s) => s.todos.some((x) => x.id === t.id));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].hours, 1); // 60 min
  assert.equal(mine[0].times.length, 2);

  // The todo is done, but the suggestion covers it: not offered by doneToday.
  const { setTodoStatus } = await import("@/lib/boards/store");
  setTodoStatus(t.id, "done");
  assert.equal(doneToday().find((g) => g.todoIds.includes(t.id)), undefined);

  // A report_time for a todo with records tells the agent.
  const u = await todo("TT-6", "Reported twice?");
  addTodoTime({ todoId: u.id, minutes: 10, note: "x", by: "Copilot" });
  const rt = text(await mcp.report_time({ jobNumber: number, hours: 0.25, description: "Quick fix", ticket: "TT-6", todos: [`T-${u.id}`], reportedBy: "Copilot" }));
  assert.match(rt, /already reported on T-\d+ with todo_time/);
  assert.ok(listTodoTimes([u.id]).every((r) => r.suggestionId != null));

  // Accepting books the records with the entry.
  const e = acceptSuggestion(mine[0].id);
  assert.ok(listTodoTimes([t.id]).every((r) => r.entryId === e.entryId));
  assert.equal(getSuggestion(mine[0].id)!.status, "accepted");
  assert.equal(getTodo(t.id)!.status, "done");
});
