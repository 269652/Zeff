import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT } from "./helpers";

/**
 * Nothing is sent, posted or exported unless you click: the tools that write to other systems
 * (a WhatsApp or Teams message, a Jira or GitLab change, the Chrono/Punch export) are called only
 * from the places that run on a click — and the automatic AI steps (the Lage, the reviews,
 * auto-actions, the scheduler) never import what runs actions. A new caller fails this test:
 * look at it, and add it here only if it, too, runs on a click.
 */

const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
const SRC = files(path.join(ROOT, "src")).map((f) => ({ file: path.relative(ROOT, f).replace(/\\/g, "/"), text: fs.readFileSync(f, "utf8") }));
const using = (needle: string) =>
  SRC.filter((f) => f.text.includes(needle))
    .map((f) => f.file)
    .sort();

const WRITES: Record<string, string[]> = {
  whatsapp_send: ["src/plugins/whatsapp/run.ts"],
  signal_send: ["src/plugins/signal/run.ts"],
  teams_send: ["src/plugins/teams/run.ts"],
  gitlab_reply: ["src/lib/gitlab/reply.ts"],
  gitlab_resolve: ["src/lib/gitlab/reply.ts"],
  gitlab_open_mr: ["src/lib/gitlab/reply.ts"],
  gitlab_merge_mr: ["src/lib/gitlab/reply.ts"],
  gitlab_comment: ["src/lib/gitlab/reply.ts"],
  // (note-sync.ts: your note put on its ticket — the "Sync to Jira" click on a note.)
  jira_add_comment: ["src/lib/boards/actions.ts", "src/lib/jira/context-sync.ts", "src/lib/jira/note-sync.ts", "src/lib/work/runner.ts", "src/plugins/jira/run.ts"],
  jira_transition_issue: ["src/lib/boards/actions.ts", "src/lib/work/runner.ts", "src/plugins/jira/run.ts"],
  jira_update_issue: ["src/lib/boards/actions.ts", "src/lib/jira/context-sync.ts", "src/lib/work/runner.ts", "src/plugins/jira/run.ts"],
  jira_create_issue_link: ["src/plugins/jira/run.ts"],
  jira_edit_comment: ["src/lib/jira/context-sync.ts", "src/lib/jira/note-sync.ts"],
  jira_create_issue: ["src/plugins/jira/run.ts"],
  // The driver call (call.ts) and the click that exports (server-actions.ts).
  chrono_export: ["src/plugins/chrono/call.ts", "src/plugins/chrono/server-actions.ts"],
  punch_export: ["src/plugins/punch/call.ts", "src/plugins/punch/server-actions.ts"],
  keep_write: ["src/plugins/keep-write/write.ts"],
};

for (const [tool, allowed] of Object.entries(WRITES))
  test(`"${tool}" is only called from where a click runs it`, () => {
    assert.deepEqual(using(`"${tool}"`), allowed);
  });

test("a todo's actions are run only from a click (or a worker you started)", () => {
  assert.deepEqual(using("runTodoOpsNow("), ["src/lib/ops.ts", "src/plugins/todos/server-actions.ts"]);
  assert.deepEqual(using("runTodoOps("), ["src/lib/ops.ts", "src/lib/work/runner.ts"]);
  assert.deepEqual(using("RUNNERS"), ["src/lib/ops.ts", "src/plugins/actions/run.ts"]);
});

test("the automatic steps don't import what runs actions", () => {
  const automatic = [
    "src/lib/boards/run.ts",
    "src/lib/boards/collect.ts",
    "src/lib/boards/mail-todos.ts",
    "src/lib/boards/mail-relations.ts",
    "src/plugins/auto-actions/review.ts",
    "src/plugins/knowledge/relations.ts",
    "src/lib/sync-scheduler.ts",
    "src/plugins/keep/note-review.ts",
    "src/plugins/keep/note-relations.ts",
    "src/plugins/documents/review.ts",
    "src/plugins/documents/relations.ts",
  ];
  // The action runners: the ops runner, the plugins' run modules (teams/run, whatsapp/run, signal/run …), GitLab's writes —
  // and the clicks themselves (the server actions: Zeff's and each plugin's).
  // (The Ticket-Lage's own run — boards/run — isn't one.)
  const target = String.raw`(@\/lib\/ops|(@\/plugins|\.\.)\/(actions|teams|whatsapp|signal|jira|keep|work|gitlab|gmail|outlook)\/run|@\/lib\/gitlab\/reply|@\/app\/actions|(@\/plugins\/[\w-]+|\.)\/server-actions)`;
  const runners = new RegExp(String.raw`from\s+["']${target}["']|import\(["']${target}["']\)`);
  for (const f of automatic) {
    const s = SRC.find((x) => x.file === f);
    if (!s) continue;
    assert.ok(!runners.test(s.text), `${f} imports a runner`);
  }
});
