import { isInstalled } from "@/plugins/state";
import { guardTools } from "@/mcp/tool-guard";
import { registerReportTool } from "@/plugins/workspace/mcp-report";
import { registerGmailTools } from "@/plugins/gmail/mcp";
import { registerWorkspaceTools } from "@/plugins/workspace/mcp";
import { registerWebSearchTools } from "@/plugins/web-search/mcp";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError, errorMessage } from "@/lib/errors";
import {
  getJobNumberForTicket,
  getWeeklyReport,
  listEntries,
  type EntryWithJob,
  type WeeklyReport,
} from "@/lib/entries";
import { attributed } from "@/lib/boards/activity";
import { addAgentTodo, getTodo, listTodos, markWorkerDone, setTodoStatus, tickAgentTodo } from "@/lib/boards/store";
import { parseTodoRef, todoRef } from "@/lib/boards/shared";
import { formatHours } from "@/lib/format";
import { getTicketDefaultJob } from "@/lib/jira/store";
import { createJob, listJobs } from "@/lib/jobs";
import { listProjects, requireProjectByTitle } from "@/lib/projects";
import { NO_JOB_NUMBER } from "@/lib/projects-shared";
import { formatDay, formatWeekRange, resolveWeek, todayIso } from "@/lib/week";

export const SERVER_INFO = { name: "zeff", version: "0.1.0" };

export const INSTRUCTIONS = `Zeff is a time-tracking (Zeiterfassung) server. Time is booked in hours against job numbers.

Record the time you work — accurately, with ONE simple line. You never book directly: what you report becomes a SUGGESTION (S-<id>), a shadow row in the user's Weekly report that they take over (or skip). Its evidence is attached automatically: the todos you name, your runs on them (their logs, durations, reports) and what the todos came from.
When you finish or pause work on a ticket:
1. Pick the job with list_jobs (jobs are the booking target; the ticket is just a reference stored on the entry) — or leave it out when the ticket has a job already (Zeff uses it).
2. Call report_time with hours (decimal, e.g. 1.5 — the time actually spent, honestly; no padding, no rounding to whole hours), a concise one-line description, the ticket key, your name as reportedBy and the todos the work was on (todos: ['T-12']).
   Work that belongs to a project (see list_projects) can be suggested with project instead of jobNumber — the project's job is used.
3. Report each piece of work once. Fix your suggestion with update_time_entry / delete_time_entry (S-<id>, while it's still open) — don't re-report.

Descriptions are ONE short line (aim for <80 chars): what was done, not how. No commit logs, file/function lists, MR or commit numbers, test counts or multi-clause summaries. Good: "Hängender Einzug für mehrzeilige Footer-Links". Don't repeat the ticket key — the report prepends it. Put #tags in the description to tag the entry.

Use get_weekly_report to review a week.

Todos: Zeff's Todos tab reads the user's Jira tickets and finds concrete todos on them (T-<id>). Before working on a ticket, list_todos with its key shows what's open.

Time on a todo: REPORT IT AS YOU GO. A todo has many time records — call todo_time (todo, minutes, a one-line note, your name as agent) after each phase of the work (research, implementation, tests …), before you ask the user something and whenever you pause or stop: the minutes spent since your LAST record, honestly (waiting for the user doesn't count; no padding, no rounding up). Several calls per todo are expected and wanted. When the user books, the time of all related todos (same ticket, follow-ups, the todos a session touched) flows into ONE booking suggestion, with each record linked as evidence — so the records are how your time is tracked. Don't report the same stretch twice, and don't also add it up in report_time.

Working on a todo (you're an agent — VS Code Copilot, Claude Code, …):
1. Call start_todo with the todo and your name as agent IMMEDIATELY — as your very first step, before you read code, research, plan or ask anything. Research and looking around already count as working on it. Zeff then shows the todo as being worked on and you as a worker on its Code tab.
2. Code changes go on a FEATURE BRANCH, never on main: start_todo tells you the repo and the branch — the ticket's EXISTING feature branch if it has one (continue on it), otherwise a new one: feature/<TICKET>-<short-change> (fix/… for bugs), where <TICKET> is the key of the Jira ticket the todo belongs to (e.g. PROJ-364) and <short-change> is 2–4 lowercase words (max ~30 characters) describing the code change you actually make (feature/PROJ-364-footer-link-indent) — NOT the ticket's or todo's title, which isn't necessarily the change. The ticket key must always be the prefix; never a name without it. You create it from the default branch in a separate worktree (git worktree add -b <branch> <folder> origin/main after a fetch). Commit there. Don't push to main and don't merge — Zeff does the delivery from your branch.
   Implement with STRICT TDD: first a test that fails for the right reason, then the smallest change that makes it pass, then tidy up — and run the affected suite at the end. What can only be checked by hand, name as open in your summary.
   Then call todo_context for everything Zeff knows about it (the ticket, comments, the Teams messages and mails it comes from, the user's notes, earlier runs) — read it before you start. If it lists attachments (pictures the user pasted into their notes: screenshots, mock-ups, error screens — and documents), LOOK at them with todo_attachment before you implement: a picture often shows exactly what is meant.
   Optionally call todo_progress with a short note now and then (what you're doing) — it's your log there.
   Report your time with todo_time after each phase and before you ask the user (see "Time on a todo" above).
   Whenever you stop to ask the user something (a question, a decision, a confirmation, a review) — call todo_needs_input with the question FIRST, then ask. The todo then shows ❗ on Zeff's Todos and Code tabs so the user sees you're waiting. Once you have the answer and go on, call todo_progress (that clears the ❗) — finish_todo clears it too.
3. When you're done — or stop — call finish_todo with: summary (it's shown on the todo as your comment — so ALWAYS a summary of what you did: first ONE sentence saying what is done now, then short bullets: what you changed, how you tested, what's still open and why, where it is — branch and commit), entry (ONE short line for the booking, same rules as report_time descriptions), minutes (the time since your LAST todo_time record — all of it, if you reported none —, honestly), outcome (done / partial / blocked), branch (the feature branch you committed on — and repo, its folder, if Zeff doesn't know the ticket's repo) and followUps for what's left (replies, comments, ticket changes — with ready drafts).
   With a branch, Zeff creates a todo for the user to TEST AND VERIFY your work by hand first; once they've ticked it off, the delivery follows (push → merge request to main, or merge straight into main — one click each). Don't create test or delivery todos yourself, and say in your summary what the user should test.
   finish_todo records those last minutes as one more time record on the todo (the entry line as its note) and suggests the booking itself — all the todo's records not suggested yet add up in it, with the todo and your run as evidence — so give honest minutes and a good one-line entry, and do NOT also call report_time for that work (it would be suggested twice).
Merge request review comments: mr_comments reads what the reviewers wrote on a merge request (with the note:<id> of each); after you dealt with a thread answer it with mr_reply (once per thread, short: what you changed and where) and, when it's settled, mr_resolve. mr_comment adds a comment outside any thread. They post in GitLab under the user's name — only for comments the todo or the user asks you to answer.
Use report_time (with todos: ['T-12'] — they're reported done with it) for work you did without start_todo / finish_todo (and without todo_time records), and complete_todo to report a todo done that nobody needs to book time for. Reporting a todo done marks it (highlighted in Zeff) — it stays open; the user closes it.`;

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** What a tool answers: text, and pictures (todo_attachment). */
type ToolResult = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };

/** Run a tool body and turn thrown errors into MCP error results the agent can read. */
async function run(fn: () => Promise<ToolResult> | ToolResult) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ConflictError || err instanceof ValidationError) {
      console.warn(`[zeff-mcp] ${err.name}: ${err.message}`);
    } else {
      console.error("[zeff-mcp]", err);
    }
    return fail(`Error: ${errorMessage(err)}`);
  }
}

function describeEntry(e: EntryWithJob): string {
  const parts = [
    `#${e.id}`,
    e.date,
    `${formatHours(e.hours)}h`,
    e.type,
    `${e.job.number} (${e.job.name})`,
    `"${e.description}"`,
  ];
  if (e.project) parts.splice(5, 0, `project "${e.project.title}"`);
  if (e.ticket) parts.push(`ticket ${e.ticket}`);
  if (e.tags.length) parts.push(`tags ${e.tags.map((t) => `#${t.name}`).join(" ")}`);
  parts.push(`by ${e.reportedBy}`);
  return parts.join(" · ");
}

function renderWeeklyReport(report: WeeklyReport): string {
  const { week } = report;
  const lines: string[] = [];
  lines.push(`# Zeff weekly report — ${week.key} (${formatWeekRange(week)})`);
  if (report.filter.reportedBy) {
    lines.push(`Filtered to entries reported by "${report.filter.reportedBy}".`);
  }
  lines.push("");

  if (report.rows.length === 0) {
    lines.push("_No time booked in this week._");
    return lines.join("\n");
  }

  const dayHeaders = week.days.map((d) => formatDay(d, "EEE d"));
  const cell = (h: number) => (h ? formatHours(h) : "");
  lines.push(`| Job | ${dayHeaders.join(" | ")} | Total |`);
  lines.push(`|---|${dayHeaders.map(() => "---:").join("|")}|---:|`);
  for (const row of report.rows) {
    const label = row.project
      ? `${row.project.title} (project, ${row.job.number === NO_JOB_NUMBER ? "no job yet" : row.job.number})`
      : `${row.job.number} ${row.job.name}`;
    lines.push(
      `| ${label} | ${row.hoursByDay.map(cell).join(" | ")} | **${formatHours(row.total)}** |`,
    );
  }
  lines.push(
    `| **Total** | ${report.dayTotals.map(cell).join(" | ")} | **${formatHours(report.total)}** |`,
  );
  lines.push("");
  lines.push(`## Entries (${report.entries.length})`);
  for (const e of report.entries) lines.push(`- ${describeEntry(e)}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** A tool of a plugin that isn't installed: says so (else null). */
function pluginOff(id: "todos" | "work") {
  if (isInstalled(id)) return null;
  return fail(`${id === "work" ? "Code" : "Todos"} is not installed in Zeff (Menu → Plugins) — this tool isn't available.`);
}

export function registerZeffTools(server: McpServer): void {
  // (the worker of an agent routine gets only the tools its permissions allow)
  guardTools(server);
  server.registerTool(
    "report_time",
    {
      title: "Report time",
      description:
        "Suggest a booking of hours (one entry) with ONE concise line of what was done — it becomes a suggestion (S-<id>), " +
        "a shadow row the user takes over in Zeff; nothing is booked directly. Name the todos the work was on: their runs, " +
        "logs and sources become its evidence. jobNumber is optional if the ticket has a job (its board's, or the last booked); " +
        "otherwise see list_jobs. #tags in the description become the entry's tags.",
      inputSchema: z.object({
        jobNumber: z
          .string()
          .optional()
          .describe("Job number to book on (see list_jobs). Optional if the ticket was booked before."),
        project: z
          .string()
          .optional()
          .describe("Project title to book on instead of a job (see list_projects); the project's job is used."),
        hours: z
          .number()
          .positive()
          .max(24)
          .describe("Hours spent as a decimal, e.g. 0.25, 0.5, 1.5, 3."),
        description: z
          .string()
          .min(1)
          .describe(
            "What was done, as ONE short line (<80 chars); no commit logs, file lists or MR/commit numbers. " +
              "Don't repeat the ticket key. May contain #tags.",
          ),
        date: z
          .string()
          .optional()
          .describe("Date of the work as YYYY-MM-DD. Defaults to today."),
        ticket: z
          .string()
          .optional()
          .describe("Ticket / issue key the work belongs to, e.g. 'PROJ-337'."),
        type: z
          .string()
          .optional()
          .describe(
            "Kind of work, an entry type key: ticket, meeting, internal, training, other, absence — or one the user added in Zeff. " +
              "When omitted, the user's type rules decide (e.g. an absence job → 'absence'), else 'ticket' when a ticket is given, else 'other'.",
          ),
        tags: z.array(z.string()).optional().describe("Tag names to attach."),
        reportedBy: z
          .string()
          .optional()
          .describe("Name of the agent or person reporting, e.g. 'Claude Code'. Defaults to 'agent'."),
        todos: z
          .array(z.string())
          .optional()
          .describe("Board todos this work was on and finished, e.g. ['T-12'] (see list_todos) — the suggestion's evidence; they're reported done with it (highlighted, the user closes them)."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      run(async () => {
        // A project books on its own job; otherwise the given job, else the ticket's last one.
        const projectId = args.project ? requireProjectByTitle(args.project).id : undefined;
        const jobNumber =
          projectId !== undefined
            ? undefined
            : (args.jobNumber ??
              (args.ticket ? (getTicketDefaultJob(args.ticket) ?? getJobNumberForTicket(args.ticket)) : undefined));
        if (!jobNumber && projectId === undefined) {
          return fail(
            args.ticket
              ? `No job given and ticket "${args.ticket}" has no job yet. Pass jobNumber (see list_jobs) or project (see list_projects).`
              : "No jobNumber given. Pass jobNumber (see list_jobs) or project (see list_projects).",
          );
        }
        const known: number[] = [];
        const unknown: string[] = [];
        for (const ref of args.todos ?? []) {
          const id = parseTodoRef(ref);
          if (id === null || !getTodo(id)) unknown.push(ref);
          else known.push(id);
        }
        // Time already reported on these todos (todo_time): attached as evidence, not added to the hours — the agent is told.
        const { listTodoTimes } = await import("@/lib/work/todo-time");
        const { formatMinutes } = await import("@/lib/work/shared");
        const taken = (await import("@/lib/work/suggestions")).suggestedEvidence().timeIds;
        const reported = listTodoTimes(known, { open: true }).filter((r) => !taken.has(r.id));
        // A suggestion, not a booking: the user takes it over in Zeff (with its evidence).
        const { suggestEntry } = await import("@/lib/work/suggestions");
        const s = suggestEntry({
          jobNumber: projectId === undefined ? jobNumber : null,
          projectId: projectId ?? null,
          hours: args.hours,
          description: args.description,
          date: args.date ?? todayIso(),
          ticket: args.ticket,
          type: args.type,
          tags: args.tags,
          reportedBy: args.reportedBy ?? "agent",
          todoIds: known,
        });
        // The todos this work finished: reported done (highlighted, still open — the user closes them), with the suggestion as the reason.
        const closed: string[] = [];
        for (const id of known) {
          const t = getTodo(id);
          if (t?.status !== "open") continue;
          attributed(`agent:${s.reportedBy || "MCP"}`, () => markWorkerDone(id, s.reportedBy || "MCP", `Entry suggested ${s.ref} (${s.date}, ${formatHours(s.hours)} h): ${s.description}`));
          closed.push(todoRef(id));
        }
        return ok(
          `Suggested ${s.ref}: ${formatHours(s.hours)}h` +
            (s.project ? ` on project "${s.project.title}"` : s.job ? ` on job ${s.job.number} (${s.job.name})` : "") +
            ` for ${s.date}` +
            (s.ticket ? `, ticket ${s.ticket}` : "") +
            ` — "${s.description}". Not booked: the user takes it over in Zeff.` +
            (s.todos.length || s.runs.length ? ` Evidence: ${[...s.todos.map((t) => t.ref), ...s.runs.map((r) => r.ref)].join(", ")}.` : "") +
            (closed.length ? ` Reported done (still open for you to close): ${closed.join(", ")}.` : "") +
            (reported.length ? ` Note: ${formatMinutes(reported.reduce((a, r) => a + r.minutes, 0))} was already reported on ${[...new Set(reported.map((r) => r.todo))].join(", ")} with todo_time (${reported.length} record(s)) — attached as evidence; your ${formatHours(s.hours)}h stand for the booking, so make sure it doesn't count that time twice (update_time_entry ${s.ref}).` : "") +
            (unknown.length ? ` Unknown todos (not linked): ${unknown.join(", ")}.` : ""),
        );
      }),
  );

  server.registerTool(
    "search_knowledge",
    {
      title: "Search the project knowledge (Confluence)",
      description:
        "The project's documentation (Confluence), compiled into a knowledge base: pages (title, space, link, the passage found, a summary) " +
        "and entities (systems, components, people, terms) with their relations. Search it before guessing how something works, " +
        "who is responsible or which environment does what. German and English words both find it.",
      inputSchema: z.object({
        query: z.string().describe("What to look for — words, a ticket key, a system name."),
        limit: z.number().int().min(1).max(15).optional().describe("Pages, default 6."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        if (!isInstalled("knowledge")) return fail("Knowledge is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { knowledgeSearch } = await import("@/plugins/knowledge/client");
        const r = await knowledgeSearch(args.query, args.limit ?? 6);
        if (!r.pages.length && !r.entities.length) return ok(`Nothing in the knowledge base for "${args.query}".`);
        const plain = (t: string) => t.replace(/[⟦⟧]/g, "").replace(/\s+/g, " ").trim();
        const pages = r.pages.map((p) => `- ${p.title} (${p.space})${p.url ? ` ${p.url}` : ""}${p.summary ? `\n  summary: ${plain(p.summary)}` : ""}\n  found: ${plain(p.snippet)}`);
        const entities = r.entities.map((e) => `- ${e.name} (${e.type}): ${e.summary}${e.related.length ? `\n  ${e.related.map((x) => (x.dir === "out" ? `→ ${x.rel} ${x.name}` : `← ${x.name} ${x.rel}`)).join("; ")}` : ""}`);
        return ok([pages.length ? `Pages:\n${pages.join("\n")}` : "", entities.length ? `Entities:\n${entities.join("\n")}` : ""].filter(Boolean).join("\n\n"));
      }),
  );

  server.registerTool(
    "zeff_actions",
    {
      title: "What Zeff can be told to do — and what is set now",
      description:
        "The things plugins let Zeff do on a click (change the instructions of an AI step such as the branch naming, add a Kanban card …): each with its method, its fields, and — for the text you pass — what exists NOW " +
        "(the current instructions, the boards, what the knowledge base says). Read it before you write an instruction, a rule or a card, so what you write adjusts what is there instead of contradicting or doubling it.",
      inputSchema: z.object({
        query: z.string().optional().describe("What it is about, in words — a rule, a topic, a ticket key. The current state for it is read."),
        ticket: z.string().optional().describe("The ticket it is about, e.g. PROJ-306."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const { offeredMethods, offerContext } = await import("@/plugins/actions/server");
        const methods = Object.entries(offeredMethods());
        if (!methods.length) return ok("Nothing is offered.");
        const known = await offerContext({ ticket: args.ticket ?? "", text: args.query ?? "" });
        return ok(
          [
            ...methods.map(([name, m]) => `- ${name} — ${m.offer.label}\n  fields: ${Object.entries(m.offer.fields).map(([k, d]) => `${k} (${d})`).join("; ")}`),
            known.length ? `\nWhat exists now:\n${known.join("\n")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }),
  );

  server.registerTool(
    "search_context",
    {
      title: "Search everything Zeff keeps",
      description:
        "Missing context? Look through everything Zeff has: the knowledge base (Confluence, notes), mails, Teams messages, GitLab comments and merge requests, Jira tickets and their comments, the user's context notes and facts, and todos. " +
        "Hits come with a reference ([mail:…], [teams:…], [jira-comment:…], T-12 …) and the passage found. Use it before guessing who decided what, what a question was about or how something works — " +
        "and before asking the user. German and English words both work; 2–5 specific words find more than a sentence.",
      inputSchema: z.object({
        query: z.string().min(2).describe("What to look for — words that stand in the texts: names, systems, ticket keys."),
        where: z.array(z.enum(["knowledge", "mails", "teams", "gitlab", "jira", "notes", "facts", "todos", "documents", "pages"])).optional().describe("Only look in these sources (default: all)."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const { retrieve } = await import("@/lib/rag");
        const r = await retrieve([{ query: args.query, where: args.where }], { perSource: 4, maxChars: 9000 });
        return ok(r.hits.length ? r.text : `Nothing found for "${args.query}"${args.where?.length ? ` in ${args.where.join(", ")}` : ""} — try other words, or ask the user.`);
      }),
  );

  // GitLab merge request comments: read what the reviewers wrote, answer in a thread (through Zeff's automation Chrome, as the user).
  server.registerTool(
    "mr_comments",
    {
      title: "Read merge request comments",
      description:
        "The review comments on a merge request as Zeff has synced them: who wrote what, in which thread, whether the thread is resolved, with the key (note:<id>) to answer it with mr_reply. " +
        "mr: the merge request's link, a comment's link (…#note_123), '!179', or words from its title. Read them before you change code a reviewer asked about — and answer each thread you dealt with.",
      inputSchema: z.object({
        mr: z.string().min(1).describe("A merge request or comment link, '!179', or words."),
        unresolvedOnly: z.boolean().optional().describe("Only comments in threads that aren't resolved (default: all)."),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        if (!isInstalled("gitlab")) return fail("GitLab is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { listGitlabItems } = await import("@/lib/gitlab/store");
        const { gitlabDone } = await import("@/lib/gitlab/shared");
        const items = listGitlabItems({ q: args.mr, kind: "comment", limit: 200 }).filter((i) => !args.unresolvedOnly || !gitlabDone(i));
        if (!items.length) return ok(`No synced comments for "${args.mr}" — the GitLab sync may not have read that merge request yet.`);
        const list = items.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "")).slice(-(args.limit ?? 40));
        return ok(
          list
            .map((i) => `[${i.key}] ${i.ref} ${i.title.slice(0, 80)} · ${i.author ?? "?"} · ${(i.createdAt ?? "").slice(0, 16)} · thread ${i.thread ?? "-"} · ${gitlabDone(i) ? "resolved" : "open"}\n${i.body.trim()}\n${i.url}`)
            .join("\n\n"),
        );
      }),
  );

  server.registerTool(
    "mr_reply",
    {
      title: "Answer a merge request comment",
      description:
        "Post a reply in the thread of a merge request comment (note:<id> from mr_comments, or its link) — it goes out in GitLab under the user's name, through Zeff's automation Chrome. " +
        "Reply once per thread, short and concrete: what you changed (and where — branch, commit) or the answer. Only for comments the todo or the user asks you to answer.",
      inputSchema: z.object({
        note: z.string().min(1).describe("note:<id> or the comment's link."),
        body: z.string().min(1).max(8000).describe("The reply, as Markdown."),
      }),
    },
    async (args) =>
      run(async () => {
        if (!isInstalled("gitlab")) return fail("GitLab is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { gitlabItemsByKeys } = await import("@/lib/gitlab/store");
        const { gitlabLinkKey } = await import("@/lib/gitlab/shared");
        const key = args.note.startsWith("note:") ? args.note : (gitlabLinkKey(args.note) ?? args.note);
        const item = gitlabItemsByKeys([key]).get(key);
        if (!item || item.kind !== "comment") return fail(`The comment ${args.note} isn't among the synced ones — use a key from mr_comments.`);
        const { postGitlabReply } = await import("@/lib/gitlab/reply");
        const r = await postGitlabReply(item.url, args.body);
        return ok(`Reply posted in ${item.ref} (${r.via === "api" ? "API" : "through the page"}): ${r.url}`);
      }),
  );

  server.registerTool(
    "mr_resolve",
    {
      title: "Resolve a merge request thread",
      description: "Resolve (or reopen) the thread of a merge request comment in GitLab. Resolve only what you dealt with and answered — the reviewer may want to see the answer first.",
      inputSchema: z.object({
        note: z.string().min(1).describe("note:<id> or the comment's link."),
        resolved: z.boolean().optional().describe("false reopens it (default: true)."),
      }),
    },
    async (args) =>
      run(async () => {
        if (!isInstalled("gitlab")) return fail("GitLab is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { gitlabItemsByKeys, setGitlabState } = await import("@/lib/gitlab/store");
        const { gitlabLinkKey } = await import("@/lib/gitlab/shared");
        const key = args.note.startsWith("note:") ? args.note : (gitlabLinkKey(args.note) ?? args.note);
        const item = gitlabItemsByKeys([key]).get(key);
        if (!item || item.kind !== "comment") return fail(`The comment ${args.note} isn't among the synced ones — use a key from mr_comments.`);
        const want = args.resolved !== false;
        const { resolveGitlabThread } = await import("@/lib/gitlab/reply");
        const r = await resolveGitlabThread(item.url, want);
        if (r.resolvable) setGitlabState(key, want ? "resolved" : "unresolved");
        return ok(r.resolvable ? `Thread in ${item.ref} ${want ? "resolved" : "reopened"}.` : `The comment in ${item.ref} isn't a thread GitLab resolves.`);
      }),
  );

  server.registerTool(
    "mr_comment",
    {
      title: "Comment on a merge request",
      description: "A new comment on a merge request (not in a thread) — in GitLab under the user's name, through Zeff's automation Chrome. For answers in a review thread use mr_reply.",
      inputSchema: z.object({
        project: z.string().min(1).describe("The project path, e.g. group/sub/project."),
        iid: z.number().int().min(1).describe("The merge request's number (179 for !179)."),
        body: z.string().min(1).max(8000),
      }),
    },
    async (args) =>
      run(async () => {
        if (!isInstalled("gitlab")) return fail("GitLab is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { commentOnMr } = await import("@/lib/gitlab/reply");
        const r = await commentOnMr(args.project, args.iid, args.body);
        return ok(`Comment posted: ${r.url}`);
      }),
  );

  server.registerTool(
    "add_knowledge",
    {
      title: "Add to the knowledge base",
      description:
        "Keep something in the user's knowledge base (their own knowledge, beside Confluence and what Zeff syncs): a fact, a note, how something works — or a link, whose page is read. " +
        "It's compiled into the knowledge graph right after and found by search_knowledge and the Chat. Use it when the user asks you to remember or note something, " +
        "or for a durable fact the user told you. Never for secrets (passwords, tokens, keys) and never for guesses.",
      inputSchema: z.object({
        text: z.string().min(1).describe("What to keep, in plain words (German or English) — or just a URL to read that page."),
        title: z.string().optional().describe("A short title; without one, the first line."),
      }),
    },
    async (args) =>
      run(async () => {
        if (!isInstalled("knowledge")) return fail("Knowledge is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { knowledgeAddOwn } = await import("@/plugins/knowledge/client");
        const r = await knowledgeAddOwn({ text: args.text, title: args.title });
        return ok(`Kept in the knowledge base as "${r.entry?.title ?? args.title ?? args.text.slice(0, 60)}" (${r.id}) — it's being compiled.`);
      }),
  );

  server.registerTool(
    "list_todos",
    {
      title: "List board todos",
      description:
        "Concrete todos the Todos tab found on the user's Jira tickets (from their comments, history and context), " +
        "each referenced as T-<id>. owner 'me' is the user's to do, 'other' is someone else's move being waited for. " +
        "Look here before working on a ticket; close what you finished with report_time (todos) or complete_todo.",
      inputSchema: z.object({
        ticket: z.string().optional().describe("Only this ticket's todos, e.g. 'PROJ-364'."),
        status: z.enum(["open", "done", "dismissed", "all"]).optional().describe("Default 'open'."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const off = pluginOff("todos");
        if (off) return off;
        const list = listTodos({ ticket: args.ticket, status: args.status ?? "open" });
        if (list.length === 0) return ok(`No ${args.status === "all" ? "" : `${args.status ?? "open"} `}todos${args.ticket ? ` on ${args.ticket}` : ""}.`);
        const { timeTotals } = await import("@/lib/work/todo-time");
        const { formatMinutes } = await import("@/lib/work/shared");
        const tracked = timeTotals(list.map((t) => t.id));
        const lines = list.map(
          (t) =>
            `- ${t.ref} · ${[t.ticket, ...t.alsoTickets].join(" + ")} · ${t.kind}${t.owner === "other" ? " · waiting for others" : ""}${t.status !== "open" ? ` · ${t.status}` : ""}: ${t.text}` +
            (t.source ? ` (source: ${t.source})` : "") +
            (tracked.get(t.id) ? ` [tracked: ${formatMinutes(tracked.get(t.id)!)}]` : "") +
            (t.note ? `\n  note: ${t.note}` : "") +
            t.userNotes.map((n) => `\n  ${n.by ? `report by ${n.by}${n.url ? ` (${n.url})` : ""}` : "the user's note (context — it takes precedence)"}: ${n.text.replace(/\n+/g, " ")}`).join(""),
        );
        return ok(`${list.length} todo(s):\n${lines.join("\n")}`);
      }),
  );

  server.registerTool(
    "start_todo",
    {
      title: "Start working on a board todo",
      description:
        "Take a board todo (T-<id>, see list_todos) as your very FIRST step — before any research, reading or planning: Zeff shows it as being worked on and you as a worker (an extra one, next to its own) on its Code tab. " +
        "Starting is recorded — it is when your work on the todo began, and what the booking's start time (and Zeff's Done calendar) is taken from — so call it BEFORE you begin, not afterwards. Call finish_todo with your report and the time it took when you're through.",
      inputSchema: z.object({
        todo: z.string().min(1).describe("The todo, e.g. 'T-12'."),
        agent: z.string().optional().describe("Who you are, as the Code tab shows it — e.g. 'VS Code Copilot' or 'Claude Code'."),
        note: z.string().optional().describe("What you're about to do, one short line (optional)."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const off = pluginOff("work");
        if (off) return off;
        const { startAgentWork, workplaceOf } = await import("@/lib/work/agent");
        const { run: r, resumed, todo } = startAgentWork(args);
        const w = await workplaceOf(todo);
        // What is kept about the ticket (todos and the messages they came from) for naming the branch — also when the todo is done and the message gone.
        const { namingBlock, namingLimits } = await import("@/lib/work/branch-naming");
        const kept = w.existing ? "" : namingBlock(todo);
        const preamble = (await import("@/plugins/llm/run")).llmPreamble();
        return ok(
          `${resumed ? "Still yours" : "Started"}: W-${r.id} — ${todo.ref} (${todo.ticket}): ${todo.text}\n` +
            (todo.userNotes.length ? `Notes on it (the user's — context, they take precedence — and earlier runs' reports):\n${todo.userNotes.map((n) => `- ${n.by ? `[${n.by}] ` : ""}${n.text}${n.url ? ` (${n.url})` : ""}`).join("\n")}\n` : "") +
            (w.repo
              ? w.existing
                ? `Code: repo ${w.repo.name} (${w.repo.path}). ${todo.ticket} has a feature branch already: ${w.existing} — continue on it (git fetch origin && git switch ${w.existing}, or a worktree of it if your checkout is busy). Commit there, don't push to ${w.base}, don't merge. Strict TDD: a failing test first, then the change, then the suite.\n`
                : `Code: repo ${w.repo.name} (${w.repo.path}). No feature branch for ${todo.ticket} yet — create one off ${w.base} in a separate worktree. Name: ${w.branch} — replace <short-change> with ${namingLimits().en} describing the code change you make, not the ticket's or todo's title; keep the ${todo.ticket} prefix (git fetch origin && git worktree add -b ${w.branch} ../${w.repo.name}-${todo.ticket} origin/${w.base}). Commit there, don't push to ${w.base}, don't merge. Strict TDD: a failing test first, then the change, then the suite.\n`
              : `Code: Zeff knows no repo for ${todo.ticket} — work on a feature branch named ${w.branch} (keep the ${todo.ticket} prefix; <short-change> = ${namingLimits().en} for the code change you make, not the ticket's title) and pass branch and repo (its folder) to finish_todo. Strict TDD: a failing test first, then the change, then the suite.\n`) +
            (kept ? `${kept.trim()}\n` : "") +
            "Its full context (ticket, comments, Teams, mails, notes, earlier runs): todo_context. Notes as you go: todo_progress. Asking the user something: todo_needs_input with the question first (todo_progress clears it when you go on). YOUR TIME: todo_time with the minutes since your last record and a one-line note — after each phase, before you ask the user, when you pause (several records per todo; that's how your time is tracked). When you're through: finish_todo with summary, entry, minutes (since your last todo_time record), outcome and branch (that's what gets booked and delivered — don't call report_time for it)." +
            // The user's instructions and context (the LLM plugin's) — for every agent too.
            (preamble ? `\n\n${preamble}` : ""),
        );
      }),
  );

  server.registerTool(
    "todo_context",
    {
      title: "Everything Zeff knows about a todo",
      description:
        "The todo's brief, as Zeff's own workers get it (Markdown): the ticket (status, description, the Ticket-Lage's view), its comments, where the todo comes from in full (Jira comments, Teams messages with their chat, GitLab threads, mails), the mails naming the ticket, the user's notes and earlier runs' reports, the other open todos, what came before. Read it before you start.",
      inputSchema: z.object({ todo: z.string().min(1).describe("The todo, e.g. 'T-12'.") }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const off = pluginOff("work");
        if (off) return off;
        const id = parseTodoRef(args.todo);
        const todo = id === null ? undefined : getTodo(id);
        if (!todo) return fail(`"${args.todo}" isn't a todo — list_todos shows them (T-12).`);
        const { briefFor } = await import("@/lib/work/brief");
        return ok(briefFor(todo));
      }),
  );

  server.registerTool(
    "todo_attachment",
    {
      title: "A todo's attachments — look at its pictures",
      description:
        "The pictures (and documents) the user attached to a todo — mostly pasted into its notes: screenshots, mock-ups, error screens. todo_context lists them as [doc:12]; this returns the pictures themselves for you to look at (as images), or a document's text. Without doc: all pictures of the todo. Look at them before you implement — a picture often shows exactly what is meant.",
      inputSchema: z.object({
        todo: z.string().min(1).describe("The todo, e.g. 'T-12'."),
        doc: z.string().optional().describe("One attachment as todo_context lists it, e.g. 'doc:12'. Omitted: all the pictures attached to the todo."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const off = pluginOff("todos");
        if (off) return off;
        if (!isInstalled("documents")) return fail("Documents is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const id = parseTodoRef(args.todo);
        const todo = id === null ? undefined : getTodo(id);
        if (!todo) return fail(`"${args.todo}" isn't a todo — list_todos shows them (T-12).`);
        const { attachmentLine, parseDocQuery, todoAttachments } = await import("@/plugins/documents/attachments");
        const { documentFile, documentText } = await import("@/plugins/documents/store");
        const all = todoAttachments(todo.refs);
        if (!all.length) return ok(`${todoRef(todo.id)} has no attachments.`);
        let chosen = all.filter((d) => d.kind === "image").slice(0, 4);
        if (args.doc) {
          const want = parseDocQuery(args.doc);
          const hit = all.find((d) => d.id === want);
          if (!hit) return fail(`"${args.doc}" isn't attached to ${todoRef(todo.id)} — todo_context lists its attachments: ${all.map((d) => d.ref).join(", ")}.`);
          chosen = [hit];
        } else if (!chosen.length) {
          return ok(`${todoRef(todo.id)} has no pictures; its other attachments (ask for one with doc):\n${all.map((d) => `- ${attachmentLine(d)}`).join("\n")}`);
        }
        const content: ToolResult["content"] = [];
        const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
        for (const d of chosen) {
          content.push({ type: "text", text: attachmentLine(d, 1500) });
          if (d.kind === "image") {
            const f = documentFile(d.id);
            if (!f) {
              content.push({ type: "text", text: "(the file is no longer there)" });
              continue;
            }
            const fs = await import("node:fs");
            if (fs.statSync(f.path).size > MAX_IMAGE_BYTES) {
              content.push({ type: "text", text: "(the picture is larger than 8 MB — only its description above is available)" });
              continue;
            }
            const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
            const mimeType = f.mime.startsWith("image/") ? f.mime : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext || "png"}`;
            content.push({ type: "image", data: fs.readFileSync(f.path).toString("base64"), mimeType });
          } else {
            const text = documentText(d.id).trim();
            content.push({ type: "text", text: text ? (text.length > 12000 ? `${text.slice(0, 12000)}\n… (cut)` : text) : "(no text read from it)" });
          }
        }
        return { content };
      }),
  );

  server.registerTool(
    "todo_progress",
    {
      title: "Note progress on a board todo",
      description: "A short note on what you're doing on a todo you started (start_todo) — shown as its log on Zeff's Code tab.",
      inputSchema: z.object({
        todo: z.string().min(1).describe("The todo, e.g. 'T-12'."),
        message: z.string().min(1).describe("What you're doing now, one or two lines."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      run(async () => {
        const off = pluginOff("work");
        if (off) return off;
        const { agentProgress } = await import("@/lib/work/agent");
        const r = agentProgress(args);
        return ok(`Noted on W-${r.id}.`);
      }),
  );

  server.registerTool(
    "todo_time",
    {
      title: "Report time spent on a board todo",
      description:
        "Report the time you spent on a todo (T-<id>) — ONE record for one stretch of work: minutes since your last record, honestly, with a one-line note of what was done. " +
        "Call it after each phase, before you ask the user something and when you pause or stop; a todo gets many records. When the user books, the time of all related todos " +
        "(same ticket, follow-ups, the todos a session touched) flows into one booking suggestion with every record linked as evidence. Not a booking by itself.",
      inputSchema: z.object({
        todo: z.string().min(1).describe("The todo, e.g. 'T-12'."),
        minutes: z.number().positive().max(1440).optional().describe("Minutes spent since your last record (1-1440)."),
        hours: z.number().positive().max(24).optional().describe("Instead of minutes: hours as a decimal, e.g. 0.75."),
        note: z.string().optional().describe("What was done in that time, ONE short line (<80 chars); no commit logs or file lists."),
        agent: z.string().optional().describe("Who you are — e.g. 'Claude Code', 'VS Code Copilot'; a Zeff worker: its run, 'W-45'."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      run(async () => {
        const off = pluginOff("work");
        if (off) return off;
        const id = parseTodoRef(args.todo);
        const todo = id === null ? undefined : getTodo(id);
        if (!todo) return fail(`"${args.todo}" isn't a todo — list_todos shows them (T-12).`);
        const minutes = args.minutes ?? (args.hours !== undefined ? Math.round(args.hours * 60) : undefined);
        if (minutes === undefined) return fail("Pass minutes (or hours) — the time you spent since your last record.");
        const { addTodoTime, listTodoTimes } = await import("@/lib/work/todo-time");
        const { formatMinutes } = await import("@/lib/work/shared");
        const r = addTodoTime({ todoId: todo.id, minutes, note: args.note, by: args.agent, source: "agent" });
        const open = listTodoTimes([todo.id], { open: true });
        return ok(
          `Recorded ${r.ref}: ${formatMinutes(r.minutes)} on ${todo.ref} (${r.by})${r.note ? ` — "${r.note}"` : ""}. ` +
            `${todo.ref} has ${open.length} unbooked record(s), ${formatMinutes(open.reduce((a, x) => a + x.minutes, 0))} in all; the next one is the time since now.`,
        );
      }),
  );

  server.registerTool(
    "todo_needs_input",
    {
      title: "Mark a board todo as waiting for the user",
      description:
        "Call BEFORE you ask the user anything while working on a todo you started (start_todo): a question, a decision, a confirmation. The todo shows ❗ and your question on Zeff's Todos and Code tabs until you go on (todo_progress) or finish (finish_todo).",
      inputSchema: z.object({
        todo: z.string().min(1).describe("The todo, e.g. 'T-12'."),
        question: z.string().min(1).describe("What you're asking the user, one or two lines."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const off = pluginOff("work");
        if (off) return off;
        const { agentNeedsInput } = await import("@/lib/work/agent");
        const r = agentNeedsInput(args);
        return ok(`Marked ❗ on W-${r.id} — now ask the user. Call todo_progress once you go on.`);
      }),
  );

  server.registerTool(
    "finish_todo",
    {
      title: "Finish working on a board todo",
      description:
        "Report on a todo you worked on (after start_todo): what you did, the line to book, how long it took. Zeff ends your run with it, ticks the todo off when it's done " +
        "(and the comments it came from), keeps your follow-ups as new todos, and records your minutes as one more time record on the todo and suggests the booking (S-<id>: all the todo's unsuggested time records, your entry line, the todo and your run as evidence) — the user takes it over. Don't also call report_time for this work.",
      inputSchema: z.object({
        todo: z.string().min(1).describe("The todo, e.g. 'T-12'."),
        summary: z
          .string()
          .min(1)
          .describe("Your report on the todo — ALWAYS, in full, even when nothing worked: ONE sentence on what is done now (or why not), then the sections '## Erledigt', '## Offen' (what stays and why), '## Geprüft' (tests/build/manual checks — and what did NOT run, with the reason), '## Ort' (branch, commit). Markdown. It is kept as the todo's report and read by the knowledge server."),
        changes: z.array(z.string()).optional().describe("Every changed file or place, one line each (path: what), and the commits (hash: title)."),
        checks: z.array(z.string()).optional().describe("Every check, one line each: 'command/kind: result' — or 'not run: reason'."),
        entry: z.string().min(1).describe("ONE short line for the time booking: what was done, not how (no commit/MR numbers, no file lists)."),
        minutes: z.number().positive().describe("The time since your last todo_time record, in minutes — all the work's time, if you reported none."),
        outcome: z.enum(["done", "partial", "blocked"]).optional().describe("done (default): the todo is finished; partial: some of it; blocked: you couldn't go on."),
        agent: z.string().optional().describe("Who you are (when you didn't call start_todo)."),
        branch: z.string().optional().describe("The feature branch you committed the work on — Zeff then creates the delivery todo (push → merge request, or merge into main)."),
        repo: z.string().optional().describe("The repo's folder, when Zeff doesn't know the ticket's repo (start_todo says so)."),
        followUps: z
          .array(
            z.object({
              text: z.string().min(1).describe("What's to do next, one sentence."),
              kind: z.string().optional().describe("reply, comment, update, implement, fix, test, review, clarify, document, deploy, merge or other."),
              channel: z.enum(["jira", "teams", "gitlab", "none"]).optional().describe("Where a message goes."),
              target: z.string().optional().describe("The ticket key (jira), teams:<key> or gitlab:note:<id>."),
              draft: z.string().optional().describe("The ready message, if it's one."),
            }),
          )
          .optional()
          .describe("What's left — they become todos on the ticket."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      run(async () => {
        const off = pluginOff("work");
        if (off) return off;
        const { finishAgentWork } = await import("@/lib/work/agent");
        const r = await finishAgentWork(args);
        const mins = r.durationMs ? Math.round(r.durationMs / 60000) : args.minutes;
        return ok(
          `W-${r.run.id} finished (${r.run.outcome}) — ${mins} min recorded on the todo${r.suggestion ? ` as booking suggestion ${r.suggestion}` : ""} ("${r.run.entryLine ?? ""}"); the user takes it over in Zeff.` +
            (r.closed.length || r.marked.length ? ` Reported done: ${[...r.closed, ...r.marked].map((id) => todoRef(id)).join(", ")} (they stay open and are highlighted — the user closes them).` : "") +
            (r.added.length ? ` Follow-ups: ${r.added.map((id) => todoRef(id)).join(", ")}.` : "") +
            (r.delivery ? ` Delivery: ${r.delivery}.` : args.branch ? "" : " No branch given — if you changed code, tell the user which branch it's on."),
        );
      }),
  );

  server.registerTool(
    "add_todo",
    {
      title: "Write a todo on a ticket",
      description:
        "Write a step of your work as a todo on the ticket (the ticket key, e.g. PROJ-436) — the user sees it in their todo list and can add more. Write the steps you plan at the start, one line each, and tick them off as you finish them: complete_todo with tick: true (only todos you wrote yourself can be ticked by you). A todo that repeats an open one is that one. For what only the user (or someone else) can do: owner 'other' is for someone else, default 'me' is the user.",
      inputSchema: z.object({
        ticket: z.string().min(1).describe("The ticket key, e.g. 'PROJ-436'."),
        text: z.string().min(1).describe("The step, one short line."),
        owner: z.enum(["me", "other"]).optional().describe("Whose it is: me (the user, default) or other (someone else)."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      run(() => {
        const off = pluginOff("todos");
        if (off) return off;
        const t = attributed("agent:MCP", () => addAgentTodo({ ticket: args.ticket, text: args.text, owner: args.owner }));
        return ok(`${t.ref} (${t.ticket}) is on the ticket: ${t.text}${t.outcome ? ` (it repeats an open todo — that one is meant)` : ""}. Tick it off when it's done: complete_todo { todo: "${t.ref}", tick: true }.`);
      }),
  );

  server.registerTool(
    "complete_todo",
    {
      title: "Complete a board todo",
      description: "Report a board todo (T-<id>, see list_todos) done, with a short note of what settled it. It stays open and is highlighted in Zeff — the user closes it. Or dismiss it, when it doesn't apply (that closes it).",
      inputSchema: z.object({
        todo: z.string().min(1).describe("The todo, e.g. 'T-12'."),
        note: z.string().optional().describe("What settled it, one short line."),
        dismiss: z.boolean().optional().describe("Dismiss instead of done (it doesn't apply). Default false."),
        tick: z.boolean().optional().describe("Tick it off as done (it is closed, the user can open it again) — for a todo you really did: your own (add_todo) or one the user added on the ticket. Not for what only the user can do."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      run(() => {
        const off = pluginOff("todos");
        if (off) return off;
        const id = parseTodoRef(args.todo);
        if (id === null) return fail(`"${args.todo}" isn't a todo reference like T-12.`);
        if (args.tick && !args.dismiss) {
          const r = attributed("agent:MCP", () => tickAgentTodo(id, args.note ?? null));
          return ok(r.ticked ? `${r.todo.ref} (${r.todo.ticket}) is ticked off: ${r.todo.text}` : `${r.todo.ref} (${r.todo.ticket}) is ${r.todo.status} already: ${r.todo.text}`);
        }
        const t = attributed("agent:MCP", () => (args.dismiss ? setTodoStatus(id, "dismissed", args.note ?? null) : markWorkerDone(id, "MCP", args.note ?? null)));
        return ok(args.dismiss ? `${t.ref} (${t.ticket}) is ${t.status}: ${t.text}` : `${t.ref} (${t.ticket}) is reported done and highlighted — it stays open, the user closes it: ${t.text}`);
      }),
  );

  server.registerTool(
    "list_jobs",
    {
      title: "List jobs",
      description:
        "List job numbers that time can be booked on, with total hours booked. " +
        "Optionally filter by a search term matching number, name or customer.",
      inputSchema: z.object({
        query: z.string().optional().describe("Search term (matches number, name, customer)."),
        includeInactive: z
          .boolean()
          .optional()
          .describe("Also list inactive (closed) jobs. Default false."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(() => {
        const jobs = listJobs({ query: args.query, includeInactive: args.includeInactive });
        if (jobs.length === 0) {
          return ok(
            args.query
              ? `No jobs match "${args.query}".`
              : "No jobs exist yet. Create one with create_job or in the Zeff web UI.",
          );
        }
        const lines = jobs.map(
          (j) =>
            `- ${j.number} — ${j.name}` +
            (j.customer ? ` (${j.customer})` : "") +
            (j.active ? "" : " [inactive]") +
            ` · ${formatHours(j.totalHours)}h in ${j.entryCount} entries` +
            (j.description ? `\n  ${j.description}` : ""),
        );
        return ok(`${jobs.length} job(s):\n${lines.join("\n")}`);
      }),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List projects time can be booked on (report_time with project). A project books its hours on its job; " +
        "one without a job collects them under a placeholder until the user sets it.",
      inputSchema: z.object({
        includeInactive: z.boolean().optional().describe("Also list inactive projects. Default false."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(() => {
        const projects = listProjects({ includeInactive: args.includeInactive });
        if (projects.length === 0) return ok("No projects exist yet. They are created in the Zeff web UI (Projects).");
        const lines = projects.map(
          (p) =>
            `- "${p.title}" → ` +
            (p.job ? `job ${p.job.number} (${p.job.name})` : "no job yet") +
            (p.active ? "" : " [inactive]") +
            ` · ${formatHours(p.totalHours)}h in ${p.entryCount} entries` +
            (p.description ? `\n  ${p.description}` : ""),
        );
        return ok(`${projects.length} project(s):\n${lines.join("\n")}`);
      }),
  );

  server.registerTool(
    "create_job",
    {
      title: "Create job",
      description: "Create a new job number that time can be booked on.",
      inputSchema: z.object({
        number: z.string().min(1).describe("Unique job number, e.g. '2026-0815'."),
        name: z.string().min(1).describe("Short job name."),
        customer: z.string().optional().describe("Customer / client name."),
        description: z.string().optional().describe("Longer description of the job."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      run(() => {
        const job = createJob(args);
        return ok(`Created job ${job.number} — ${job.name} (id ${job.id}).`);
      }),
  );

  server.registerTool(
    "get_weekly_report",
    {
      title: "Weekly report",
      description:
        "Hours per job and weekday for one calendar week (Monday–Sunday), plus all entries of that week.",
      inputSchema: z.object({
        week: z
          .string()
          .optional()
          .describe(
            "ISO week like '2026-W39', or any date (YYYY-MM-DD) inside the week. Defaults to the current week.",
          ),
        reportedBy: z.string().optional().describe("Only include entries reported by this name."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(() => {
        const week = resolveWeek(args.week);
        if (!week) {
          return fail(`Cannot parse week "${args.week}". Use '2026-W39' or a date like 2026-09-21.`);
        }
        return ok(renderWeeklyReport(getWeeklyReport(week, { reportedBy: args.reportedBy })));
      }),
  );

  server.registerTool(
    "list_time_entries",
    {
      title: "List time entries",
      description: "List booked time entries, newest first, with optional filters.",
      inputSchema: z.object({
        jobNumber: z.string().optional().describe("Only entries on this job."),
        from: z.string().optional().describe("Earliest date (YYYY-MM-DD), inclusive."),
        to: z.string().optional().describe("Latest date (YYYY-MM-DD), inclusive."),
        ticket: z.string().optional().describe("Only entries with this ticket key."),
        reportedBy: z.string().optional().describe("Only entries reported by this name."),
        limit: z.number().int().positive().max(500).optional().describe("Max entries, default 50."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(() => {
        const entries = listEntries({ ...args, limit: args.limit ?? 50 });
        if (entries.length === 0) return ok("No matching time entries.");
        const total = entries.reduce((a, e) => a + e.hours, 0);
        return ok(
          `${entries.length} entries, ${formatHours(total)}h total:\n` +
            entries.map((e) => `- ${describeEntry(e)}`).join("\n"),
        );
      }),
  );

  server.registerTool(
    "update_time_entry",
    {
      title: "Update time suggestion",
      description: "Correct a booking you suggested (S-<id>, from report_time or finish_todo) while it's still open — booked entries are the user's. Only the given fields are changed.",
      inputSchema: z.object({
        id: z.union([z.number().int().positive(), z.string()]).describe("The suggestion: 'S-12' or 12."),
        jobNumber: z.string().optional().describe("Book on this job directly (takes the entry out of its project)."),
        project: z.string().nullable().optional().describe("Book on this project (by title); null takes the entry out of its project."),
        hours: z.number().positive().max(24).optional(),
        description: z.string().min(1).optional(),
        date: z.string().optional().describe("YYYY-MM-DD"),
        ticket: z.string().nullable().optional().describe("Ticket key; null clears it."),
        type: z.string().optional().describe("Entry type key, e.g. ticket, meeting, internal, training, other, absence."),
        tags: z.array(z.string()).optional().describe("Replaces the entry's tags."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, project, ...patch }) =>
      run(async () => {
        const { parseSuggestionRef, updateSuggestion } = await import("@/lib/work/suggestions");
        const n = parseSuggestionRef(id);
        if (n === null) return fail(`"${id}" isn't a suggestion (S-<id>).`);
        const projectId = project === undefined ? undefined : project === null ? null : requireProjectByTitle(project).id;
        const s = updateSuggestion(n, { ...patch, ...(projectId !== undefined && { projectId }) });
        return ok(`Updated ${s.ref}: ${formatHours(s.hours)}h for ${s.date}${s.ticket ? `, ${s.ticket}` : ""} — "${s.description}".`);
      }),
  );

  server.registerTool(
    "delete_time_entry",
    {
      title: "Withdraw time suggestion",
      description: "Withdraw a booking you suggested by mistake (S-<id>) while it's still open — booked entries are the user's.",
      inputSchema: z.object({
        id: z.union([z.number().int().positive(), z.string()]).describe("The suggestion: 'S-12' or 12."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) =>
      run(async () => {
        const { parseSuggestionRef, withdrawSuggestion } = await import("@/lib/work/suggestions");
        const n = parseSuggestionRef(id);
        if (n === null) return fail(`"${id}" isn't a suggestion (S-<id>).`);
        const s = withdrawSuggestion(n);
        return ok(`Withdrew ${s.ref} (${formatHours(s.hours)}h, "${s.description}").`);
      }),
  );

  // The Workspace's pages and databases (when that plugin is installed, the tools say so otherwise).
  registerWorkspaceTools(server, { run, ok, fail });
  registerWebSearchTools(server, { run, ok, fail } as never);
  registerGmailTools(server, { run, ok, fail } as never);
  registerReportTool(server, { run, ok, fail } as never);
}
