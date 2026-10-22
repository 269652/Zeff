/**
 * "What you should know" (the know plugin): the shape of a brief — what Zeff puts together about the people and things of a
 * meeting, a mail, a chat, a ticket, a person or a Workspace row — as the server sends it to the panel, the MCP and the AI
 * summary. Client-safe; no logic beyond small helpers.
 */

/** Something the brief links to: a ref, how it is called, where it opens ("" when nowhere). */
export type BriefLink = { ref: string; label: string; href: string };

/** A fact about someone that holds now (current, never superseded or disputed), with where it was read. */
export type BriefFact = { text: string; source: string; at: string };

export type BriefPerson = {
  id: number;
  ref: string;
  name: string;
  href: string;
  /** A role read about them (a confirmed one first). */
  role: string | null;
  facts: BriefFact[];
  /** A claim says they are away until a day not passed yet. */
  away: { until: string; text: string } | null;
  /** A date of theirs coming up soon (a birthday first). */
  birthday: { on: string; inDays: number; turns: number | null; label: string } | null;
  /** Open money between you (Finances): what you owe them, what they owe you. */
  money: { owe: number; owed: number } | null;
  /** The newest interaction with them on the timeline. */
  lastContact: { at: string; kind: string; title: string; href: string } | null;
  /** How many events with them the last 30 days. */
  recentCount: number;
};

/** Something still open between you and someone: promised by you ("mine") or to you ("theirs"). */
export type BriefLoop = { id: number; personId: number; personName: string; direction: "mine" | "theirs" | ""; text: string; due: string; overdue: boolean; evidence: string; sourceRef: string };

/** One event of the timeline as the brief shows it. */
export type BriefEvent = { id: number; at: string; kind: string; source: string; title: string; summary: string; href: string; entities: BriefLink[] };

/** A source the brief relies on that isn't well (Source health). */
export type BriefStale = { key: string; label: string; href: string; state: string; reason: string };

/** The meeting a brief is for. */
export type BriefMeeting = { id: number; title: string; start: string; end: string; allDay: boolean; location: string; online: boolean; attendees: string[]; href: string };

export type Brief = {
  /** The refs it is about (the row, the mail, the people …). */
  refs: string[];
  /** A name for what it is about. */
  label: string;
  meeting: BriefMeeting | null;
  people: BriefPerson[];
  loops: BriefLoop[];
  recent: BriefEvent[];
  /** Tickets, cases, projects, organisations it is about. */
  related: BriefLink[];
  stale: BriefStale[];
  /** How many things were left out for their sensitivity (secret; personal for a reader without that clearance). */
  hidden: number;
  /** A hash of what it says — the AI summary is made again only when it changes. */
  hash: string;
  /** When it was put together (ISO). */
  at: string;
};

/** The AI's summary of a brief: a few points, each with the numbers of the lines it rests on (as `sources`, linked). */
export type BriefSummary = { points: { text: string; sources: BriefLink[] }[]; hash: string; at: string; current: boolean };

/** Whether a brief has anything to say. */
export const briefEmpty = (b: Pick<Brief, "people" | "loops" | "recent" | "related">): boolean => !b.people.length && !b.loops.length && !b.recent.length && !b.related.length;
