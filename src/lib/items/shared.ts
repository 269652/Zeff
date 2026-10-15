/**
 * Collections and their items, client-safe: one way to read what you keep in Zeff — Kanban boards,
 * Keep boards and Google Keep, Workspace databases. The data stays with its plugin; each brings a
 * provider (see ./point). An item keeps the ref it has everywhere already: KB-<id>, keep:n<id>,
 * keep:<Google's id>, page:<id>.
 */

/** board: columns of cards; notes: loose notes (Keep); database: rows with properties (Workspace). */
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
};

/** Where an item stands: todo (not started), doing, done. */
export type ItemPhase = "todo" | "doing" | "done";
export type ItemStatus = { name: string; phase: ItemPhase };

export type Item = {
  ref: string;
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
};
