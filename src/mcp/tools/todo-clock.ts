import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getTodo } from "@/lib/todos/store";
import { parseTodoRef, todoRef } from "@/lib/todos/shared";
import { run, pluginOff, ok, SESSION_LOG, fail, recordFromLog } from "./kit";

/** Registers todo_progress, todo_time(_update/_delete), todo_clock_start/stop/ping, todo_needs_input. */
export function registerTodoClockTools(server: McpServer): void {
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
        // Going on after a question: its paused clock runs again.
        const id = parseTodoRef(args.todo);
        const resumed = id === null ? 0 : (await import("@/lib/work/todo-clock")).clockResume(id);
        return ok(`Noted on W-${r.id}.${resumed ? " Clock running again." : ""}`);
      }),
  );

  server.registerTool(
    "todo_time",
    {
      title: "Report time spent on a board todo",
      description:
        "Record the time MEASURED on a todo (T-<id>) since its clock started or since your last record — ONE record (a lap; the clock runs on), with a one-line note of what was done. " +
        "Only with a running clock (start_todo, todo_clock_start): you give no minutes — only measured time counts. Call it after each phase; a todo gets many records. When the user books, the time of all related todos " +
        "(same ticket, follow-ups, the todos a session touched) flows into one booking suggestion with every record linked as evidence. Not a booking by itself.",
      inputSchema: z.object({
        todo: z.string().min(1).describe("The todo, e.g. 'T-12'."),
        note: z.string().optional().describe("What was done in that time, ONE short line (<80 chars); no commit logs or file lists."),
        agent: z.string().optional().describe("Who you are — e.g. 'Claude Code', 'VS Code Copilot'; a Zeff worker: its run, 'W-45'."),
        log: SESSION_LOG,
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
        const { listTodoTimes } = await import("@/lib/work/todo-time");
        const { formatMinutes } = await import("@/lib/work/shared");
        // Only measured time: the clock's since its start (or the last lap) is recorded — it runs on. No clock, no time.
        const { clockLap } = await import("@/lib/work/todo-clock");
        const lap = clockLap(todo.id, args.agent, args.note, Date.now(), args.log);
        // No clock ran: the agent's own log of the work (times it read) — else nothing.
        const r = lap?.record ?? (await recordFromLog(todo.id, args.log, args.note, args.agent));
        if (!r) return fail(`No clock runs on ${todo.ref} and no log given — only measured time is recorded. Worked on it without a clock? Give your log: log: { from, to } — times you READ (from your session's messages, or date -u +%FT%TZ), or log.steps; Zeff computes the minutes. Next time start the clock first (todo_clock_start, or start_todo).`);
        const open = listTodoTimes([todo.id], { open: true });
        return ok(
          `Recorded ${r.ref}: ${formatMinutes(r.minutes)} on ${todo.ref} (${r.by})${lap ? " — measured by its clock, which runs on" : ""}${r.note ? ` — "${r.note}"` : ""}. ` +
            `${todo.ref} has ${open.length} unbooked record(s), ${formatMinutes(open.reduce((a, x) => a + x.minutes, 0))} in all; the next one is the time since now.`,
        );
      }),
  );

  server.registerTool(
    "todo_time_update",
    {
      title: "Correct a time record on a todo",
      description:
        "Correct a time record (TT-<id>, as the answers of todo_time and todo_clock_stop and todo_context's 'Erfasste Zeit' name it) that is wrong — too long (the clock ran while nobody worked on it), a wrong note: LOWER its minutes (or hours) and/or change its note. A record is never raised — only measured time counts. Only while it isn't booked or in a booking suggestion yet (then the suggestion is corrected: update_time_entry S-<id>). The time a clock measured is changed the same way.",
      inputSchema: z.object({
        record: z.string().min(1).describe("The time record, e.g. 'TT-40' (or just 40)."),
        minutes: z.number().positive().max(1440).optional().describe("The right minutes (1-1440)."),
        hours: z.number().positive().max(24).optional().describe("Instead of minutes: hours as a decimal, e.g. 0.5."),
        note: z.string().optional().describe("The right one-line note."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const off = pluginOff("work");
        if (off) return off;
        const id = Number(/^(?:TT-)?(\d+)$/i.exec(args.record.trim())?.[1]);
        if (!id) return fail(`"${args.record}" isn't a time record — they're named TT-<id> (todo_time's answer, todo_context's 'Erfasste Zeit').`);
        const minutes = args.minutes ?? (args.hours !== undefined ? Math.round(args.hours * 60) : undefined);
        if (minutes === undefined && args.note === undefined) return fail("Pass the right minutes (or hours) and/or note.");
        const { timesByIds, updateTodoTime } = await import("@/lib/work/todo-time");
        const { formatMinutes } = await import("@/lib/work/shared");
        const was = timesByIds([id])[0];
        if (was && minutes !== undefined && minutes > was.minutes) return fail(`TT-${id} has ${formatMinutes(was.minutes)} measured — a record can only be lowered, never raised (only measured time counts).`);
        const r = updateTodoTime(id, { minutes, note: args.note });
        return ok(`${r.ref} on ${todoRef(r.todoId)} is now ${formatMinutes(r.minutes)}${r.note ? ` — "${r.note}"` : ""}.`);
      }),
  );

  server.registerTool(
    "todo_time_delete",
    {
      title: "Delete a time record on a todo",
      description: "Delete a time record (TT-<id>) that shouldn't be there at all — reported twice, on the wrong todo. Only while it isn't booked or in a booking suggestion yet. A wrong length is corrected with todo_time_update instead.",
      inputSchema: z.object({ record: z.string().min(1).describe("The time record, e.g. 'TT-40' (or just 40).") }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async (args) =>
      run(async () => {
        const off = pluginOff("work");
        if (off) return off;
        const id = Number(/^(?:TT-)?(\d+)$/i.exec(args.record.trim())?.[1]);
        if (!id) return fail(`"${args.record}" isn't a time record — they're named TT-<id>.`);
        const { deleteTodoTime } = await import("@/lib/work/todo-time");
        deleteTodoTime(id);
        return ok(`TT-${id} deleted.`);
      }),
  );

  server.registerTool(
    "todo_clock_start",
    {
      title: "Start the clock on a todo — before you work on it",
      description:
        "Call it BEFORE you start any work that a todo (T-<id>) stands for — reading, researching, coding, writing, testing: Zeff notes the time. Stop it with todo_clock_stop when you stop (or finish_todo): Zeff takes the difference as the time record — measured, not guessed. One clock per agent: starting on another todo stops the one running (its time recorded). Running already: it just goes on. start_todo starts it too.",
      inputSchema: z.object({
        todo: z.string().min(1).describe("The todo, e.g. 'T-12'."),
        agent: z.string().optional().describe("Who you are — e.g. 'Claude Code', 'VS Code Copilot'; a Zeff worker: its run, 'W-45'."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const off = pluginOff("work");
        if (off) return off;
        const id = parseTodoRef(args.todo);
        const todo = id === null ? undefined : getTodo(id);
        if (!todo) return fail(`"${args.todo}" isn't a todo — list_todos shows them (T-12).`);
        const { clockIn } = await import("@/lib/work/todo-clock");
        const c = clockIn(todo.id, args.agent);
        return ok(
          `${c.resumed ? "Clock running already" : "Clock started"} on ${todo.ref} (since ${c.since} — keep it: if you don't ping reliably, give it when you stop as log.from, with log.to read then).` +
            (c.switched ? ` The clock on ${todoRef(c.switched.todoId)} was stopped: ${c.switched.minutes} min recorded.` : "") +
            " Ping it at least every 10 minutes while you work (todo_clock_ping, or todo_progress / todo_time) — silent longer, it pauses as of your last ping and that time is lost. Stop it with todo_clock_stop when you stop working on it (or finish_todo); todo_time without minutes records a lap.",
        );
      }),
  );

  server.registerTool(
    "todo_clock_stop",
    {
      title: "Stop the clock on a todo — after you worked on it",
      description:
        "Call it when you stop working on a todo (done for now, switching to something else, pausing): Zeff records the time since todo_clock_start (waiting for the user left out) as one time record with your note — the measured difference. Then todo_clock_start again when you come back. finish_todo stops it by itself.",
      inputSchema: z.object({
        todo: z.string().min(1).describe("The todo, e.g. 'T-12'."),
        note: z.string().optional().describe("What was done in that time, ONE short line (<80 chars)."),
        agent: z.string().optional().describe("Who you are, as at todo_clock_start."),
        log: SESSION_LOG,
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
        const { clockOut } = await import("@/lib/work/todo-clock");
        const r = clockOut(todo.id, args.agent, { note: args.note, log: args.log });
        if (!r) return fail(`No clock runs on ${todo.ref}${args.agent ? ` for ${args.agent}` : ""} — start it with todo_clock_start before you work on it.`);
        return ok(`Clock stopped on ${todo.ref}: ${r.minutes} min recorded${r.record ? ` (${r.record.ref})` : ""}${args.log ? ` — the clock measured ${r.measured} min, your log gives ${r.logged} min` : ""}. Start it again with todo_clock_start when you go on.`);
      }),
  );

  server.registerTool(
    "todo_clock_ping",
    {
      title: "Keep a todo's clock running — a sign of life, at least every 10 minutes",
      description:
        "While you work on a todo with its clock running (start_todo, todo_clock_start), call it AT LEAST EVERY 10 MINUTES — between steps, before and after a long command. A clock that hears nothing for 10 minutes is paused as of your last ping (the time after it isn't booked); this ping lets it go on from now. todo_progress and todo_time count as pings too.",
      inputSchema: z.object({
        todo: z.string().min(1).describe("The todo, e.g. 'T-12'."),
        agent: z.string().optional().describe("Who you are, as at todo_clock_start."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const off = pluginOff("work");
        if (off) return off;
        const id = parseTodoRef(args.todo);
        const todo = id === null ? undefined : getTodo(id);
        if (!todo) return fail(`"${args.todo}" isn't a todo — list_todos shows them (T-12).`);
        const { clockPing } = await import("@/lib/work/todo-clock");
        const r = clockPing(todo.id, args.agent);
        if (!r) return fail(`No clock runs on ${todo.ref}${args.agent ? ` for ${args.agent}` : ""} — start it with todo_clock_start.`);
        return ok(
          r.waiting
            ? `${todo.ref}'s clock is paused while it waits for the user's answer — todo_progress when you go on.`
            : `${todo.ref}: clock running, ${Math.round(r.minutes)} min so far.${r.resumedAfter !== null ? ` It had paused — silent for more than 10 minutes; ${r.resumedAfter} min weren't counted. Ping at least every 10 minutes.` : " Next ping within 10 minutes."}`,
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
        // Waiting for the user doesn't count: its clock pauses until you go on (todo_progress).
        const id = parseTodoRef(args.todo);
        const paused = id === null ? 0 : (await import("@/lib/work/todo-clock")).clockPause(id);
        return ok(`Marked ❗ on W-${r.id} — now ask the user. Call todo_progress once you go on.${paused ? " The clock is paused till then." : ""}`);
      }),
  );
}
