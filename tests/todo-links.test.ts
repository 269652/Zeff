import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const at = () => new Date().toISOString();
async function todo(ticket: string, text: string) {
  const { addFollowUp } = await import("@/lib/boards/store");
  return addFollowUp({ ticket, text, kind: "implement", parentId: null as unknown as number, workRunId: null, source: "test" });
}
async function gitlab(key: string, kind: "branch" | "mr", branch: string) {
  const { getDb, schema } = await import("@/db");
  getDb().insert(schema.gitlabItems).values({ key, kind, project: "grp/proj", projectUrl: "u", ref: kind === "mr" ? "!7" : branch, title: branch, body: "", url: `https://git/${key}`, syncedAt: at(), branch } as never).run();
}

test("the relation todo ↔ branch is recorded on its own: its GitLab branch and merge request are context whatever happens to the todo", async () => {
  const { recordBranch, todoBranches, getTodo, reconcileTodos, setTodoOps } = await import("@/lib/boards/store");
  const t = await todo("TL-1", "Migrationslogik umbauen");
  await gitlab("branch:grp/proj:feature/TL-1-x", "branch", "feature/TL-1-x");
  await gitlab("mr:grp/proj!7", "mr", "feature/TL-1-x");
  assert.equal(recordBranch(t.id, "feature/TL-1-x", "C:/repo", "run"), true);
  assert.equal(recordBranch(t.id, "feature/TL-1-x", "C:/repo", "run"), false, "once");
  assert.deepEqual(todoBranches(t.id).map((b) => b.value), ["feature/TL-1-x"]);
  assert.deepEqual(getTodo(t.id)!.refs.filter((r) => r.startsWith("gitlab:")).sort(), ["gitlab:branch:grp/proj:feature/TL-1-x", "gitlab:mr:grp/proj!7"]);
  // The todo is rewritten, its operations and runs are gone: the relation stays.
  setTodoOps(t.id, []);
  reconcileTodos({ tickets: [{ key: "TL-1", resolved: [], todos: [{ id: t.id, text: "Migrationslogik fertigstellen", kind: "implement", owner: "me", refs: ["teams:19:x|1"] }] }] } as never, 1);
  const refs = getTodo(t.id)!.refs;
  assert.ok(refs.includes("gitlab:branch:grp/proj:feature/TL-1-x"));
  assert.ok(refs.includes("gitlab:mr:grp/proj!7"));
  assert.ok(refs.includes("teams:19:x|1"));
});

test("context stays until you dismiss it by hand: the briefing run adds to it, it doesn't replace it — and a dismissed item stays out", async () => {
  const { reconcileTodos, getTodo, dismissTodoContext, addTodoContext, recordBranch } = await import("@/lib/boards/store");
  const t = await todo("TL-2", "Antworten");
  addTodoContext(t.id, ["teams:19:x|1", "mail:abc"], "", "Zeff");
  reconcileTodos({ tickets: [{ key: "TL-2", resolved: [], todos: [{ id: t.id, text: "Antworten", kind: "other", owner: "me", refs: ["teams:19:x|2"] }] }] } as never, 1);
  assert.deepEqual(getTodo(t.id)!.refs.filter((r) => r.startsWith("teams:")).sort(), ["teams:19:x|1", "teams:19:x|2"], "earlier context stays");

  dismissTodoContext(t.id, "teams:19:x|1");
  assert.ok(!getTodo(t.id)!.refs.includes("teams:19:x|1"));
  // Cited again by the run or added by a step: it stays out.
  reconcileTodos({ tickets: [{ key: "TL-2", resolved: [], todos: [{ id: t.id, text: "Antworten", kind: "other", owner: "me", refs: ["teams:19:x|1"] }] }] } as never, 2);
  addTodoContext(t.id, ["teams:19:x|1"], "", "Zeff");
  assert.ok(!getTodo(t.id)!.refs.includes("teams:19:x|1"));
  assert.ok(getTodo(t.id)!.refs.includes("teams:19:x|2"));

  // A branch item dismissed by hand stays dismissed — recorded again, it doesn't come back; its merge request does if you didn't dismiss it.
  await gitlab("branch:grp/proj:feature/TL-2-y", "branch", "feature/TL-2-y");
  await gitlab("mr:grp/proj!9", "mr", "feature/TL-2-y");
  recordBranch(t.id, "feature/TL-2-y", null, "run");
  dismissTodoContext(t.id, "gitlab:branch:grp/proj:feature/TL-2-y");
  recordBranch(t.id, "feature/TL-2-y", null, "run");
  const refs = getTodo(t.id)!.refs;
  assert.ok(!refs.includes("gitlab:branch:grp/proj:feature/TL-2-y"));
  assert.ok(refs.includes("gitlab:mr:grp/proj!9"));
});

test("the mail, note and document relations add to what a todo is related to — once related, it stays until you dismiss it", async () => {
  const { setTodoMailRefs, getTodo, dismissTodoContext } = await import("@/lib/boards/store");
  const t = await todo("TL-3", "Mail beantworten");
  setTodoMailRefs(new Map([[t.id, ["mail:a", "mail:b"]]]));
  setTodoMailRefs(new Map([[t.id, ["mail:c"]]])); // the next run picks another one
  assert.deepEqual(getTodo(t.id)!.refs.filter((r) => r.startsWith("mail:")).sort(), ["mail:a", "mail:b", "mail:c"]);
  dismissTodoContext(t.id, "mail:b");
  setTodoMailRefs(new Map([[t.id, ["mail:b", "mail:c"]]]));
  assert.deepEqual(getTodo(t.id)!.refs.filter((r) => r.startsWith("mail:")).sort(), ["mail:a", "mail:c"]);
  assert.deepEqual(getTodo(t.id)!.mailRefs.sort(), ["mail:a", "mail:c"]);
});
