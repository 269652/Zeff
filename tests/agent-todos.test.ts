import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
async function tools(): Promise<Record<string, Handler>> {
  const { registerZeffTools } = await import("@/mcp/server");
  const out: Record<string, Handler> = {};
  registerZeffTools({ registerTool: (name: string, _cfg: unknown, fn: Handler) => void (out[name] = fn) } as never);
  return out;
}
const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join("\n");

/**
 * An agent writes its steps as todos on the ticket (add_todo) and ticks off the ones it made itself (complete_todo with tick) —
 * so you can add more and send it for another round. What it didn't make, it can only report done (you tick that).
 */
test("add_todo: the agent's steps as todos on the ticket, none twice; complete_todo tick closes only its own", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("todos", true);
  const t = await tools();
  assert.ok(t.add_todo, "the tool is there");
  const a = await t.add_todo({ ticket: "PROJ-1", text: "Partial überschreiben" });
  assert.ok(!a.isError, text(a));
  assert.match(text(a), /T-\d+/);
  const again = await t.add_todo({ ticket: "PROJ-1", text: "Partial überschreiben" });
  assert.equal(text(again).match(/T-\d+/)![0], text(a).match(/T-\d+/)![0], "the same todo, not a second");

  const { listTodos, addManualTodo } = await import("@/lib/todos/store");
  const mine = listTodos({ status: "open" }).filter((x) => x.ticket === "PROJ-1");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].owner, "me");

  const ref = text(a).match(/T-\d+/)![0];
  const ticked = await t.complete_todo({ todo: ref, note: "gemacht", tick: true });
  assert.ok(!ticked.isError, text(ticked));
  const after = listTodos({ status: "all" }).find((x) => x.ref === ref)!;
  assert.equal(after.status, "done", "its own todo: ticked off");

  // A todo of yours that the agent did: ticked off too (you let it work through the ticket's todos); and one already closed stays.
  const yours = addManualTodo({ ticket: "PROJ-1", text: "Backend dazu abstimmen" });
  const r = await t.complete_todo({ todo: yours.ref, note: "abgestimmt", tick: true });
  assert.ok(!r.isError, text(r));
  assert.equal(listTodos({ status: "all" }).find((x) => x.id === yours.id)!.status, "done");
  const closed = await t.complete_todo({ todo: yours.ref, tick: true });
  assert.match(text(closed), /already/i);
});

/**
 * The delivery of a job's branch (push, merge request) as a todo with those actions — never folded into an unrelated todo of the
 * ticket (the todo gate does that with similar ones), and an open todo that already pushes the branch gets the merge request added.
 */
test("deliveryTodo: its own todo with the actions; one that already pushes the branch gets the merge request; a similar unrelated todo is left alone", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("todos", true);
  const store = await import("@/lib/todos/store");
  const push = (branch: string, remote = branch) => ({ type: "git-push" as const, repo: "C:\r", branch, remote, target: "main", title: "PROJ-9: x", description: "d" });
  const mr = (source: string) => ({ type: "gitlab-open-mr" as const, repo: "C:\r", project: "grp/proj", source, target: "main", title: "PROJ-9: x", description: "d" });

  // An unrelated open todo on the ticket with similar words: the delivery doesn't vanish into it.
  const other = store.addManualTodo({ ticket: "PROJ-9", text: "Footer umbauen und liefern" });
  const a = store.deliveryTodo({ ticket: "PROJ-9", text: "Footer umbauen und liefern: push, merge request", runId: null, branch: "feature/PROJ-9-footer", ops: [push("feature/PROJ-9-footer", "feature/PROJ-9-footer-neu"), mr("feature/PROJ-9-footer-neu")] });
  assert.notEqual(a.todo.id, other.id, "a todo of its own");
  assert.deepEqual(a.todo.ops.map((o) => o.type), ["git-push", "gitlab-open-mr"]);
  assert.equal(store.getTodo(other.id)!.ops.length, 0, "the other todo is untouched");

  // The same branch again: that todo, not a second.
  const b = store.deliveryTodo({ ticket: "PROJ-9", text: "egal", runId: null, branch: "feature/PROJ-9-footer", ops: [push("feature/PROJ-9-footer", "feature/PROJ-9-footer-neu"), mr("feature/PROJ-9-footer-neu")] });
  assert.equal(b.todo.id, a.todo.id);

  // An open todo that only pushes the branch gets the merge request.
  const pushOnly = store.addManualTodo({ ticket: "PROJ-10", text: "Branch pushen" });
  store.setTodoOps(pushOnly.id, [push("feature/PROJ-10-x")]);
  const c = store.deliveryTodo({ ticket: "PROJ-10", text: "Deliver", runId: null, branch: "feature/PROJ-10-x", ops: [push("feature/PROJ-10-x", "feature/PROJ-10-y"), mr("feature/PROJ-10-y")] });
  assert.equal(c.todo.id, pushOnly.id);
  assert.deepEqual(c.todo.ops.map((o) => o.type), ["git-push", "gitlab-open-mr"]);
  const mrOp = c.todo.ops[1] as { source: string };
  assert.equal(mrOp.source, "feature/PROJ-10-x", "the merge request is from what that push pushes");
});

test("todo_note: the AI leaves a note on a todo (an AI note, with its name; shown among the todo's notes)", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("todos", true);
  const t = await tools();
  assert.ok(t.todo_note, "the tool is there");
  const { addManualTodo, getTodo } = await import("@/lib/todos/store");
  const todo = addManualTodo({ ticket: "NOTE-1", text: "Etwas prüfen" });
  const r = await t.todo_note({ todo: todo.ref, note: "Der Fix liegt auf feature/NOTE-1-x; Tests laufen.", agent: "Copilot", url: "https://git.example.com/mr/1", urlLabel: "MR !1" });
  assert.ok(!r.isError, text(r));
  const notes = getTodo(todo.id)!.userNotes;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, "Der Fix liegt auf feature/NOTE-1-x; Tests laufen.");
  assert.equal((notes[0] as { by?: string }).by, "Copilot");
  assert.equal((notes[0] as { urlLabel?: string }).urlLabel, "MR !1");
  const empty = await t.todo_note({ todo: todo.ref, note: "   " });
  assert.ok(empty.isError, "an empty note is refused");
  const gone = await t.todo_note({ todo: "T-999999", note: "x" });
  assert.ok(gone.isError);
});
