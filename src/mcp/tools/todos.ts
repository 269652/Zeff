import { isInstalled } from "@/plugins/state";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getTodo, listTodos } from "@/lib/todos/store";
import { parseTodoRef, todoRef } from "@/lib/todos/shared";
import { run, pluginOff, ok, fail, type ToolResult } from "./kit";

/** Registers list_todos, start_todo, todo_context, ticket_brief, todo_attachment. */
export function registerTodoTools(server: McpServer): void {
  server.registerTool(
    "list_todos",
    {
      title: "List board todos",
      description:
        "Concrete todos the Todos tab found on the user's Jira tickets (from their comments, history and context), " +
        "each referenced as T-<id>. owner 'me' is the user's to do, 'other' is someone else's move being waited for. " +
        "Look here BEFORE any work for the user (any agent — Copilot, Claude Code, a Zeff worker). If a todo stands for the work, its time MUST be measured: start_todo (or todo_clock_start) before you begin, todo_clock_ping at least every 10 minutes while you work (silent longer, the clock pauses as of your last ping and that time is lost), todo_clock_stop when you stop or switch, finish_todo when through. Close what you finished with finish_todo, report_time (todos) or complete_todo.",
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
        // The clock rule with every list: whoever works on one of these (Copilot in VS Code too) reads it here.
        const { CLOCK_RULE } = await import("@/lib/work/todo-clock");
        return ok(`${list.length} todo(s):\n${lines.join("\n")}\n\n${CLOCK_RULE}`);
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
        // The clock starts with it (todo_clock_start): the time on the todo is measured from now, not guessed.
        const { clockIn } = await import("@/lib/work/todo-clock");
        const clock = clockIn(todo.id, args.agent);
        const w = await workplaceOf(todo);
        // What is kept about the ticket (todos and the messages they came from) for naming the branch — also when the todo is done and the message gone.
        const { namingBlock, namingLimits } = await import("@/lib/work/branch-naming");
        const kept = w.existing ? "" : namingBlock(todo);
        const preamble = (await import("@/plugins/llm/run")).llmPreamble();
        return ok(
          `${resumed ? "Still yours" : "Started"}: W-${r.id} — ${todo.ref} (${todo.ticket}): ${todo.text}\n` +
            `Clock: running on ${todo.ref} since ${clock.since}${clock.switched ? ` (the one on ${todoRef(clock.switched.todoId)} stopped: ${clock.switched.minutes} min recorded)` : ""} — ping it at least every 10 minutes (todo_clock_ping, todo_progress or todo_time), else it pauses as of your last ping; stop it with todo_clock_stop when you stop working on it, or finish_todo. KEEP THIS START TIME: if you don't ping reliably, give it when you stop as log: { from: "${clock.since}", to: <now, read with date -u +%FT%TZ> }.\n` +
            (todo.userNotes.length ? `Notes on it (the user's — context, they take precedence — and earlier runs' reports):\n${todo.userNotes.map((n) => `- ${n.by ? `[${n.by}] ` : ""}${n.text}${n.url ? ` (${n.url})` : ""}`).join("\n")}\n` : "") +
            (w.repo
              ? w.existing
                ? `Code: repo ${w.repo.name} (${w.repo.path}). ${todo.ticket} has a feature branch already: ${w.existing} — continue on it (git fetch origin && git switch ${w.existing}, or a worktree of it if your checkout is busy). Commit there, don't push to ${w.base}, don't merge. Strict TDD: a failing test first, then the change, then the suite.\n`
                : `Code: repo ${w.repo.name} (${w.repo.path}). No feature branch for ${todo.ticket} yet — create one off ${w.base} in a separate worktree. Name: ${w.branch} — replace <short-change> with ${namingLimits().en} describing the code change you make, not the ticket's or todo's title; keep the ${todo.ticket} prefix (git fetch origin && git worktree add -b ${w.branch} ../${w.repo.name}-${todo.ticket} origin/${w.base}). Commit there, don't push to ${w.base}, don't merge. Strict TDD: a failing test first, then the change, then the suite.\n`
              : `Code: Zeff knows no repo for ${todo.ticket} — work on a feature branch named ${w.branch} (keep the ${todo.ticket} prefix; <short-change> = ${namingLimits().en} for the code change you make, not the ticket's title) and pass branch and repo (its folder) to finish_todo. Strict TDD: a failing test first, then the change, then the suite.\n`) +
            (kept ? `${kept.trim()}\n` : "") +
            "Its full context (ticket, comments, Teams, mails, notes, earlier runs): todo_context. Notes as you go: todo_progress. Asking the user something: todo_needs_input with the question first — the clock pauses while you wait (todo_progress goes on and restarts it). YOUR TIME IS MEASURED: the clock runs from now; todo_time without minutes records the time so far (a lap) after each phase; todo_clock_stop when you stop or switch to other work; todo_clock_start again when you come back. When you're through: finish_todo with summary, entry, outcome and branch — it stops the clock and takes the measured time (no minutes needed; that's what gets booked and delivered — don't call report_time for it)." +
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
    "ticket_brief",
    {
      title: "Everything Zeff knows about a ticket — by its key, a branch or the repo you work in",
      description:
        "Before you work on a ticket: what it asks (status, assignee, description, acceptance criteria), who asked for it and in what words (the Teams messages or mails its todos came from), what was said about it lately (chats naming it; people and open loops around it), its merge requests and branches, its open todos. Give the ticket key, or a branch name, or the folder you work in (its checked-out branch names the ticket) — e.g. ticket_brief({ cwd: process.cwd() }). Read only.",
      inputSchema: z.object({
        ticket: z.string().optional().describe("The ticket key, e.g. 'PROJ-371'."),
        branch: z.string().optional().describe("A branch name that contains the key, e.g. 'feature/PROJ-371-teaser'."),
        cwd: z.string().optional().describe("The repo folder you work in: its checked-out branch names the ticket."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const { ticketFrom, ticketBrief } = await import("@/lib/work/ticket-brief");
        const found = ticketFrom(args);
        if (!found) return fail("No ticket key in what you gave (ticket, branch or the repo folder's branch) — pass the key, e.g. ticket: 'PROJ-371'.");
        const text = await ticketBrief(found.key);
        return text ? ok(found.via === "ticket" ? text : `(${found.key}, from ${found.via})\n\n${text}`) : fail(`Zeff knows nothing about ${found.key} (not synced from Jira, no todos on it).`);
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
}
