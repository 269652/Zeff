import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A todo with a GitLab reply, a second reply and a hand-over to a worker. */
let n = 0;
async function setup() {
  const ticket = `OP-${++n}`;
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("gitlab", true);
  const { addFollowUp } = await import("@/lib/todos/store");
  const ops = [
    { type: "gitlab-reply", note: `note:${n}1`, body: "first" },
    { type: "gitlab-reply", note: `note:${n}2`, body: "second" },
    { type: "work-instruct", ticket, instruction: "do the rest" },
  ];
  return addFollowUp({ ticket, text: `Answer the review threads of ticket number ${n} in its merge request`, kind: "reply", parentId: null as unknown as number, workRunId: null, source: "test", ops: ops as never });
}
const opsOf = async (id: number) => (await import("@/lib/todos/store")).getTodo(id)!.ops;

test("running one action takes only that one off the todo — the others stay", async () => {
  const todo = await setup();
  const { RUNNERS } = await import("@/plugins/actions/run");
  const { runTodoOpsNow } = await import("@/lib/ops");
  const ran: string[] = [];
  RUNNERS["gitlab-reply"] = (async (op: { note: string }) => {
    ran.push(op.note);
    return { what: `replied ${op.note}` };
  }) as never;
  await runTodoOpsNow(todo.id, { only: [0] });
  assert.deepEqual(ran, ["note:11"]);
  assert.deepEqual((await opsOf(todo.id)).map((o) => o.type), ["gitlab-reply", "work-instruct"], "the second reply and the hand-over are still there");
  assert.equal((await import("@/lib/todos/store")).getTodo(todo.id)!.status, "open");
});

test("what changes on the todo while an action runs is kept: a list written meanwhile isn't overwritten by the old one", async () => {
  const todo = await setup();
  const { RUNNERS } = await import("@/plugins/actions/run");
  const { runTodoOpsNow } = await import("@/lib/ops");
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  RUNNERS["gitlab-reply"] = (async () => {
    // The auto-actions review (or you) rewrites the todo's actions while GitLab is being talked to.
    const now = JSON.parse(getDb().select({ ops: schema.todos.ops }).from(schema.todos).where(eq(schema.todos.id, todo.id)).get()!.ops) as unknown[];
    getDb().update(schema.todos).set({ ops: JSON.stringify([...now, { type: "teams-message", to: "Chris", body: "added meanwhile" }]) }).where(eq(schema.todos.id, todo.id)).run();
    return { what: "replied" };
  }) as never;
  await runTodoOpsNow(todo.id, { only: [0] });
  const types = (await opsOf(todo.id)).map((o) => o.type);
  assert.deepEqual(types, ["gitlab-reply", "work-instruct", "teams-message"], "the one that ran is gone, the new one is there, nothing came back or vanished");
});

test("a failing action stays on the todo with the others", async () => {
  const todo = await setup();
  const { RUNNERS } = await import("@/plugins/actions/run");
  const { runTodoOpsNow } = await import("@/lib/ops");
  RUNNERS["gitlab-reply"] = (async () => {
    throw new Error("GitLab: Failed to fetch");
  }) as never;
  await assert.rejects(runTodoOpsNow(todo.id, { only: [0] }), /Failed to fetch/);
  assert.equal((await opsOf(todo.id)).length, 3);
});
