import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The merge of a merge request that isn't approved yet is held back by default (the button waits); a setting (Settings → Todos) switches that
 * off, for those who want to merge before the approval shows. A merge request that is merged or closed already stays blocked either way.
 */
test("the merge waits for the approval by default; with the setting off it doesn't — merged and closed ones are blocked always", async () => {
  const { saveGitlabItems } = await import("@/lib/gitlab/store");
  const store = await import("@/lib/boards/store");
  const { blockedBy } = await import("@/lib/boards/alternatives");
  const { getTodoDisplayOff, setTodoDisplayOff } = await import("@/lib/todo-display-store");
  const mr = (iid: number, state: string) => ({ key: `mr:g/p!${iid}`, kind: "mr" as const, project: "g/p", projectUrl: "https://git.example.com/g/p", ref: `!${iid}`, title: "t", body: "", author: "m", state, createdAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:00:00Z", url: `https://git.example.com/g/p/-/merge_requests/${iid}`, branch: `feature/x${iid}`, parent: null, thread: null, resolvedAt: null });
  saveGitlabItems([mr(1, "opened"), mr(2, "approved"), mr(3, "merged"), mr(4, "closed")] as never);
  const todo = (n: number) => {
    const t = store.addManualTodo({ ticket: `GATE-${n}`, text: `Merge !${n}` });
    store.setTodoOps(t.id, [{ type: "gitlab-merge", project: "g/p", iid: n, source: `feature/x${n}` }] as never);
    return store.getTodo(t.id)!;
  };
  const todos = [1, 2, 3, 4].map(todo);
  const [open, approved, merged, closed] = todos;

  assert.ok(!getTodoDisplayOff().includes("mergeGate"), "on by default");
  let b = blockedBy(todos);
  assert.match(b[open.id], /isn't approved/);
  assert.equal(b[approved.id], undefined);
  assert.match(b[merged.id], /merged already/);
  assert.match(b[closed.id], /closed/);

  setTodoDisplayOff([...getTodoDisplayOff(), "mergeGate"]);
  assert.ok(getTodoDisplayOff().includes("mergeGate"), "the setting is kept");
  b = blockedBy(todos);
  assert.equal(b[open.id], undefined, "not approved: no longer held back");
  assert.match(b[merged.id], /merged already/);
  assert.match(b[closed.id], /closed/);
});
