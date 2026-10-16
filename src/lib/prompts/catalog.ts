import type { ContextStepId } from "@/lib/boards/context-prefs-shared";

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

export const PROMPT_GROUPS = ["Todos & Lage", "Mail", "Knowledge", "Notes", "Documents", "People", "Workspace", "LLM & Workers"] as const;

export const PROMPTS: PromptEntry[] = [
  { key: "ticket-lage", group: "Todos & Lage", title: "Ticket-Lage", uses: "The Ticket-Lage: each ticket's attention, lead, summary, todos", plugin: "todos", step: "lage", builtIn: async () => (await import("@/lib/boards/collect")).INSTRUCTIONS },
  { key: "ticket-questions", group: "Todos & Lage", title: "Questions about tickets", uses: "The answers to the briefing's possible questions", plugin: "todos", builtIn: async () => (await import("@/lib/boards/questions")).INSTRUCTIONS },
  { key: "ticket-chat", group: "Todos & Lage", title: "Ticket chat", uses: "The chat about a ticket", plugin: "todos", builtIn: async () => (await import("@/lib/boards/ticket-chat")).INSTRUCTIONS },
  { key: "recap", group: "Todos & Lage", title: "Day recap", uses: "What you did on a day — for the standup", plugin: "todos", vars: ["me", "date"], builtIn: async () => (await import("@/lib/boards/recap")).RECAP_INSTRUCTIONS },
  { key: "auto-actions", group: "Todos & Lage", title: "Auto-actions", uses: "Actions for the open todos — one click each", plugin: "auto-actions", step: "autoactions", vars: ["me", "today"], builtIn: async () => (await import("@/plugins/auto-actions/review")).INSTRUCTIONS },
  { key: "reply-draft", group: "Mail", title: "Reply drafts", uses: "Your reply to a mail or chat, drafted", plugin: "todos", step: "replies", vars: ["channel"], builtIn: async () => (await import("@/lib/boards/reply-draft")).INSTRUCTIONS },
  { key: "mail-todos", group: "Mail", title: "Mail review", uses: "Todos from new mails (and WhatsApp chats)", plugin: "todos", step: "mailtodos", builtIn: async () => (await import("@/lib/boards/mail-todos")).INSTRUCTIONS },
  { key: "mail-signal", group: "Mail", title: "Mail review: Signal", uses: "Added to the mail review when Signal chats are among the mails", plugin: "todos", builtIn: async () => (await import("@/lib/boards/mail-todos")).SIGNAL_NOTE },
  { key: "mail-relations", group: "Mail", title: "Mails to todos", uses: "Which mails belong to which open todo", plugin: "todos", step: "relations", builtIn: async () => (await import("@/lib/boards/mail-relations")).INSTRUCTIONS },
  { key: "knowledge-relations", group: "Knowledge", title: "Knowledge to todos", uses: "Which knowledge belongs to which open todo", plugin: "knowledge", step: "knowledge", builtIn: async () => (await import("@/plugins/knowledge/relations")).INSTRUCTIONS },
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
  { key: "note-review", group: "Notes", title: "Note review", uses: "Todos from your notes (Google Keep, note boards)", plugin: "keep", builtIn: async () => (await import("@/plugins/keep/note-review")).INSTRUCTIONS },
  { key: "note-relations", group: "Notes", title: "Notes to todos", uses: "Which notes belong to which open todo", plugin: "keep", builtIn: async () => (await import("@/plugins/keep/note-relations")).INSTRUCTIONS },
  { key: "doc-review", group: "Documents", title: "Document review", uses: "Todos from your documents", plugin: "documents", builtIn: async () => (await import("@/plugins/documents/review")).INSTRUCTIONS },
  { key: "doc-relations", group: "Documents", title: "Documents to todos", uses: "Which documents belong to which open todo", plugin: "documents", builtIn: async () => (await import("@/plugins/documents/relations")).INSTRUCTIONS },
  { key: "people-normalize", group: "People", title: "One identity per person", uses: "People profiles kept to one identity each", plugin: "people", builtIn: async () => (await import("@/plugins/people/normalize")).INSTRUCTIONS },
  { key: "people-import", group: "People", title: "People from your context", uses: "The people you deal with, from the last days", plugin: "people", builtIn: async () => (await import("@/plugins/people/import")).INSTRUCTIONS },
  { key: "people-extract", group: "People", title: "Facts about people", uses: "What new messages say about people", plugin: "people", builtIn: async () => (await import("@/plugins/people/extract")).INSTRUCTIONS },
  { key: "people-compile", group: "People", title: "Person overview", uses: "A person's short overview", plugin: "people", builtIn: async () => (await import("@/plugins/people/compile")).INSTRUCTIONS },
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
