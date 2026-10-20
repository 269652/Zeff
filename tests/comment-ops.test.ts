import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * A todo that stands for GitLab review comments (its refs name them: gitlab:note:<id>) offers "Resolve" for each thread still open, and the
 * reply the AI drafted before it — whatever other actions the todo has (a hand-over to a worker, a merge request) stay as they are.
 */
const open = (id: number) => ({ type: "gitlab-open-mr" as const, repo: "C:\r", project: "g/p", source: "feature/x", target: "main", title: "t", description: "d" });
const comment = (id: number, state: string | null = null) => ({ key: `note:${id}`, kind: "comment" as const, state, resolvedAt: null });

test("which notes a todo names, and which of them are threads still open", async () => {
  const { noteKeysOf, openThreads } = await import("@/lib/boards/comment-ops");
  assert.deepEqual(noteKeysOf(["teams:x|1", "gitlab:note:472364", "gitlab:note:472373", "gitlab:note:472364", "jira:abc"]), ["note:472364", "note:472373"]);
  const items = new Map([["note:472364", comment(472364, "unresolved")], ["note:472373", comment(472373, "resolved")], ["note:472374", comment(472374)]]);
  assert.deepEqual(openThreads(["note:472364", "note:472373", "note:472374", "note:1"], items as never), ["note:472364", "note:472374"], "a resolved one and an unknown one are not offered");
});

test("Resolve for each open thread, the reply before it; what is there stays; nothing twice", async () => {
  const { withCommentOps } = await import("@/lib/boards/comment-ops");
  const base = [open(1)];
  const withResolve = withCommentOps(base as never, ["note:1", "note:2"], []);
  assert.deepEqual(withResolve.map((o) => o.type), ["gitlab-open-mr", "gitlab-resolve", "gitlab-resolve"]);
  assert.equal(withCommentOps(withResolve, ["note:1", "note:2"], []).length, 3, "again: nothing added");
  // The AI's replies go in front of their thread's Resolve; one for a note that is not open is dropped; a second for the same note too.
  const replies = [
    { type: "gitlab-reply" as const, note: "note:2", body: "Umgesetzt." },
    { type: "gitlab-reply" as const, note: "note:9", body: "fremd" },
    { type: "gitlab-reply" as const, note: "note:2", body: "doppelt" },
  ];
  const full = withCommentOps(withResolve, ["note:1", "note:2"], replies as never);
  assert.deepEqual(full.map((o) => `${o.type}${"note" in o ? ":" + o.note : ""}`), ["gitlab-open-mr", "gitlab-resolve:note:1", "gitlab-reply:note:2", "gitlab-resolve:note:2"]);
  assert.equal((full[2] as { body: string }).body, "Umgesetzt.");
});

test("attachCommentOps: the open todos with open threads get their Resolve actions (by the todo's refs)", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("gitlab", true);
  const { saveGitlabItems } = await import("@/lib/gitlab/store");
  const store = await import("@/lib/boards/store");
  const { attachCommentOps } = await import("@/lib/boards/comment-ops");
  const note = (id: number, state: string) => ({ key: `note:${id}`, kind: "comment" as const, project: "g/p", projectUrl: "https://git.example.com/g/p", ref: "!189", title: "c", body: "Bitte ändern", author: "chris", state, createdAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:00:00Z", url: `https://git.example.com/g/p/-/merge_requests/189#note_${id}`, branch: null, parent: "g/p!189", thread: "t", resolvedAt: null });
  saveGitlabItems([note(472364, "unresolved"), note(472373, "resolved"), note(472374, "unresolved")]);
  const t = store.addManualTodo({ ticket: "PROJ-454", text: "Threads in !189 beantworten" });
  {
    const { getDb, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    getDb().update(schema.todos).set({ refs: JSON.stringify(["gitlab:note:472364", "gitlab:note:472373", "gitlab:note:472374"]) }).where(eq(schema.todos.id, t.id)).run();
  }
  store.setTodoOps(t.id, [open(1)] as never);
  const n = await attachCommentOps();
  assert.equal(n, 1, "one todo changed");
  const ops = store.getTodo(t.id)!.ops;
  assert.deepEqual(ops.map((o) => `${o.type}${"note" in o ? ":" + o.note : ""}`), ["gitlab-open-mr", "gitlab-resolve:note:472364", "gitlab-resolve:note:472374"]);
  assert.equal(await attachCommentOps(), 0, "nothing more to add");
});

test("an Open MR action while that merge request is open already becomes the merge of it", async () => {
  const { upgradeOpenOps, upgradeOpenMrOps } = await import("@/lib/boards/delivery-ops");
  const mr = { project: "g/p", branch: "feature/x", state: "opened", ref: "!189" };
  const openOp = { type: "gitlab-open-mr" as const, repo: "C:\r", project: "g/p", source: "feature/x", target: "main", title: "t", description: "d" };
  const push = { type: "git-push" as const, repo: "C:\r", branch: "feature/x", remote: "feature/x", target: "main", title: "t", description: "d" };
  assert.deepEqual(upgradeOpenOps([push, openOp], [mr]), [push, { type: "gitlab-merge", project: "g/p", iid: 189, source: "feature/x" }]);
  assert.equal(upgradeOpenOps([push, openOp], []), null, "no merge request known: nothing to change");
  assert.equal(upgradeOpenOps([push, openOp], [{ ...mr, state: "merged" }]), null, "a merged one doesn't count");
  assert.equal(upgradeOpenOps([push], [mr]), null);

  const { saveGitlabItems } = await import("@/lib/gitlab/store");
  const store = await import("@/lib/boards/store");
  saveGitlabItems([{ key: "g/p!189", kind: "mr", project: "g/p", projectUrl: "https://git.example.com/g/p", ref: "!189", title: "feat(PROJ-454): x", body: "", author: "moritz", state: "opened", createdAt: "2026-10-19T10:00:00Z", updatedAt: "2026-10-19T10:00:00Z", url: "https://git.example.com/g/p/-/merge_requests/189", branch: "feature/PROJ-454-up", parent: null, thread: null, resolvedAt: null }] as never);
  const t = store.addManualTodo({ ticket: "PROJ-454", text: "Merge request öffnen" });
  store.setTodoOps(t.id, [{ ...openOp, source: "feature/PROJ-454-up" }] as never);
  assert.equal(await upgradeOpenMrOps(), 1);
  assert.deepEqual(store.getTodo(t.id)!.ops, [{ type: "gitlab-merge", project: "g/p", iid: 189, source: "feature/PROJ-454-up" }]);
  assert.equal(await upgradeOpenMrOps(), 0);
});

test("when replies answer every open thread, the hand-over to a worker is obsolete (the work is done: the replies say so)", async () => {
  const { dropObsoleteInstructs } = await import("@/lib/boards/comment-ops");
  const instruct = { type: "work-instruct" as const, instruction: "Entferne den Checker" };
  const reply = (n: number) => ({ type: "gitlab-reply" as const, note: `note:${n}`, body: "Umgesetzt." });
  const resolve = (n: number) => ({ type: "gitlab-resolve" as const, note: `note:${n}` });
  assert.deepEqual(dropObsoleteInstructs([instruct, reply(1), resolve(1), reply(2), resolve(2)] as never, ["note:1", "note:2"]).map((o) => o.type), ["gitlab-reply", "gitlab-resolve", "gitlab-reply", "gitlab-resolve"]);
  // One thread without a reply: the instruction stays (there is something left to do).
  assert.equal(dropObsoleteInstructs([instruct, reply(1), resolve(1), resolve(2)] as never, ["note:1", "note:2"]).length, 4);
  // No open thread named: nothing to judge by.
  assert.equal(dropObsoleteInstructs([instruct] as never, []).length, 1);
});
