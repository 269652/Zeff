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
  jira_add_comment: ["src/lib/jira/context-sync.ts", "src/lib/jira/note-sync.ts", "src/lib/runs/actions.ts", "src/lib/work/runner.ts", "src/plugins/jira/run.ts"],
  jira_transition_issue: ["src/lib/runs/actions.ts", "src/lib/work/runner.ts", "src/plugins/jira/run.ts"],
  // (note-sync.ts: the pictures of your note uploaded as attachments to its ticket, right before its comment — the same "Sync to Jira" click.)
  jira_update_issue: ["src/lib/jira/context-sync.ts", "src/lib/jira/note-sync.ts", "src/lib/runs/actions.ts", "src/lib/work/runner.ts", "src/plugins/jira/run.ts"],
  jira_create_issue_link: ["src/plugins/jira/run.ts"],
  jira_edit_comment: ["src/lib/jira/context-sync.ts", "src/lib/jira/note-sync.ts"],
  jira_create_issue: ["src/plugins/jira/run.ts"],
  // The driver call (call.ts) and the click that exports (server-actions.ts).
  // The Chrono/Punch exports belong to a mounted integration (integrations/booking): nothing of Zeff itself calls them — the integration's own safety test names its callers.
  chrono_export: [],
  punch_export: [],
  // Keep write went with the retired Keep views: nothing calls it anymore.
  keep_write: [],
  // The MCP tools an agent you started uses to answer review comments (they ask for it in their own words: the todo or you).
  // agent-tools.ts only names them in its permission catalog (merge.write, off by default) — it calls nothing.
  mr_reply: ["src/mcp/tools/merge-requests.ts", "src/plugins/workspace/agent-tools.ts"],
  mr_resolve: ["src/mcp/tools/merge-requests.ts", "src/plugins/workspace/agent-tools.ts"],
  mr_comment: ["src/mcp/tools/merge-requests.ts", "src/plugins/workspace/agent-tools.ts"],
};

for (const [tool, allowed] of Object.entries(WRITES))
  test(`"${tool}" is only called from where a click runs it`, () => {
    assert.deepEqual(using(`"${tool}"`), allowed);
  });

test("a todo's actions are run only from a click (or a worker you started)", () => {
  // workspace/actions/pages.ts: runJobDeliveryAction, the job card's "run the delivery" button.
  assert.deepEqual(using("runTodoOpsNow("), ["src/lib/ops.ts", "src/plugins/todos/server-actions.ts", "src/plugins/workspace/actions/pages.ts"]);
  assert.deepEqual(using("runTodoOps("), ["src/lib/ops.ts", "src/lib/work/runner.ts"]);
  assert.deepEqual(using("RUNNERS"), ["src/lib/ops.ts", "src/plugins/actions/run.ts"]);
});

/**
 * Gmail and Google Calendar written through their API (a mail sent or drafted, a conversation archived or marked unread, an event
 * made, moved or answered): only from your clicks — the buttons of a todo's mail or appointment (their server actions), an inbox
 * row's reply (lib/ops runRowOp, with the reply's own mode), the calendar app. Never from an agent's tool (MCP), a worker or the
 * todo's "Run": agents only propose (a todo's action, run on your click).
 */
const GOOGLE_WRITES: Record<string, string[]> = {
  "sendGmail(": ["src/lib/google/gmail-send.ts", "src/plugins/gmail/run.ts"],
  "createGmailDraft(": ["src/lib/google/gmail-send.ts", "src/plugins/gmail/run.ts"],
  "sendGmailDraft(": ["src/lib/google/gmail-send.ts"],
  "archiveGmail(": ["src/plugins/gmail/run.ts"],
  "markGmailUnread(": ["src/plugins/gmail/run.ts"],
  "insertGcalEvent(": ["src/lib/google/calendar-write.ts", "src/plugins/calendar/server-actions.ts", "src/plugins/google-calendar/run.ts"],
  "patchGcalEvent(": ["src/lib/google/calendar-write.ts", "src/plugins/calendar/server-actions.ts"],
  "respondGcalEvent(": ["src/lib/google/calendar-write.ts", "src/plugins/calendar/server-actions.ts"],
  "runGmailCompose(": ["src/lib/ops.ts", "src/plugins/gmail/run.ts"],
  "runGmailComposeOnTodo(": ["src/plugins/gmail/run.ts", "src/plugins/gmail/server-actions.ts"],
  "gmailRowChange(": ["src/plugins/gmail/run.ts", "src/plugins/gmail/server-actions.ts"],
  "runGcalEvent(": ["src/plugins/google-calendar/run.ts"],
  "runGcalEventOnTodo(": ["src/plugins/calendar/server-actions.ts", "src/plugins/google-calendar/run.ts"],
  // (The one door every write to Google goes through — and only these modules knock.)
  "googleWrite": ["src/lib/google/calendar-write.ts", "src/lib/google/gmail-send.ts", "src/lib/google/gmail-write.ts", "src/lib/google/write-guard.ts"],
};

for (const [fn, allowed] of Object.entries(GOOGLE_WRITES))
  test(`Google write "${fn.replace(/\($/, "")}" is only called from where a click runs it`, () => {
    assert.deepEqual(using(fn), allowed);
  });

test("no agent tool (MCP), worker or todo's Run can send a mail or write an event — they only propose", () => {
  const writers = /@\/lib\/google\/(gmail-send|calendar-write|write-guard)["']|(gmail|google-calendar)\/run["']/;
  const agents = SRC.filter((x) => /^src\/mcp\/|\/mcp\.ts$|^src\/lib\/work\/|^src\/plugins\/auto-actions\/|^src\/plugins\/actions\/(run|zeff-run|server)\.ts$/.test(x.file));
  assert.ok(agents.length > 5);
  for (const f of agents) assert.ok(!writers.test(f.text), `${f.file} imports what writes to Google`);
  // The todo's "Run" (and a worker's runTodoOps) has no runner for them: those stay Gmail's / Google's window, opened by you.
  const runners = SRC.find((x) => x.file === "src/plugins/actions/run.ts")!.text;
  assert.ok(!/"gmail-compose"|"gcal-event"/.test(runners), "gmail-compose / gcal-event in RUNNERS");
});

test("the automatic steps don't import what runs actions", () => {
  const automatic = [
    "src/lib/runs/run.ts",
    "src/lib/runs/collect.ts",
    "src/lib/todos/mail-todos.ts",
    "src/lib/todos/mail-relations.ts",
    "src/plugins/auto-actions/review.ts",
    "src/plugins/knowledge/relations.ts",
    "src/lib/sync-scheduler.ts",
    "src/plugins/keep/note-review.ts",
    "src/plugins/keep/note-relations.ts",
    "src/plugins/documents/review.ts",
    "src/plugins/documents/relations.ts",
    "src/plugins/workspace/pipeline.ts",
    "src/plugins/workspace/row-actions.ts",
  ];
  // The action runners: the ops runner, the plugins' run modules (teams/run, whatsapp/run, signal/run …), GitLab's writes —
  // and the clicks themselves (the server actions: Zeff's and each plugin's).
  // (The Ticket-Lage's own run — runs/run — isn't one.)
  const target = String.raw`(@\/lib\/ops|(@\/plugins|\.\.)\/(actions|teams|whatsapp|signal|jira|keep|work|gitlab|gmail|outlook)\/run|@\/lib\/gitlab\/reply|@\/app\/actions|(@\/plugins\/[\w-]+|\.)\/server-actions)`;
  const runners = new RegExp(String.raw`from\s+["']${target}["']|import\(["']${target}["']\)`);
  for (const f of automatic) {
    const s = SRC.find((x) => x.file === f);
    if (!s) continue;
    assert.ok(!runners.test(s.text), `${f} imports a runner`);
  }
});
