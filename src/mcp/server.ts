import { guardTools } from "@/mcp/tool-guard";
import { registerReportTool } from "@/plugins/workspace/mcp-report";
import { registerGmailTools } from "@/plugins/gmail/mcp";
import { registerMailboxTools } from "@/plugins/imap-mail/mcp";
import { registerWorkspaceTools } from "@/plugins/workspace/mcp";
import { registerWebSearchTools } from "@/plugins/web-search/mcp";
import { registerBrowserTools } from "@/plugins/browser/mcp";
import { registerAiQualityTool } from "@/lib/learning/mcp";
import { registerCorrelationTools } from "@/plugins/correlations/mcp";
import { registerEntityTools } from "@/plugins/entities/mcp";
import { registerJiraPickTools } from "@/plugins/jira-lage/mcp";
import { registerQuestionTools } from "@/plugins/questions/mcp";
import { registerTimelineTools } from "@/plugins/timeline/mcp";
import { registerKnowTools } from "@/plugins/know/mcp";
import { registerLoopTools } from "@/plugins/loops/mcp";
import { registerLearnTools } from "@/plugins/learn/mcp";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerReportTimeTool, registerBookingTools } from "./tools/time";
import { registerKnowledgeTools, registerAddKnowledgeTool } from "./tools/knowledge";
import { registerMergeRequestTools } from "./tools/merge-requests";
import { registerTodoTools } from "./tools/todos";
import { registerTodoClockTools } from "./tools/todo-clock";
import { registerTodoFinishTools } from "./tools/todo-finish";
import { run, ok, fail } from "./tools/kit";

export const SERVER_INFO = { name: "zeff", version: "0.1.0" };

export const INSTRUCTIONS = `Zeff is a time-tracking (Zeiterfassung) server. Time is booked in hours against job numbers.

ONLY MEASURED TIME IS BOOKED. You never state minutes or hours yourself — no estimates, no "planning took 45 minutes", no rounding up, no time from before the clock started. Time exists only where a clock measured it (start_todo / todo_clock_start … todo_clock_stop / finish_todo) — or where your own log of it shows it: times you READ, never guessed (see "YOUR OWN LOG" below). Work with neither has no time — say so in your summary instead of guessing it. Forgot to start the clock? Your log still counts: give it to todo_time, report_time or finish_todo (log: { from, to } read from your session's message times, or log.steps) — Zeff computes the minutes from it (never before the todo's last record). The tools take no minutes or hours from you; corrections (todo_time_update, update_time_entry) can only LOWER a time.

YOUR OWN LOG — when you can't ping reliably: when you start on a todo, READ the time (run: date -u +%FT%TZ — or: node -e "console.log(new Date().toISOString())") and keep it; when you stop, read it again. Give both to todo_clock_stop / finish_todo / todo_time as log: { from, to } — or, better, log: { steps: [...] } with the times of your steps from your session. Zeff computes the minutes from them itself (to − from; steps: gaps over 10 minutes left out) and takes the more of that and what the clock measured. Never type a time you didn't read. A clock that went quiet is never stopped silently: todo_clock_stop / finish_todo / todo_time then answer with its start and its last sign of life and ask for your log — call again with log: { from: <that start>, to: <now, read> }, or log: { idle: true } if you really weren't working on it after the last sign of life.

Record the time you work — measured, with ONE simple line. You never book directly: what you report becomes a SUGGESTION (S-<id>), a shadow row in the user's Weekly report that they take over (or skip). Its evidence is attached automatically: the todos you name, your runs on them (their logs, durations, reports) and what the todos came from.
When you finish or pause work on a ticket:
1. Pick the job with list_jobs (jobs are the booking target; the ticket is just a reference stored on the entry) — or leave it out when the ticket has a job already (Zeff uses it).
2. Call report_time with a concise one-line description, the ticket key, your name as reportedBy and the todos the work was on (todos: ['T-12']) — the hours are the time MEASURED on those todos by their clocks (you don't give any).
   Work that belongs to a project (see list_projects) can be suggested with project instead of jobNumber — the project's job is used.
3. Report each piece of work once. Fix your suggestion with update_time_entry / delete_time_entry (S-<id>, while it's still open) — don't re-report.

Descriptions are ONE short line (aim for <80 chars): what was done, not how. No commit logs, file/function lists, MR or commit numbers, test counts or multi-clause summaries. Good: "Hängender Einzug für mehrzeilige Footer-Links". Don't repeat the ticket key — the report prepends it. Put #tags in the description to tag the entry.

Use get_weekly_report to review a week.

Todos: Zeff's Todos tab reads the user's Jira tickets and finds concrete todos on them (T-<id>). Before working on a ticket, list_todos with its key shows what's open.

ALWAYS LOOK FOR A TODO FIRST: before you start ANY piece of work for the user — a change, a fix, research, a review, writing a reply — check whether Zeff has a todo for it (list_todos with the ticket key, or search_context with a few words of the task). If there is one, its time MUST be measured — no exceptions:
- todo_clock_start (todo, your name as agent) BEFORE you begin — reading and looking around already count;
- todo_clock_stop (todo, a one-line note, agent) when you stop working on it — done for now, switching to other work, a break — and todo_clock_start again when you come back;
- PING IT AT LEAST EVERY 10 MINUTES while you work on it: todo_clock_ping (todo, agent) — or todo_progress / todo_time, which count as a ping too. A clock that hears nothing for 10 minutes is PAUSED as of your last ping: the time after it is lost (not booked) until your next ping — unless you hand in YOUR OWN LOG when you stop. So ping between steps — before and after a long command (a test suite, a build), after each file you change, whenever you read the next thing; when in doubt, ping;
- todo_time WITHOUT minutes after each phase (research, implementation, tests …) records the time so far (a lap) and the clock runs on;
- todo_needs_input before you ask the user pauses the clock (waiting doesn't count); todo_progress when you go on restarts it;
- finish_todo stops it and takes the measured time.
Zeff takes the difference between start and stop as the time record — measured, never guessed. One clock per agent: starting on another todo stops the running one (its time recorded). Work that no todo stands for: make one first (add_todo), then start_todo on it — so its time is measured too. When the user books, the time of all related todos (same ticket, follow-ups, the todos a session touched) flows into ONE booking suggestion, with each record linked as evidence — so the records are how your time is tracked. Don't report the same stretch twice, and don't also add it up in report_time. A record that came out too long (the clock ran while you weren't working on it), twice or on the wrong todo — lower it with todo_time_update (TT-<id>: minutes or hours, note) or remove it with todo_time_delete, while it isn't booked or suggested yet. Never raise a record.

Working on a todo (you're an agent — VS Code Copilot, Claude Code, …):
1. Call start_todo with the todo and your name as agent IMMEDIATELY — as your very first step, before you read code, research, plan or ask anything. Research and looking around already count as working on it. Zeff then shows the todo as being worked on and you as a worker on its Code tab — and its clock starts (no todo_clock_start needed after it).
2. Code changes go on a FEATURE BRANCH, never on main: start_todo tells you the repo and the branch — the ticket's EXISTING feature branch if it has one (continue on it), otherwise a new one: feature/<TICKET>-<short-change> (fix/… for bugs), where <TICKET> is the key of the Jira ticket the todo belongs to (e.g. PROJ-364) and <short-change> is 2–4 lowercase words (max ~30 characters) describing the code change you actually make (feature/PROJ-364-footer-link-indent) — NOT the ticket's or todo's title, which isn't necessarily the change. The ticket key must always be the prefix; never a name without it. You create it from the default branch in a separate worktree (git worktree add -b <branch> <folder> origin/main after a fetch). Commit there. Don't push to main and don't merge — Zeff does the delivery from your branch.
   Implement with STRICT TDD: first a test that fails for the right reason, then the smallest change that makes it pass, then tidy up — and run the affected suite at the end. What can only be checked by hand, name as open in your summary.
   Then call todo_context for everything Zeff knows about it (the ticket, comments, the Teams messages and mails it comes from, the user's notes, earlier runs) — read it before you start. If it lists attachments (pictures the user pasted into their notes: screenshots, mock-ups, error screens — and documents), LOOK at them with todo_attachment before you implement: a picture often shows exactly what is meant.
   Optionally call todo_progress with a short note now and then (what you're doing) — it's your log there.
   Your time is measured by the clock start_todo started: todo_clock_ping at least every 10 minutes (else it pauses as of your last ping); todo_time without minutes after each phase (a lap); todo_needs_input pauses it while you wait; todo_clock_stop when you leave the todo for other work, todo_clock_start when you come back (see "ALWAYS LOOK FOR A TODO FIRST" above).
   Whenever you stop to ask the user something (a question, a decision, a confirmation, a review) — call todo_needs_input with the question FIRST, then ask. The todo then shows ❗ on Zeff's Todos and Code tabs so the user sees you're waiting. Once you have the answer and go on, call todo_progress (that clears the ❗) — finish_todo clears it too.
3. When you're done — or stop — call finish_todo with: summary (it's shown on the todo as your comment — so ALWAYS a summary of what you did: first ONE sentence saying what is done now, then short bullets: what you changed, how you tested, what's still open and why, where it is — branch and commit), entry (ONE short line for the booking, same rules as report_time descriptions), outcome (done / partial / blocked), branch (the feature branch you committed on — and repo, its folder, if Zeff doesn't know the ticket's repo) and followUps for what's left (replies, comments, ticket changes — with ready drafts).
   With a branch, Zeff creates a todo for the user to TEST AND VERIFY your work by hand first; once they've ticked it off, the delivery follows (push → merge request to main, or merge straight into main — one click each). Don't create test or delivery todos yourself, and say in your summary what the user should test.
   finish_todo stops the clock and records its measured time since the last lap as one more time record on the todo (the entry line as its note) and suggests the booking itself — all the todo's records not suggested yet add up in it, with the todo and your run as evidence — so give a good one-line entry, and do NOT also call report_time for that work (it would be suggested twice). No clock ran: no time is recorded — don't make one up.
Merge request review comments: mr_comments reads what the reviewers wrote on a merge request (with the note:<id> of each); after you dealt with a thread answer it with mr_reply (once per thread, short: what you changed and where) and, when it's settled, mr_resolve. mr_comment adds a comment outside any thread. They post in GitLab under the user's name — only for comments the todo or the user asks you to answer.
Use report_time (with todos: ['T-12'] — they're reported done with it) to suggest the booking of time measured on todos when you don't finish them with finish_todo, and complete_todo to report a todo done that nobody needs to book time for. Reporting a todo done marks it (highlighted in Zeff) — it stays open; the user closes it.`;

export function registerZeffTools(server: McpServer): void {
  // (the worker of an agent routine gets only the tools its permissions allow)
  guardTools(server);
  registerReportTimeTool(server);
  registerKnowledgeTools(server);
  registerMergeRequestTools(server);
  registerAddKnowledgeTool(server);
  registerTodoTools(server);
  registerTodoClockTools(server);
  registerTodoFinishTools(server);
  registerBookingTools(server);

  // The Workspace's pages and databases (when that plugin is installed, the tools say so otherwise).
  registerWorkspaceTools(server, { run, ok, fail });
  registerWebSearchTools(server, { run, ok, fail } as never);
  registerBrowserTools(server, { run, ok, fail } as never);
  registerEntityTools(server, { run, ok, fail } as never);
  // Which tickets of the mirrored Jira boards come next for you (read-only).
  registerJiraPickTools(server, { run, ok, fail } as never);
  registerQuestionTools(server, { run, ok, fail } as never);
  registerGmailTools(server, { run, ok, fail } as never);
  // The mailboxes (IMAP / POP3): their inboxes read, archived.
  registerMailboxTools(server, { run, ok, fail } as never);
  registerReportTool(server, { run, ok, fail } as never);
  // How useful each AI step is, from the user's decisions (read-only).
  registerAiQualityTool(server, { run, ok, fail } as never);
  registerCorrelationTools(server, { run, ok, fail } as never);
  // What happened with someone or something, and what changed since (the Timeline plugin).
  registerTimelineTools(server, { run, ok, fail } as never);
  // What you should know before a meeting, and about anyone or anything (the know plugin).
  registerKnowTools(server, { run, ok, fail } as never);
  // What is owed, by whom: promises, unanswered questions, requests (the Open loops plugin).
  registerLoopTools(server, { run, ok, fail } as never);
  registerLearnTools(server, { run, ok, fail } as never);
}
