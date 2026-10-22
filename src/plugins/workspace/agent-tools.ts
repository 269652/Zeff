import type { Permissions } from "./routines";

/**
 * What an agent routine's worker may use of Zeff's tools beyond the pages (those follow its scope): groups of tools, each on or off in
 * the routine's permissions. A group says what it does in words; `default` is how an agent is without a choice (what it could do
 * before, except where a tool writes to another system). Pure — the settings and the MCP server both read it.
 */
export type ToolGroup = { id: string; label: string; hint: string; tools: string[]; default: boolean };

export const AGENT_TOOL_GROUPS: ToolGroup[] = [
  { id: "todos.read", label: "Read todos", hint: "List todos and read their context and attachments", tools: ["list_todos", "todo_context", "todo_attachment"], default: true },
  { id: "todos.work", label: "Work on todos", hint: "Start, report progress and time on, ask about, and finish todos", tools: ["start_todo", "todo_progress", "todo_time", "todo_needs_input", "finish_todo", "complete_todo", "add_todo", "todo_note"], default: true },
  { id: "knowledge.read", label: "Search what Zeff knows", hint: "The knowledge base, mails, messages and notes", tools: ["search_knowledge", "search_context", "zeff_actions", "source_health"], default: true },
  { id: "knowledge.write", label: "Write to the knowledge base", hint: "Add what it learned as knowledge", tools: ["add_knowledge"], default: true },
  { id: "time.read", label: "Read jobs and time entries", hint: "Jobs, projects, the weekly report and booked time (booking stays closed to agents)", tools: ["list_jobs", "list_projects", "get_weekly_report", "list_time_entries"], default: true },
  { id: "merge.read", label: "Read merge-request comments", hint: "Comments and discussions on a merge request", tools: ["mr_comments"], default: true },
  { id: "merge.write", label: "Comment on merge requests", hint: "Comment, reply and resolve on GitLab — it leaves Zeff", tools: ["mr_comment", "mr_reply", "mr_resolve"], default: false },
  { id: "web", label: "Search and read the web", hint: "Web search and fetching pages", tools: ["web_search", "web_fetch"], default: true },
  { id: "gmail.read", label: "Search Gmail", hint: "Find mails with Gmail's search, list its labels and filters", tools: ["gmail_find", "gmail_labels", "gmail_filters"], default: true },
];

const BY_TOOL = new Map(AGENT_TOOL_GROUPS.flatMap((g) => g.tools.map((t) => [t, g] as const)));
export const toolGroupOf = (tool: string): ToolGroup | undefined => BY_TOOL.get(tool);
export const isToolGroup = (id: string): boolean => AGENT_TOOL_GROUPS.some((g) => g.id === id);

/** Whether a worker with these permissions may use the tool: its group's choice, else the group's default; no group: left alone. */
export function toolsAllowed(p: Pick<Permissions, "tools">, tool: string): boolean {
  const g = BY_TOOL.get(tool);
  return g ? (p.tools?.[g.id] ?? g.default) : true;
}
