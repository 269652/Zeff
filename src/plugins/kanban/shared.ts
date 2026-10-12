/**
 * Kanban, client-safe: your own boards (columns, cards K-<id>) and the boards other plugins bring
 * (Jira Lage: your Jira boards, each card with the Lage of its ticket) — one way to show both.
 */
import type { T } from "@/lib/i18n/shared";
import type { TicketQuestion, TodoSource, TodoUserNote } from "@/lib/boards/shared";
import type { ChatItem } from "@/lib/boards/ticket-chat";

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
/** The priorities' names in English (what the briefing reads). */
export const PRIORITY_LABELS: Record<Priority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
/** The priorities' names as shown, in the language of `t`. */
export const priorityLabels = (t: T): Record<Priority, string> => ({ low: t("Low"), normal: t("Normal"), high: t("High"), urgent: t("Urgent") });
export const isPriority = (v: unknown): v is Priority => (PRIORITIES as readonly unknown[]).includes(v);

export const BOARD_COLORS = ["indigo", "emerald", "amber", "rose", "sky", "violet", "zinc"] as const;

/** A card's key: KB-<id> — shaped like a Jira key, so it flows into todos, the Lage, entries. */
export const cardRef = (id: number) => `KB-${id}`;

export type CardView = {
  id: number;
  ref: string;
  columnId: number;
  title: string;
  description: string;
  labels: string[];
  priority: Priority | null;
  due: string | null;
  assignee: string | null;
  sort: number;
  /** The card it's a subtask of (null: a card of its own). */
  parentId: number | null;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
};
export type ColumnView = { id: number; name: string; sort: number; wipLimit: number | null; done: boolean; cards: CardView[] };
export type BoardView = { id: number; name: string; description: string; color: string; inLage: boolean; columns: ColumnView[]; createdAt: string; updatedAt: string };
/** What the Lage says about a card (its last run), and its open todos — shown on the card. */
export type CardLage = { attention: string | null; attentionLabel: string | null; lead: string | null; summary: string | null; happened: { when: string; who?: string; what: string }[]; todos: CardTodo[] };
/** A card's todo — a checklist item (open or done), with its deadline. */
export type CardTodo = { id: number; text: string; owner: "me" | "other"; status?: "open" | "done"; due?: string | null };
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
  briefing?: { running: boolean; lastAt: string | null };
};
