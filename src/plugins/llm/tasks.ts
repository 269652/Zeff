/**
 * The LLM plugin's tasks — what Zeff has an AI do, as building blocks the other plugins call:
 * each its own backend and model (or the default), all with your instructions and context.
 * Client-safe.
 */

export const LLM_TASKS = [
  { id: "ticket-lage", label: "Ticket-Lage", what: "Liest deine Tickets — Jira und deine Kanban-Karten (KB-…) — mit allem Kontext und macht die Lage und die Todos." },
  { id: "board-lage", label: "Board-Lage", what: "Schätzt die Lage aller aktuellen Tickets deiner Jira-Boards ein (für die Kanban-Karten) — ohne Todos." },
  { id: "recap", label: "Recap", what: "Fasst einen Tag zusammen: was du getan hast." },
  { id: "mail-todos", label: "Mail-Durchsicht", what: "Findet in neuen Mails, was du zu tun hast." },
  { id: "mail-relations", label: "Mail-Zuordnung", what: "Ordnet jedem Todo die Mails zu, um die es geht." },
  { id: "note-todos", label: "Notiz-Durchsicht", what: "Findet in neuen und geänderten Notizen (Google Keep, deine Keep-Boards), was du zu tun hast." },
  { id: "note-relations", label: "Notiz-Zuordnung", what: "Ordnet jedem Todo die Notizen zu, um die es geht." },
  { id: "knowledge-relations", label: "Wissens-Zuordnung", what: "Wählt aus den Treffern der Wissensbasis, was zu jedem Todo wirklich passt." },
  { id: "reply-draft", label: "Antwort-Entwurf", what: "Schreibt die Antwort auf eine Nachricht (WhatsApp, Mail, Teams), um die es in einem Todo geht — aus dem Verlauf." },
  { id: "auto-actions", label: "Auto-Aktionen", what: "Macht aus Todos fertige Aktionen (Nachricht, Kommentar, Mail, Termin, Übergabe)." },
  { id: "worker", label: "Worker", what: "Arbeitet an einem Todo (Work-Tab, ✨ An Copilot) — im Repo, mit Werkzeugen." },
  { id: "general", label: "Sonstiges", what: "Alles andere (z. B. der Verbindungstest)." },
] as const;

export type LlmTaskId = (typeof LLM_TASKS)[number]["id"];
export const isLlmTask = (v: unknown): v is LlmTaskId => LLM_TASKS.some((t) => t.id === v);

/** A task's own backend and model ("" = the default). */
export type LlmTaskSetting = { provider?: "" | "copilot" | "claude"; model?: string };

export type LlmSettings = {
  /** What goes with every prompt and to every agent: how to work, what never to do. */
  instructions: string;
  /** Who you are, what you work on — the background every task gets. */
  context: string;
  tasks: Partial<Record<LlmTaskId, LlmTaskSetting>>;
};

export const EMPTY_LLM_SETTINGS: LlmSettings = { instructions: "", context: "", tasks: {} };

/** At most this much of instructions and context goes with a prompt (Copilot takes it on the command line). */
export const LLM_PREAMBLE_MAX = 2500;
