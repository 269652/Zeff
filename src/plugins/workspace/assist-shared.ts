/**
 * "✨ Think along" (Mitdenken) on a page: what its card holds — what the AI understood, what it asks, what it proposes,
 * what was set up — kept in the card's `state` attribute (JSON). Client-safe: the card (ui/assist-node.tsx) and the
 * server (assist.ts) share it.
 */

export type AssistQuestionKind = "choice" | "multi" | "text" | "number" | "date";
export type AssistQuestion = { id: string; text: string; kind: AssistQuestionKind; options: string[] };

/** A suggested appointment: a day ("2027-01-15", end the day after) or a time ("2027-01-15T10:00"); `conflicts`: what of yours it overlaps. */
export type AssistEvent = { title: string; start: string; end: string; allDay?: boolean; conflicts?: string[] };

/** What the AI may propose — a small closed set, each with its executor in assist.ts. */
export type AssistAction = { id: string; label: string } & (
  | { kind: "events"; events: AssistEvent[]; /** The calendar they are proposed in (none: your Zeff calendar) — and its name, for the card. */ calendarId?: number; calendar?: string; /** Alternatives (Option A, B …, one group): accepting one in the calendar dismisses the others. */ options?: boolean }
  | { kind: "todo"; text: string; due?: string }
  | { kind: "widget"; widget: string; config: Record<string, string | number | boolean> }
  | { kind: "text"; markdown: string }
);
export type AssistActionKind = AssistAction["kind"];
/** An action before it has its id (each kind on its own). */
export type AssistActionBody = AssistAction extends infer A ? (A extends AssistAction ? Omit<A, "id"> : never) : never;
export const ASSIST_ACTION_KINDS: readonly AssistActionKind[] = ["events", "todo", "widget", "text"];

/** What applying made outside the page (Ctrl+Z can't take those back — the card's "Undo" can). */
export type AssistCreated = {
  /** "event": a proposed appointment (asked again: replaced; Undo takes it out while it is still proposed); "calendar": the calendar its block shows (never deleted). */
  kind: "event" | "calendar" | "todo" | "list";
  id: number; label: string; href?: string; /** A checklist: its list id in the page (Undo takes it out — its todos go with it). */ ref?: string };

export type AssistStatus = "thinking" | "asking" | "proposing" | "applied" | "dismissed";

export type AssistState = {
  status: AssistStatus;
  /** About the block before the card, or the whole page. */
  scope: "block" | "page";
  /** What it is about, in a few words ("Reise zu Nadine nach Hamburg"). */
  intent: string;
  /** Its one line of understanding, or of what was set up. */
  summary: string;
  questions: AssistQuestion[];
  answers: Record<string, string | string[]>;
  /** The questions of the rounds before, with their answers (what goes with the next call). */
  history: { q: string; a: string }[];
  /** Rounds of questions asked so far (at most MAX_ASSIST_ROUNDS). */
  round: number;
  actions: AssistAction[];
  created: AssistCreated[];
  /** What the user typed into the ✨ composer with "Think along" (ui/ai-composer.tsx): what they want of it. */
  wish?: string;
  error?: string;
};

export const MAX_ASSIST_QUESTIONS = 4;
export const MAX_ASSIST_ROUNDS = 2;
export const MAX_ASSIST_ACTIONS = 6;

export const newAssistState = (scope: AssistState["scope"] = "block"): AssistState => ({ status: "thinking", scope, intent: "", summary: "", questions: [], answers: {}, history: [], round: 0, actions: [], created: [] });

const STATUSES: readonly AssistStatus[] = ["thinking", "asking", "proposing", "applied", "dismissed"];

/** A card's state from its attribute (anything unreadable: a fresh one). The parts are checked where they are used (assist.ts). */
export function readAssistState(raw: unknown): AssistState {
  let o: Partial<AssistState> = {};
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (v && typeof v === "object" && !Array.isArray(v)) o = v as Partial<AssistState>;
  } catch {
    // not JSON: a fresh card
  }
  const base = newAssistState(o.scope === "page" ? "page" : "block");
  return {
    ...base,
    status: STATUSES.includes(o.status as AssistStatus) ? (o.status as AssistStatus) : base.status,
    intent: typeof o.intent === "string" ? o.intent : "",
    summary: typeof o.summary === "string" ? o.summary : "",
    questions: Array.isArray(o.questions) ? o.questions : [],
    answers: o.answers && typeof o.answers === "object" && !Array.isArray(o.answers) ? o.answers : {},
    history: Array.isArray(o.history) ? o.history.filter((h) => h && typeof h.q === "string" && typeof h.a === "string") : [],
    round: Number.isInteger(o.round) ? Number(o.round) : 0,
    actions: Array.isArray(o.actions) ? o.actions : [],
    created: Array.isArray(o.created) ? o.created : [],
    ...(typeof o.wish === "string" && o.wish.trim() ? { wish: o.wish.trim().slice(0, 1000) } : {}),
    ...(typeof o.error === "string" && o.error ? { error: o.error } : {}),
  };
}
