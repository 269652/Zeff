/**
 * Collections and their items, client-safe: one way to read what you keep in Zeff — Kanban boards,
 * Keep boards and Google Keep, Workspace databases. The data stays with its plugin; each brings a
 * provider (see ./point). An item keeps the ref it has everywhere already: KB-<id>, keep:n<id>,
 * keep:<Google's id>, page:<id>.
 */

/** board: columns of cards (a database with a board view by status too); notes: loose notes (Keep); database: rows with properties (Workspace). */
export type CollectionKind = "board" | "notes" | "database";

export type Collection = {
  /** "<plugin>:<its id>" — kanban:3, keep:board:2, keep:google, workspace:12. */
  id: string;
  plugin: string;
  kind: CollectionKind;
  name: string;
  description: string;
  color: string | null;
  /** Where it opens in Zeff. */
  href: string;
  /** Its items can't be changed in Zeff (Google Keep without its write plugin). */
  readOnly: boolean;
  /** Its items go into the briefing (the Lage). */
  briefing: boolean;
  /** Its items go into the knowledge. */
  knowledge: boolean;
  /** Its space in the knowledge (default: its name). */
  space?: string;
  /** How many items it has (not the archived). */
  items: number;
  /** A board's statuses in order (its columns) — where its items can go. */
  statuses?: string[];
  /** Kept by a sync from elsewhere ("jira", "google-keep"): its items come from there (Jira's tickets come into the Lage from Jira). */
  source?: string;
  /** How sensitive its items are (lib/boundaries): open, personal or secret — a secret one goes into neither the briefing nor the knowledge. */
  sensitivity?: "open" | "personal" | "secret";
};

/** What can be switched on a collection (what's left out stays as it is). */
export type CollectionSwitches = { briefing?: boolean; knowledge?: boolean };

/** A Lage suggestion on an item, clicked: a move to a status (`to`), a note (`comment`). */
export type ItemAction = { type: string; to?: string; comment?: string; label: string };

/** Where an item stands: todo (not started), doing, done. */
export type ItemPhase = "todo" | "doing" | "done";
export type ItemStatus = { name: string; phase: ItemPhase };

export type Item = {
  ref: string;
  /** Its ticket key, as todos, the Lage and entries name it: KB-<id> (a Kanban card, also once moved), WS-<id> (a row); null: not a ticket (a note). */
  key: string | null;
  collectionId: string;
  kind: "card" | "note" | "row";
  title: string;
  /** Its body as plain text (a card's description, a note's text and checklist lines, a row's page). */
  text: string;
  labels: string[];
  /** null: it has no status (a note). */
  status: ItemStatus | null;
  /** YYYY-MM-DD (or with a time). */
  due: string | null;
  assignee: string | null;
  color: string | null;
  pinned: boolean;
  /** Archived: not among its collection's items any more, but still found by its ref. */
  archived: boolean;
  /** The item it's part of (a card's parent card). */
  parentRef: string | null;
  href: string;
  createdAt: string | null;
  updatedAt: string | null;
  /** A database row's fields with a value, as text, in the database's order (a journal's day: its date, mood, energy …). */
  fields?: { name: string; value: string }[];
};

/** A todo on a card (its checklist): open or done, with its deadline. */
export type ExtraTodo = { id: number; text: string; owner: "me" | "other"; status: "open" | "done"; due: string | null };

/** What Zeff knows about a ticket's card beyond its row: the Lage (attention, lead …) and its todos. */
export type TicketExtras = {
  attention: string | null;
  attentionLabel: string | null;
  lead: string | null;
  summary: string | null;
  happened: { when: string; who?: string; what: string }[];
  /** Open first, then done. */
  todos: ExtraTodo[];
};
