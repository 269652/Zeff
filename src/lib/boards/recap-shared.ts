import { isoDay } from "@/lib/text";
/**
 * The Recap (what you did on a day) — client-safe: what was gathered for the day, what the AI made of it,
 * and the schema its answer must keep to.
 */

/** One thing that happened, as gathered: where from, when (ISO, if known), what — and, for a booking, its hours. */
export type RecapFact = { kind: "entry" | "todo" | "work" | "jira-comment" | "jira-change" | "commit" | "gitlab"; at: string | null; text: string; hours?: number };

/**
 * A ticket's facts for the day: the ticket as Jira has it, what happened on it — and `refs`, the
 * links to what it was about (todos done, the messages, comments and merge requests they came
 * from, your comments): shown as their badges.
 */
export type RecapTicketFacts = { key: string; summary: string; status: string | null; url: string | null; facts: RecapFact[]; refs?: string[] };

/** Everything gathered for a day: per ticket, and what's on no ticket (meetings, internal work). */
export type RecapFacts = { tickets: RecapTicketFacts[]; other: RecapFact[] };

/** The AI's write-up of a day: a summary, then per ticket a line and what was done; work on no ticket. */
export type RecapResult = {
  summary: string;
  tickets: { key: string; lead: string; done: string[] }[];
  other: string[];
};

/** A recap as the page shows it. */
export type RecapView = {
  id: number;
  day: string;
  status: "running" | "ok" | "error";
  model: string | null;
  facts: RecapFacts;
  result: RecapResult | null;
  error: string | null;
  costUsd: number | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
};

export const RECAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "tickets", "other"],
  properties: {
    summary: { type: "string", description: "Der Tag insgesamt in 3–5 Sätzen, wie fürs Standup: woran ich gearbeitet habe, was fertig wurde, was offen blieb." },
    tickets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "lead", "done"],
        properties: {
          key: { type: "string", description: "Der Ticket-Schlüssel, wie in den Daten (z. B. PROJ-339)." },
          lead: { type: "string", description: "Ein Satz: was ich an dem Ticket gemacht habe und wo es jetzt steht." },
          done: { type: "array", items: { type: "string" }, description: "Was ich gemacht habe, als kurze Stichpunkte (Verb zuerst, konkret)." },
        },
      },
    },
    other: { type: "array", items: { type: "string" }, description: "Arbeit ohne Ticket (Meetings, Internes) als kurze Stichpunkte." },
  },
} as const;

/** The workday before a date (Friday for a Monday), YYYY-MM-DD local. */
export function previousWorkday(from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return isoDay(d);
}

export { isoDay };

/** The workday before / after a YYYY-MM-DD day. */
export function shiftWorkday(day: string, by: 1 | -1): string {
  const [y, m, dd] = day.split("-").map(Number);
  const d = new Date(y, m - 1, dd + by);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + by);
  return isoDay(d);
}

/** Today, YYYY-MM-DD local. */
export const todayIso = () => isoDay(new Date());
