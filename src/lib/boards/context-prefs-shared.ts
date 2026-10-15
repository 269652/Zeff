/**
 * The Auswerten settings (client-safe): for each AI step of the evaluation, what goes into its
 * context — which sources, how far back, how much — and instructions of your own. Sources a
 * plugin brings show only while it's installed.
 */
import type { PluginId } from "@/plugins/catalog";
import { translator, type T } from "@/lib/i18n/shared";

/** `plugin`: shown while it (or, a list, any of them) is installed. */
export type ContextSource = { key: string; label: string; what?: string; plugin?: PluginId | PluginId[]; default: boolean };
export type ContextNumber = { key: string; label: string; min: number; max: number; default: number; unit?: string };
export type ContextStep = { id: ContextStepId; label: string; what: string; plugin?: PluginId; sources: ContextSource[]; numbers: ContextNumber[] };

export const CONTEXT_STEP_IDS = ["presync", "lage", "mailtodos", "relations", "knowledge", "autoactions", "replies", "branchname"] as const;
export type ContextStepId = (typeof CONTEXT_STEP_IDS)[number];

/** The steps, their texts in a language (`t`). */
export const contextSteps = (t: T): ContextStep[] => [
  {
    id: "presync",
    label: t("Sync first"),
    what: t("What a briefing run started by hand reads fresh first. Everything else comes from the last sync (it runs in the background anyway) — that way the run is faster."),
    plugin: "todos",
    sources: [
      { key: "jira", label: "Jira", what: t("Tickets, status, comments"), plugin: "jira", default: true },
      { key: "teams", label: "Teams", plugin: "teams", default: true },
      { key: "mail", label: t("Mails"), what: "Outlook, Gmail", plugin: ["outlook-mail", "gmail"], default: true },
      { key: "whatsapp", label: "WhatsApp", plugin: "whatsapp", default: true },
      { key: "signal", label: "Signal", plugin: "signal", default: true },
      { key: "keep", label: "Keep", plugin: "keep", default: false },
      { key: "gitlab", label: "GitLab", plugin: "gitlab", default: false },
      { key: "calendar", label: t("Calendar"), plugin: "outlook-calendar", default: false },
    ],
    numbers: [{ key: "maxAge", label: t("Only when the last sync is older than"), min: 0, max: 240, default: 0, unit: t("minutes (0: always)") }],
  },
  {
    id: "lage",
    label: t("Briefing"),
    what: t("Reads each ticket with everything Zeff knows about it, and writes the briefing and the todos."),
    plugin: "todos",
    sources: [
      { key: "zeff", label: t("Zeff entries and context"), what: t("Your entries and the context gathered on the ticket"), default: true },
      { key: "teams", label: t("Teams chats"), what: t("The chats of the last days — agreements, promises, requests"), plugin: "teams", default: true },
      { key: "mail", label: t("Mails"), what: t("Mails (Outlook, Gmail) that name the ticket"), default: true },
      { key: "whatsapp", label: "WhatsApp", what: t("WhatsApp messages that name the ticket"), plugin: "whatsapp", default: true },
      { key: "signal", label: "Signal", what: t("Signal messages that name the ticket"), plugin: "signal", default: true },
      { key: "gitlab", label: "GitLab", what: t("Merge requests and comments on the ticket"), plugin: "gitlab", default: true },
      { key: "git", label: "Git", what: t("Branches and commits in the ticket's repos"), default: true },
      { key: "related", label: t("Related tickets"), what: t("Tickets it mentions (or that mention it), with their new comments"), default: true },
      { key: "keep", label: t("Notes (Keep)"), what: t("Your notes on the ticket"), plugin: "keep", default: true },
    ],
    numbers: [
      { key: "chatDays", label: t("Teams chats from the last"), min: 1, max: 30, default: 3, unit: t("days") },
      { key: "mailDays", label: t("Mails and messages from the last"), min: 3, max: 120, default: 60, unit: t("days") },
      { key: "comments", label: t("Comments per ticket, at most"), min: 3, max: 40, default: 12 },
    ],
  },
  {
    id: "mailtodos",
    label: t("Mail review"),
    what: t("Goes through new mails and messages and turns what they ask of you into todos."),
    plugin: "todos",
    sources: [
      { key: "mail", label: t("Mails"), what: t("Outlook and Gmail"), default: true },
      { key: "whatsapp", label: "WhatsApp", plugin: "whatsapp", default: true },
      { key: "signal", label: "Signal", plugin: "signal", default: true },
      { key: "keep", label: t("Notes (Keep)"), plugin: "keep", default: true },
    ],
    numbers: [
      { key: "days", label: t("New ones from the last"), min: 1, max: 60, default: 14, unit: t("days") },
      { key: "chatDays", label: t("Unanswered WhatsApp chats from the last"), min: 7, max: 120, default: 45, unit: t("days") },
    ],
  },
  {
    id: "relations",
    label: t("Mail matching"),
    what: t("Matches each open todo with the mails it's about (by content)."),
    plugin: "todos",
    sources: [],
    numbers: [
      { key: "days", label: t("Mails from the last"), min: 7, max: 120, default: 60, unit: t("days") },
      { key: "perTicket", label: t("Mails per ticket, at most"), min: 5, max: 60, default: 30 },
    ],
  },
  {
    id: "knowledge",
    label: t("Knowledge matching"),
    what: t("Checks the knowledge base's hits for each new or changed todo and keeps only what really fits."),
    plugin: "knowledge",
    sources: [],
    numbers: [
      { key: "candidates", label: t("Hits per todo the AI checks"), min: 3, max: 20, default: 8 },
      { key: "maxTodos", label: t("Todos per run, at most"), min: 5, max: 200, default: 40 },
    ],
  },
  {
    id: "autoactions",
    label: t("Auto actions"),
    what: t("Turns todos without a button into ready actions (message, comment, mail, meeting)."),
    plugin: "auto-actions",
    sources: [],
    numbers: [],
  },
  {
    id: "replies",
    label: t("Reply drafts"),
    what: t("Writes the reply to a todo's message from the conversation."),
    plugin: "todos",
    sources: [],
    numbers: [{ key: "messages", label: t("Messages from the conversation"), min: 3, max: 60, default: 25 }],
  },
  {
    id: "branchname",
    label: t("Branch names"),
    what: t("What a worker is told when it names a branch — the rules, how short the name is, and the context that goes with it. The preview below shows what a todo would get."),
    plugin: "work",
    sources: [
      { key: "rules", label: t("Rules"), what: t("What colleagues said about naming branches, with the message it comes from"), default: true },
      { key: "knowledge", label: t("Kept knowledge of the ticket"), what: t("Each todo and the messages it comes from, kept — also when the todo is done and the message is gone"), default: true },
      { key: "ticket", label: t("The Jira ticket"), what: t("Its title and status"), plugin: "jira", default: true },
      { key: "comments", label: t("Jira comments"), what: t("The newest comments on the ticket"), plugin: "jira", default: true },
      { key: "todo", label: t("The todo"), what: t("Its text and note"), default: true },
      { key: "branches", label: t("Branches already there"), what: t("The ticket's linked branches and merge requests, to keep to their style"), default: true },
    ],
    numbers: [
      { key: "maxChars", label: t("Characters after the ticket key, at most"), min: 10, max: 60, default: 24 },
      { key: "words", label: t("Words in the short name, at most"), min: 1, max: 6, default: 3 },
      { key: "artifacts", label: t("Kept todos of the ticket, at most"), min: 1, max: 12, default: 6 },
      { key: "comments", label: t("Jira comments, at most"), min: 1, max: 10, default: 3 },
    ],
  },
];

/** The steps in English — for what only needs their ids, sources and numbers (the pages show `contextSteps(t)`). */
export const CONTEXT_STEPS: ContextStep[] = contextSteps(translator("en"));

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
export const PRESYNC_ORDER = ["teams", "jira", "mail", "whatsapp", "signal", "keep", "gitlab", "calendar"] as const;
