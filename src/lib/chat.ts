/**
 * The chat (/chat — the phone's second main screen): you talk to a live Claude agent that works in Zeff itself, through
 * Zeff's own MCP server — your todos, notes, the Workspace, mail and chats to search — and nowhere else: no shell, no
 * files to edit, no repo. A chat is a Work session underneath (src/lib/work/runner.ts) on a todo of its own, marked by
 * its source (CHAT_SOURCE): the runner gives it the chat's rules and tools, the MCP server your clearance (it's you
 * asking), and Work's lists leave it out.
 */
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TodoView } from "@/lib/todos/shared";

/** The source of a chat's own todo — what makes a Work session a chat. */
export const CHAT_SOURCE = "Zeff-Chat";

/** A plugin's kind of chat (the Learn plugin's lessons: "learn") — its todos' source. */
export const chatSource = (kind: string) => `${CHAT_SOURCE}:${kind}`;

/** Whether a todo is a chat's: the plain chat's, or a plugin's kind of chat (its own rules and tools: registerChatProfile). */
export const isChatTodo = (todo: Pick<TodoView, "source"> | null | undefined): boolean => !!todo?.source && (todo.source === CHAT_SOURCE || todo.source.startsWith(`${CHAT_SOURCE}:`));

/** What a chat's agent is told and may use. */
export type ChatProfile = { rules: string; allowedTools: string[]; disallowedTools: string[] };
type ProfileFn = (todo: Pick<TodoView, "id" | "source" | "text">, preamble: string) => ChatProfile;
const profiles = ((globalThis as { __zeffChatProfiles?: Map<string, ProfileFn> }).__zeffChatProfiles ??= new Map<string, ProfileFn>());

/** A plugin's kind of chat: its rules and tools (registered from its server.ts). */
export const registerChatProfile = (kind: string, fn: ProfileFn) => void profiles.set(kind, fn);

/** A chat's profile: its kind's (a plugin's), else the plain chat's. `preamble`: your own instructions for every agent. */
export function chatProfileFor(todo: Pick<TodoView, "id" | "source" | "text">, preamble: string): ChatProfile {
  const kind = todo.source?.startsWith(`${CHAT_SOURCE}:`) ? todo.source.slice(CHAT_SOURCE.length + 1) : "";
  const fn = kind ? profiles.get(kind) : undefined;
  return fn ? fn(todo, preamble) : { rules: chatRules(preamble), allowedTools: CHAT_ALLOWED_TOOLS, disallowedTools: CHAT_DISALLOWED_TOOLS };
}

const zeff = (names: string[]) => names.map((n) => `mcp__zeff__${n}`);

/**
 * The Zeff tools a chat uses without asking: reading, searching, writing into Zeff (todos, notes, pages, rows). What
 * acts outside Zeff — replies in GitLab under your name, Gmail filters and changes, archiving mail, running routines,
 * opening the automation browser — isn't here: the agent asks, and you answer on the phone.
 */
export const CHAT_ALLOWED_TOOLS = zeff([
  "list_todos",
  "add_todo",
  "complete_todo",
  "finish_todo",
  "todo_note",
  "todo_context",
  "todo_progress",
  "todo_needs_input",
  "todo_attachment",
  "ticket_brief",
  "search_knowledge",
  "search_context",
  "add_knowledge",
  "source_health",
  "zeff_actions",
  "gmail_find",
  "gmail_labels",
  "gmail_filters",
  "mailbox_inbox",
  "mr_comments",
  "workspace_search",
  "workspace_read_page",
  "workspace_create_page",
  "workspace_append",
  "workspace_update_page",
  "workspace_query_database",
  "workspace_add_row",
  "workspace_add_row_from_url",
  "workspace_ask_database",
  "workspace_database_dossier",
  "workspace_tickets_for_me",
  "workspace_board_filter",
  "workspace_routines",
  "workspace_routine_runs",
  "web_search",
  "web_fetch",
  "entity_search",
  "entity_get",
  "ask_structured",
  "timeline_for",
  "timeline_since",
  "meeting_brief",
  "context_brief",
  "open_loops",
  "correlations",
  "list_jobs",
  "list_projects",
  "get_weekly_report",
  "list_time_entries",
]);

/** Claude Code's own tools a chat doesn't get: it works in Zeff, not on this computer (Read stays: pasted pictures). */
export const CHAT_DISALLOWED_TOOLS = ["Bash", "BashOutput", "KillShell", "Edit", "Write", "MultiEdit", "NotebookEdit", "Glob", "Grep", "Task", "WebFetch", "WebSearch"];

/** The chat's rules (its system prompt — the workers' prompts are German, so is this one). */
export function chatRules(extra = ""): string {
  return [
    "Du bist Zeff, der Assistent des Nutzers — er schreibt dir im Chat, meist vom Handy.",
    "Du arbeitest ausschließlich in Zeff, über Zeffs Werkzeuge (mcp__zeff__*): Todos anlegen, abhaken und kommentieren, Notizen und Seiten im Workspace schreiben, Mails, Chats, Tickets und Wissen durchsuchen, Termine und Zusammenhänge nachsehen. Du hast keine Shell und bearbeitest keine Dateien.",
    "Antworte kurz und klar, auf Deutsch, gut lesbar auf einem kleinen Bildschirm: wenige Sätze, Listen statt langer Absätze, keine Tabellen.",
    "Wenn der Nutzer etwas festhalten will, lege es an (add_todo für Aufgaben, todo_note für Notizen zu einem Todo, workspace_create_page/workspace_append für längere Notizen) und sag in einem Satz, was du angelegt hast und wo.",
    "Was nach außen wirkt (Antworten in GitLab, Mail-Filter, Archivieren, Routinen starten, Browser öffnen), tust du nur, wenn der Nutzer es will — Zeff fragt ihn dafür um Erlaubnis.",
    "Frag nach, wenn etwas unklar ist, statt zu raten. Schreib am Ende keinen JSON-Block.",
    extra,
  ]
    .filter((x) => x.trim())
    .join("\n\n");
}

/** Your chats, newest first: each its todo (id, its first words) — at most `limit`. */
export function chatTodos(limit = 50): { id: number; text: string; createdAt: string }[] {
  return getDb()
    .select({ id: schema.todos.id, text: schema.todos.text, createdAt: schema.todos.createdAt })
    .from(schema.todos)
    .where(eq(schema.todos.source, CHAT_SOURCE))
    .orderBy(desc(schema.todos.id))
    .limit(limit)
    .all();
}

/** A new chat's own todo (in the Worker tab's world: by a worker, not in your list). Not merged with a similar one. */
export function addChatTodo(firstMessage: string): number {
  const now = new Date().toISOString();
  const text = firstMessage.split("\n")[0].trim().slice(0, 200) || "Chat";
  const row = getDb()
    .insert(schema.todos)
    .values({ ticket: "", text, kind: "other", owner: "me", status: "open", source: CHAT_SOURCE, refs: "[]", runId: null, byWorker: true, createdAt: now, updatedAt: now })
    .returning({ id: schema.todos.id })
    .get();
  return row.id;
}
