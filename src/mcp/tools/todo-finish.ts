import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { attributed } from "@/lib/boards/activity";
import { addAgentTodo, addTodoAiNote, getTodo, markWorkerDone, setTodoStatus, tickAgentTodo } from "@/lib/boards/store";
import { parseTodoRef, todoRef } from "@/lib/boards/shared";
import { SESSION_LOG, run, pluginOff, ok, fail } from "./kit";

/** Registers finish_todo, todo_note, add_todo, complete_todo. */
export function registerTodoFinishTools(server: McpServer): void {
  server.registerTool(
    "finish_todo",
    {
      title: "Finish working on a board todo",
      description:
        "Report on a todo you worked on (after start_todo): what you did, the line to book, how long it took. Zeff ends your run with it, ticks the todo off when it's done " +
        "(and the comments it came from), keeps your follow-ups as new todos, and records the time its clock MEASURED as one more time record on the todo (no clock: no time — you give none) and suggests the booking (S-<id>: all the todo's unsuggested time records, your entry line, the todo and your run as evidence) — the user takes it over. Don't also call report_time for this work.",
      inputSchema: z.object({
        todo: z.string().min(1).describe("The todo, e.g. 'T-12'."),
        summary: z
          .string()
          .min(1)
          .describe("Your report on the todo — ALWAYS, in full, even when nothing worked: ONE sentence on what is done now (or why not), then the sections '## Erledigt', '## Offen' (what stays and why), '## Geprüft' (tests/build/manual checks — and what did NOT run, with the reason), '## Ort' (branch, commit). Markdown. It is kept as the todo's report and read by the knowledge server."),
        changes: z.array(z.string()).optional().describe("Every changed file or place, one line each (path: what), and the commits (hash: title)."),
        checks: z.array(z.string()).optional().describe("Every check, one line each: 'command/kind: result' — or 'not run: reason'."),
        entry: z.string().min(1).describe("ONE short line for the time booking: what was done, not how (no commit/MR numbers, no file lists)."),
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
        log: SESSION_LOG,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      run(async () => {
        const off = pluginOff("work");
        if (off) return off;
        const { finishAgentWork } = await import("@/lib/work/agent");
        // The clock stops: its measured time is the rest of the work's time (finish records it itself, so not twice).
        const id = parseTodoRef(args.todo);
        const clock = await import("@/lib/work/todo-clock");
        const measured = id === null ? null : clock.clockOut(id, args.agent, { record: false, log: args.log });
        // Only measured time: what the clock heard, or the agent's own log of the stretch (times it read). No clock ran: its
        // log from the todo's last record on (or from when the todo was made) — without one, no time from this stretch.
        let minutes = measured?.minutes ?? 0;
        if (!measured && id !== null && args.log && !args.log.idle) {
          const { listTodoTimes } = await import("@/lib/work/todo-time");
          const since = Math.max(0, ...listTodoTimes([id]).map((r) => Date.parse(r.at)), Date.parse(getTodo(id)?.createdAt ?? "") || 0);
          minutes = Math.round(clock.loggedMs(args.log, since, Date.now()) / 60000);
        }
        const r = await finishAgentWork({ ...args, minutes, measuredOnly: true });
        const mins = r.durationMs ? Math.round(r.durationMs / 60000) : minutes;
        return ok(
          `W-${r.run.id} finished (${r.run.outcome}) — ${mins ? `${mins} min measured` : "no measured time (no clock ran)"} on the todo${r.suggestion ? ` as booking suggestion ${r.suggestion}` : ""} ("${r.run.entryLine ?? ""}"); the user takes it over in Zeff.` +
            (r.closed.length || r.marked.length ? ` Reported done: ${[...r.closed, ...r.marked].map((id) => todoRef(id)).join(", ")} (they stay open and are highlighted — the user closes them).` : "") +
            (r.added.length ? ` Follow-ups: ${r.added.map((id) => todoRef(id)).join(", ")}.` : "") +
            (r.delivery ? ` Delivery: ${r.delivery}.` : args.branch ? "" : " No branch given — if you changed code, tell the user which branch it's on."),
        );
      }),
  );

  server.registerTool(
    "todo_note",
    {
      title: "Leave an AI note on a todo",
      description:
        "Write a note on a todo (T-<id>, see list_todos) — what you found, did or decided, in a few lines, optionally with a link (a merge request, a page). It shows among the todo's notes as an AI note with your name, and is context for the user, the Lage and the next worker. Not for questions to the user (todo_needs_input) and not a progress line (todo_progress).",
      inputSchema: z.object({
        todo: z.string().min(1).describe("The todo, e.g. 'T-12'."),
        note: z.string().min(1).describe("The note, a few lines (Markdown)."),
        agent: z.string().optional().describe("Your name, e.g. 'Copilot' or 'W-45'. Shown with the note."),
        url: z.string().optional().describe("A link the note refers to."),
        urlLabel: z.string().optional().describe("The link's text."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) =>
      run(() => {
        const off = pluginOff("todos");
        if (off) return off;
        const id = parseTodoRef(args.todo);
        if (id === null) return fail(`"${args.todo}" isn't a todo reference like T-12.`);
        const t = getTodo(id);
        if (!t) return fail(`Todo ${args.todo} not found.`);
        if (!args.note.trim()) return fail("The note is empty.");
        const url = args.url && /^https?:\/\//i.test(args.url.trim()) ? args.url.trim() : undefined;
        attributed(`agent:${args.agent || "MCP"}`, () => addTodoAiNote(id, { text: args.note, by: (args.agent || "MCP").slice(0, 80), ...(url ? { url, urlLabel: args.urlLabel?.slice(0, 80) } : {}) }));
        return ok(`Note left on ${t.ref} (${t.ticket || "no ticket"}).`);
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
}
