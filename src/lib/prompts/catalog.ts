import type { ContextStepId } from "@/lib/runs/context-prefs-shared";

/**
 * Every prompt Zeff uses, as the Workspace shows it (System → Prompts → its group): its key (what the code reads it by),
 * its title, what uses it, the plugin it belongs to (none installed: no page), the built-in text (loaded when its page is
 * made or reset), and what the settings had for it before (moved into its page once): a step's own instructions
 * ("Meine Anweisungen", added below the built-in text), or the setting's text itself.
 */
export type PromptEntry = {
  key: string;
  group: string;
  title: string;
  uses: string;
  plugin?: string;
  builtIn: () => Promise<string>;
  /** The step whose own instructions go into the page (below the built-in text) — and aren't added on top any more. */
  step?: ContextStepId;
  /** What the settings had (instead of the built-in text) — into the page when it's made. */
  setting?: () => Promise<string>;
  /** The placeholders its text may hold ({{name}}), filled in by the code. */
  vars?: string[];
};

export const PROMPT_GROUPS = ["Todos & Lage", "Mail", "Knowledge", "Notes", "Documents", "People", "News", "Workspace", "LLM & Workers"] as const;

export const PROMPTS: PromptEntry[] = [
  { key: "ticket-lage", group: "Todos & Lage", title: "Ticket-Lage", uses: "The Ticket-Lage: each ticket's attention, lead, summary, todos", plugin: "todos", step: "lage", builtIn: async () => (await import("@/lib/runs/collect")).INSTRUCTIONS },
  { key: "ticket-questions", group: "Todos & Lage", title: "Questions about tickets", uses: "The answers to the briefing's possible questions", plugin: "todos", builtIn: async () => (await import("@/lib/runs/questions")).INSTRUCTIONS },
  { key: "ticket-chat", group: "Todos & Lage", title: "Ticket chat", uses: "The chat about a ticket", plugin: "todos", builtIn: async () => (await import("@/lib/runs/ticket-chat")).INSTRUCTIONS },
  { key: "recap", group: "Todos & Lage", title: "Day recap", uses: "What you did on a day — for the standup", plugin: "todos", vars: ["me", "date"], builtIn: async () => (await import("@/lib/runs/recap")).RECAP_INSTRUCTIONS },
  { key: "auto-actions", group: "Todos & Lage", title: "Auto-actions", uses: "Actions for the open todos — one click each", plugin: "auto-actions", step: "autoactions", vars: ["me", "today"], builtIn: async () => (await import("@/plugins/auto-actions/review")).INSTRUCTIONS },
  { key: "repeat-text", group: "Todos & Lage", title: "Repeat wording", uses: "The words a repeating todo's next ones carry (a rate without “first”, “now”)", plugin: "todos", builtIn: async () => (await import("@/lib/todos/repeat-text-ai")).INSTRUCTIONS },
  { key: "day-plan", group: "Todos & Lage", title: "Day plan", uses: "Today's todos as time blocks around your appointments (Today → Plan my day)", plugin: "todos", builtIn: async () => (await import("@/lib/heute-plan")).INSTRUCTIONS },
  { key: "calendar-todos", group: "Todos & Lage", title: "Appointments to todos", uses: "Which of today's and tomorrow's appointments give you something to do (a blocker like “Pause” doesn't)", plugin: "calendar", builtIn: async () => (await import("@/lib/calendar/todos")).INSTRUCTIONS },
  { key: "reply-draft", group: "Mail", title: "Reply drafts", uses: "Your reply to a mail or chat, drafted", plugin: "todos", step: "replies", vars: ["channel"], builtIn: async () => (await import("@/lib/todos/reply-draft")).INSTRUCTIONS },
  { key: "mail-todos", group: "Mail", title: "Mail review", uses: "Todos from new mails (and WhatsApp chats)", plugin: "todos", step: "mailtodos", builtIn: async () => (await import("@/lib/todos/mail-todos")).INSTRUCTIONS },
  { key: "mail-signal", group: "Mail", title: "Mail review: Signal", uses: "Added to the mail review when Signal chats are among the mails", plugin: "todos", builtIn: async () => (await import("@/lib/todos/mail-todos")).SIGNAL_NOTE },
  { key: "mail-relations", group: "Mail", title: "Mails to todos", uses: "Which mails belong to which open todo", plugin: "todos", step: "relations", builtIn: async () => (await import("@/lib/todos/mail-relations")).INSTRUCTIONS },
  { key: "knowledge-relations", group: "Knowledge", title: "Knowledge to todos", uses: "Which knowledge belongs to which open todo", plugin: "knowledge", step: "knowledge", builtIn: async () => (await import("@/plugins/knowledge/relations")).INSTRUCTIONS },
  { key: "questions-plan", group: "Knowledge", title: "Structured questions: the query", uses: "Whether a question is about your data, and the query over it", plugin: "questions", builtIn: async () => (await import("@/plugins/questions/ask")).PLAN_INSTRUCTIONS },
  { key: "questions-answer", group: "Knowledge", title: "Structured questions: the answer", uses: "The answer phrased from the query's numbers", plugin: "questions", builtIn: async () => (await import("@/plugins/questions/ask")).ANSWER_INSTRUCTIONS },
  {
    key: "repo-pick",
    group: "Knowledge",
    title: "Repo summary: the systems",
    uses: "A repo's summary, first step: the addresses of its systems",
    plugin: "knowledge",
    builtIn: async () => (await import("@/plugins/knowledge/repo-prompt")).DEFAULT_PICK_PROMPT,
    setting: async () => (await import("@/plugins/knowledge/repo-systems-store")).getPickPrompt(),
  },
  { key: "repo-summary", group: "Knowledge", title: "Repo summary: the description", uses: "A repo's summary, second step: its description", plugin: "knowledge", builtIn: async () => (await import("@/plugins/knowledge/repo-systems")).SUMMARY_INSTRUCTIONS },
  { key: "note-review", group: "Notes", title: "Note review", uses: "Todos from your notes (Google Keep, note boards)", plugin: "workspace", builtIn: async () => (await import("@/plugins/keep/note-review")).INSTRUCTIONS },
  { key: "note-relations", group: "Notes", title: "Notes to todos", uses: "Which notes belong to which open todo", plugin: "workspace", builtIn: async () => (await import("@/plugins/keep/note-relations")).INSTRUCTIONS },
  { key: "doc-review", group: "Documents", title: "Document review", uses: "Todos from your documents", plugin: "documents", builtIn: async () => (await import("@/plugins/documents/review")).INSTRUCTIONS },
  { key: "doc-relations", group: "Documents", title: "Documents to todos", uses: "Which documents belong to which open todo", plugin: "documents", builtIn: async () => (await import("@/plugins/documents/relations")).INSTRUCTIONS },
  { key: "people-normalize", group: "People", title: "One identity per person", uses: "People profiles kept to one identity each", plugin: "people", builtIn: async () => (await import("@/plugins/people/normalize")).INSTRUCTIONS },
  { key: "people-import", group: "People", title: "People from your context", uses: "The people you deal with, from the last days", plugin: "people", builtIn: async () => (await import("@/plugins/people/import")).INSTRUCTIONS },
  { key: "people-extract", group: "People", title: "Facts about people", uses: "What new messages say about people", plugin: "people", builtIn: async () => (await import("@/plugins/people/extract")).INSTRUCTIONS },
  { key: "loops-close", group: "People", title: "Open loops: kept?", uses: "Whether a message shows an open promise kept", plugin: "loops", builtIn: async () => (await import("@/plugins/loops/close")).CLOSE_INSTRUCTIONS },
  { key: "people-compile", group: "People", title: "Person overview", uses: "A person's short overview", plugin: "people", builtIn: async () => (await import("@/plugins/people/compile")).INSTRUCTIONS },
  { key: "news-digest", group: "News", title: "News: the day's digest", uses: "The overview of your unread news", plugin: "news", builtIn: async () => (await import("@/plugins/news/digest")).DIGEST_INSTRUCTIONS },
  { key: "news-ask", group: "News", title: "News: ask", uses: "A question answered from your news", plugin: "news", builtIn: async () => (await import("@/plugins/news/ask")).ASK_INSTRUCTIONS },
  { key: "news-plan", group: "News", title: "News: search plan", uses: "What to search for new news", plugin: "news", builtIn: async () => (await import("@/plugins/news/discover-job")).PLAN_INSTRUCTIONS },
  { key: "news-funnel", group: "News", title: "News: the filter (funnel)", uses: "Which new news get through to For you", plugin: "news", builtIn: async () => (await import("@/plugins/news/funnel")).FUNNEL_INSTRUCTIONS },
  { key: "news-tags", group: "News", title: "News: tags", uses: "Tags and stories of the news", plugin: "news", builtIn: async () => (await import("@/plugins/news/retag")).TAGGING_INSTRUCTIONS },
  { key: "news-similar", group: "News", title: "News: more like this", uses: "More of what you read", plugin: "news", builtIn: async () => (await import("@/plugins/news/similar")).SIMILAR_INSTRUCTIONS },
  { key: "news-taste", group: "News", title: "News: your taste", uses: "The description of what you like to read", plugin: "news", builtIn: async () => (await import("@/plugins/news/taste")).TASTE_INSTRUCTIONS },
  { key: "news-outlets", group: "News", title: "News: sources", uses: "News sources for a topic", plugin: "news", vars: ["topic"], builtIn: async () => (await import("@/plugins/news/finder")).OUTLET_INSTRUCTIONS },
  { key: "todo-refresh", group: "Todos & Lage", title: "One todo brought up to date", uses: "A todo re-read after you wrote a note on it", plugin: "todos", vars: ["attachments", "today"], builtIn: async () => (await import("@/lib/todos/refresh")).TODO_REFRESH_INSTRUCTIONS },
  { key: "rag", group: "Todos & Lage", title: "Asking for more context", uses: "Added to the steps that may ask Zeff to search (ticket chat, todo refresh)", builtIn: async () => (await import("@/lib/rag")).RAG_INSTRUCTIONS },
  { key: "people-dates", group: "People", title: "A person's dates", uses: "Birthdays and anniversaries of a person, found", plugin: "people", vars: ["name", "aliases"], builtIn: async () => (await import("@/plugins/people/dates")).PEOPLE_DATES_INSTRUCTIONS },
  { key: "know-summary", group: "People", title: "What you should know", uses: "The few points before a meeting or beside a mail, chat, ticket or person", plugin: "know", vars: ["what"], builtIn: async () => (await import("@/plugins/know/summary")).KNOW_SUMMARY_INSTRUCTIONS },
  { key: "doc-read", group: "Documents", title: "Reading a file", uses: "A file (PDF, image) read into text by the AI", plugin: "documents", vars: ["file"], builtIn: async () => (await import("@/plugins/documents/extract")).DOC_READ_INSTRUCTIONS },
  { key: "worker-rules", group: "LLM & Workers", title: "Worker rules", uses: "Every worker's ground rules (the house rules and the actions come after them)", plugin: "work", vars: ["head", "live", "end"], builtIn: async () => (await import("@/lib/work/brief")).WORKER_RULES },
  { key: "mcp", group: "LLM & Workers", title: "Agents over MCP", uses: "What an agent connected to Zeff over MCP is told first", builtIn: async () => (await import("@/mcp/server")).INSTRUCTIONS },
  { key: "workspace-agent", group: "Workspace", title: "Workspace assistant", uses: "The assistant in the Workspace's sidebar", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/agent")).INSTRUCTIONS },
  { key: "editor-ai", group: "Workspace", title: "Editor: writing with AI", uses: "Around every ✨ action in the editor", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).EDITOR_AI },
  { key: "editor-summarize", group: "Workspace", title: "Editor: Summarize", uses: "The editor's ✨ menu", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).AI_MODES.summarize },
  { key: "editor-continue", group: "Workspace", title: "Editor: Continue writing", uses: "The editor's ✨ menu", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).AI_MODES.continue },
  { key: "editor-improve", group: "Workspace", title: "Editor: Improve", uses: "The editor's ✨ menu", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).AI_MODES.improve },
  { key: "editor-fix", group: "Workspace", title: "Editor: Fix spelling", uses: "The editor's ✨ menu", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).AI_MODES.fix },
  { key: "editor-shorter", group: "Workspace", title: "Editor: Shorter", uses: "The editor's ✨ menu", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).AI_MODES.shorter },
  { key: "editor-longer", group: "Workspace", title: "Editor: Longer", uses: "The editor's ✨ menu", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).AI_MODES.longer },
  { key: "editor-explain", group: "Workspace", title: "Editor: Explain", uses: "The editor's ✨ menu", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).AI_MODES.explain },
  { key: "editor-translate_en", group: "Workspace", title: "Editor: Translate to English", uses: "The editor's ✨ menu", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).AI_MODES.translate_en },
  { key: "editor-translate_de", group: "Workspace", title: "Editor: Translate to German", uses: "The editor's ✨ menu", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).AI_MODES.translate_de },
  { key: "editor-translate_es", group: "Workspace", title: "Editor: Translate to Spanish", uses: "The editor's ✨ menu", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).AI_MODES.translate_es },
  { key: "editor-actions", group: "Workspace", title: "Editor: Action items", uses: "The editor's ✨ menu", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).AI_MODES.actions },
  { key: "ai-review", group: "Workspace", title: "AI review of a database", uses: "The AI fields of a database filled for the rows that changed (pipelines, boards)", plugin: "workspace", vars: ["fields"], builtIn: async () => (await import("@/plugins/workspace/review")).AI_REVIEW },
  { key: "ai-block", group: "Workspace", title: "AI block", uses: "An AI block written on a page", plugin: "workspace", vars: ["instruction", "today"], builtIn: async () => (await import("@/plugins/workspace/ai-block")).AI_BLOCK },
  { key: "pipeline-summary", group: "Workspace", title: "Pipeline summary", uses: "A pipeline's summary over all rows", plugin: "workspace", vars: ["instruction", "today"], builtIn: async () => (await import("@/plugins/workspace/pipeline")).PIPELINE_SUMMARY },
  { key: "ai-filter", group: "Workspace", title: "AI filter", uses: "A pipeline's AI filter: which rows stay", plugin: "workspace", vars: ["instruction"], builtIn: async () => (await import("@/plugins/workspace/pipeline")).AI_FILTER },
  { key: "row-actions", group: "Workspace", title: "Suggested actions", uses: "A pipeline's AI step that suggests actions for each row", plugin: "workspace", vars: ["instruction"], builtIn: async () => (await import("@/plugins/workspace/pipeline")).ROW_ACTIONS },
  { key: "page-todos", group: "Workspace", title: "Todos from a page", uses: "A page made into your todos", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).PAGE_TODOS },
  { key: "workspace-ask", group: "Workspace", title: "Ask the Workspace", uses: "A question answered from your pages", plugin: "workspace", builtIn: async () => (await import("@/plugins/workspace/prompts")).WORKSPACE_ASK },
  { key: "ai-field", group: "Workspace", title: "AI field, one row", uses: "An AI field filled for one row by hand", plugin: "workspace", vars: ["field", "instruction"], builtIn: async () => (await import("@/plugins/workspace/prompts")).AI_FIELD },
  {
    key: "llm-instructions",
    group: "LLM & Workers",
    title: "General instructions",
    uses: "In front of every AI task, every worker and agent — they go before the other rules",
    plugin: "llm",
    builtIn: async () => "",
    setting: async () => (await import("@/plugins/llm/settings")).getLlmSettings().instructions,
  },
  {
    key: "llm-context",
    group: "LLM & Workers",
    title: "Context about you",
    uses: "In front of every AI task, every worker and agent",
    plugin: "llm",
    builtIn: async () => "",
    setting: async () => (await import("@/plugins/llm/settings")).getLlmSettings().context,
  },
  {
    key: "work-rules",
    group: "LLM & Workers",
    title: "House rules for every worker",
    uses: "Added to every worker's rules",
    plugin: "work",
    builtIn: async () => "",
    setting: async () => (await import("@/lib/ai")).getAppSettings().workInstructions ?? "",
  },
];
