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

export const CONTEXT_STEP_IDS = ["presync", "lage", "mailtodos", "relations", "autoactions", "replies"] as const;
export type ContextStepId = (typeof CONTEXT_STEP_IDS)[number];

export const CONTEXT_STEPS: ContextStep[] = [
  {
    id: "presync",
    label: "Vorher synchronisieren",
    what: "Was „Jetzt auswerten“ vorher frisch liest. Alles andere nimmt die Auswertung aus dem letzten Sync (der läuft ohnehin im Hintergrund) — so geht sie schneller.",
    plugin: "todos",
    sources: [
      { key: "jira", label: "Jira", what: "Tickets, Status, Kommentare", plugin: "jira", default: true },
      { key: "teams", label: "Teams", plugin: "teams", default: true },
      { key: "mail", label: "Mails", what: "Outlook, Gmail", plugin: ["outlook-mail", "gmail"], default: true },
      { key: "whatsapp", label: "WhatsApp", plugin: "whatsapp", default: true },
      { key: "keep", label: "Keep", plugin: "keep", default: false },
      { key: "gitlab", label: "GitLab", plugin: "gitlab", default: false },
      { key: "calendar", label: "Kalender", plugin: "outlook-calendar", default: false },
    ],
    numbers: [{ key: "maxAge", label: "Nur, wenn der letzte Sync älter ist als", min: 0, max: 240, default: 0, unit: "Minuten (0: immer)" }],
  },
  {
    id: "lage",
    label: "Ticket-Lage",
    what: "Liest jedes Ticket mit allem, was Zeff dazu weiß, und macht die Lage und die Todos.",
    plugin: "todos",
    sources: [
      { key: "zeff", label: "Zeff-Einträge und Kontext", what: "Deine Buchungen und gesammelter Kontext zum Ticket", default: true },
      { key: "teams", label: "Teams-Chats", what: "Die Chats der letzten Tage — Absprachen, Zusagen, Bitten", plugin: "teams", default: true },
      { key: "mail", label: "Mails", what: "Mails (Outlook, Gmail), die das Ticket nennen", default: true },
      { key: "whatsapp", label: "WhatsApp", what: "WhatsApp-Nachrichten, die das Ticket nennen", plugin: "whatsapp", default: true },
      { key: "gitlab", label: "GitLab", what: "Merge Requests und Kommentare zum Ticket", plugin: "gitlab", default: true },
      { key: "git", label: "Git", what: "Branches und Commits in den Repos zum Ticket", default: true },
      { key: "related", label: "Verwandte Tickets", what: "Tickets, die es erwähnt (oder die es erwähnen), mit ihren neuen Kommentaren", default: true },
      { key: "keep", label: "Notizen (Keep)", what: "Deine Notizen zum Ticket", plugin: "keep", default: true },
    ],
    numbers: [
      { key: "chatDays", label: "Teams-Chats der letzten", min: 1, max: 30, default: 3, unit: "Tage" },
      { key: "mailDays", label: "Mails und Nachrichten der letzten", min: 3, max: 120, default: 60, unit: "Tage" },
      { key: "comments", label: "Kommentare je Ticket höchstens", min: 3, max: 40, default: 12 },
    ],
  },
  {
    id: "mailtodos",
    label: "Mail-Durchsicht",
    what: "Geht neue Mails und Nachrichten durch und macht Todos aus dem, was sie von dir wollen.",
    plugin: "todos",
    sources: [
      { key: "mail", label: "Mails", what: "Outlook und Gmail", default: true },
      { key: "whatsapp", label: "WhatsApp", plugin: "whatsapp", default: true },
      { key: "keep", label: "Notizen (Keep)", plugin: "keep", default: true },
    ],
    numbers: [{ key: "days", label: "Neue der letzten", min: 1, max: 60, default: 14, unit: "Tage" }],
  },
  {
    id: "relations",
    label: "Mail-Zuordnung",
    what: "Ordnet jedem offenen Todo die Mails zu, um die es geht (nach Inhalt).",
    plugin: "todos",
    sources: [],
    numbers: [
      { key: "days", label: "Mails der letzten", min: 7, max: 120, default: 60, unit: "Tage" },
      { key: "perTicket", label: "Mails je Ticket höchstens", min: 5, max: 60, default: 30 },
    ],
  },
  {
    id: "autoactions",
    label: "Auto-Aktionen",
    what: "Macht aus Todos ohne Knopf fertige Aktionen (Nachricht, Kommentar, Mail, Termin).",
    plugin: "auto-actions",
    sources: [],
    numbers: [],
  },
  {
    id: "replies",
    label: "Antwort-Entwürfe",
    what: "Schreibt die Antwort auf die Nachricht eines Todos aus dem Verlauf.",
    plugin: "todos",
    sources: [],
    numbers: [{ key: "messages", label: "Nachrichten aus dem Verlauf", min: 3, max: 60, default: 25 }],
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
