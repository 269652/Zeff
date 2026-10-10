/**
 * The Auswerten settings (client-safe): for each AI step of the evaluation, what goes into its
 * context — which sources, how far back, how much — and instructions of your own. Sources a
 * plugin brings show only while it's installed.
 */
import type { PluginId } from "@/plugins/catalog";

/** `plugin`: shown while it (or, a list, any of them) is installed. */
export type ContextSource = { key: string; label: string; what?: string; plugin?: PluginId | PluginId[]; default: boolean };
export type ContextNumber = { key: string; label: string; min: number; max: number; default: number; unit?: string };
export type ContextStep = { id: ContextStepId; label: string; what: string; plugin?: PluginId; sources: ContextSource[]; numbers: ContextNumber[] };

export const CONTEXT_STEP_IDS = ["presync", "lage", "mailtodos", "relations", "knowledge", "autoactions", "replies"] as const;
export type ContextStepId = (typeof CONTEXT_STEP_IDS)[number];

export const CONTEXT_STEPS: ContextStep[] = [
  {
    id: "presync",
    label: "Sync first",
    what: "What a briefing run started by hand reads fresh first. Everything else comes from the last sync (it runs in the background anyway) — that way the run is faster.",
    plugin: "todos",
    sources: [
      { key: "jira", label: "Jira", what: "Tickets, status, comments", plugin: "jira", default: true },
      { key: "teams", label: "Teams", plugin: "teams", default: true },
      { key: "mail", label: "Mails", what: "Outlook, Gmail", plugin: ["outlook-mail", "gmail"], default: true },
      { key: "whatsapp", label: "WhatsApp", plugin: "whatsapp", default: true },
      { key: "keep", label: "Keep", plugin: "keep", default: false },
      { key: "gitlab", label: "GitLab", plugin: "gitlab", default: false },
      { key: "calendar", label: "Calendar", plugin: "outlook-calendar", default: false },
    ],
    numbers: [{ key: "maxAge", label: "Only when the last sync is older than", min: 0, max: 240, default: 0, unit: "minutes (0: always)" }],
  },
  {
    id: "lage",
    label: "Briefing",
    what: "Reads each ticket with everything Zeff knows about it, and writes the briefing and the todos.",
    plugin: "todos",
    sources: [
      { key: "zeff", label: "Zeff entries and context", what: "Your entries and the context gathered on the ticket", default: true },
      { key: "teams", label: "Teams chats", what: "The chats of the last days — agreements, promises, requests", plugin: "teams", default: true },
      { key: "mail", label: "Mails", what: "Mails (Outlook, Gmail) that name the ticket", default: true },
      { key: "whatsapp", label: "WhatsApp", what: "WhatsApp messages that name the ticket", plugin: "whatsapp", default: true },
      { key: "gitlab", label: "GitLab", what: "Merge requests and comments on the ticket", plugin: "gitlab", default: true },
      { key: "git", label: "Git", what: "Branches and commits in the ticket's repos", default: true },
      { key: "related", label: "Related tickets", what: "Tickets it mentions (or that mention it), with their new comments", default: true },
      { key: "keep", label: "Notes (Keep)", what: "Your notes on the ticket", plugin: "keep", default: true },
    ],
    numbers: [
      { key: "chatDays", label: "Teams chats from the last", min: 1, max: 30, default: 3, unit: "days" },
      { key: "mailDays", label: "Mails and messages from the last", min: 3, max: 120, default: 60, unit: "days" },
      { key: "comments", label: "Comments per ticket, at most", min: 3, max: 40, default: 12 },
    ],
  },
  {
    id: "mailtodos",
    label: "Mail review",
    what: "Goes through new mails and messages and turns what they ask of you into todos.",
    plugin: "todos",
    sources: [
      { key: "mail", label: "Mails", what: "Outlook and Gmail", default: true },
      { key: "whatsapp", label: "WhatsApp", plugin: "whatsapp", default: true },
      { key: "keep", label: "Notes (Keep)", plugin: "keep", default: true },
    ],
    numbers: [
      { key: "days", label: "New ones from the last", min: 1, max: 60, default: 14, unit: "days" },
      { key: "chatDays", label: "Unanswered WhatsApp chats from the last", min: 7, max: 120, default: 45, unit: "days" },
    ],
  },
  {
    id: "relations",
    label: "Mail matching",
    what: "Matches each open todo with the mails it's about (by content).",
    plugin: "todos",
    sources: [],
    numbers: [
      { key: "days", label: "Mails from the last", min: 7, max: 120, default: 60, unit: "days" },
      { key: "perTicket", label: "Mails per ticket, at most", min: 5, max: 60, default: 30 },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge matching",
    what: "Checks the knowledge base's hits for each new or changed todo and keeps only what really fits.",
    plugin: "knowledge",
    sources: [],
    numbers: [
      { key: "candidates", label: "Hits per todo the AI checks", min: 3, max: 20, default: 8 },
      { key: "maxTodos", label: "Todos per run, at most", min: 5, max: 200, default: 40 },
    ],
  },
  {
    id: "autoactions",
    label: "Auto actions",
    what: "Turns todos without a button into ready actions (message, comment, mail, meeting).",
    plugin: "auto-actions",
    sources: [],
    numbers: [],
  },
  {
    id: "replies",
    label: "Reply drafts",
    what: "Writes the reply to a todo's message from the conversation.",
    plugin: "todos",
    sources: [],
    numbers: [{ key: "messages", label: "Messages from the conversation", min: 3, max: 60, default: 25 }],
  },
];

/** A step's settings: its sources on or off, its numbers, your instructions for it. */
export type StepPrefs = { sources: Record<string, boolean>; numbers: Record<string, number>; extra: string };
export type ContextPrefs = Record<ContextStepId, StepPrefs>;

/** The defaults, filled in where nothing is set. */
export function withDefaults(saved: Partial<Record<string, Partial<StepPrefs>>>): ContextPrefs {
  return Object.fromEntries(
    CONTEXT_STEPS.map((s) => {
      const p = saved[s.id] ?? {};
      return [
        s.id,
        {
          sources: Object.fromEntries(s.sources.map((x) => [x.key, typeof p.sources?.[x.key] === "boolean" ? p.sources[x.key] : x.default])),
          numbers: Object.fromEntries(s.numbers.map((n) => [n.key, typeof p.numbers?.[n.key] === "number" ? Math.min(n.max, Math.max(n.min, p.numbers[n.key])) : n.default])),
          extra: typeof p.extra === "string" ? p.extra : "",
        },
      ];
    }),
  ) as ContextPrefs;
}

/** Whether a source shows: no plugin, or its plugin (one of them) installed. */
export const sourceShown = (s: ContextSource, installed: Iterable<string>) => {
  const on = new Set(installed);
  return !s.plugin || (Array.isArray(s.plugin) ? s.plugin.some((p) => on.has(p)) : on.has(s.plugin));
};

/** The syncs "Jetzt auswerten" runs first, in this order (the keys of the presync step). */
export const PRESYNC_ORDER = ["teams", "jira", "mail", "whatsapp", "keep", "gitlab", "calendar"] as const;
