/**
 * Jira briefing's boards, client-safe: "My briefing" and your Jira boards, each card with its ticket's briefing — what
 * they are made into Workspace databases from (to-workspace.ts), and the state of their runs (the briefing buttons).
 */
import type { TicketQuestion, TodoSource, TodoUserNote } from "@/lib/boards/shared";
import type { ChatItem } from "@/lib/boards/ticket-chat";

export type BoardSummary = { id: string; name: string; description: string; color: string; source: string; cards: number; open: number; href: string; updatedAt: string | null };

/** A card on a board another plugin brings — shown, not edited here. */
export type RichCard = {
  id: string;
  ref: string;
  title: string;
  url: string | null;
  /** The Lage's attention (feedback, active, check, blocked …) — the card's colour. */
  attention?: string | null;
  attentionLabel?: string | null;
  badges: { text: string; tone?: "zinc" | "red" | "amber" | "emerald" | "sky" | "violet" }[];
  assignee: string | null;
  lead?: string | null;
  summary?: string | null;
  activity: { when: string; who?: string; what: string }[];
  todos: { id: number; text: string; owner: "me" | "other" }[];
  flags: string[];
  actions: { label: string; why: string }[];
  /** Possible questions about the ticket, with their answers (the Lage run's). */
  questions?: TicketQuestion[];
  /** What was asked about the ticket in its chat, with the answers (kept as its context). */
  chat?: ChatItem[];
  /** All the context its open todos came from, and the notes on them. */
  context?: ({ s: TodoSource } | { n: TodoUserNote })[];
  people: string[];
  updatedAt: string | null;
  /** Not on the last Lage run's list: only what Jira says. */
  noLage?: boolean;
};
export type RichColumn = { id: string; name: string; cards: RichCard[] };
export type RichBoard = {
  id: string;
  name: string;
  description: string;
  source: string;
  url: string | null;
  columns: RichColumn[];
  lede?: string | null;
  lageAt?: string | null;
  error?: string | null;
  /** The Board-Lage (Jira Lage's "Auswerten"): running, and how it went last. */
  boardLage?: { running: boolean; lastAt: string | null; lastOk: boolean | null; lastMessage: string | null };
  /** "My briefing" (the Ticket-Lage's own tickets): its run is the briefing itself — no Board-Lage, which leaves these tickets out. */
  /** step: the run's follow-up step going on (its mail review, matching, auto actions …) — the briefing itself is done then; null while it runs. */
  briefing?: { running: boolean; lastAt: string | null; step?: string | null };
};
