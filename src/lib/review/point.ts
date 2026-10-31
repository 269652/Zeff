import { extensionPoint } from "@/lib/plugin-kit/extension-point";

/**
 * The review queue's extension points: everything Zeff wants you to confirm, from every plugin, in one place
 * (/review). A plugin that proposes things — a name that may be someone's, a fact the AI read, a todo it thinks
 * is done — contributes a source per kind from its own `server.ts`: what waits, and what a button does with it.
 * What has a page of its own to be worked through (the booking suggestions) is only counted and linked.
 * What is a proposal of the one store (@/lib/proposals — same person?, entities, proposed appointments) is no source here:
 * the queue lists the open proposals itself, a group per proposal source, and decides them through `decide()`.
 * Read through `@/lib/review`, never directly. Server only.
 */

/** A button on an item: "yes", "no", "done" … — the one marked primary is the y key's. */
export type ReviewAction = { id: string; label: string; primary?: boolean };

/** One thing waiting for your word, as its source has it — its id is the source's own (the queue keys it). */
export type ReviewEntry = {
  id: string;
  /** What it says: the statement to confirm. */
  title: string;
  /** Under it: the evidence, the quote, where it was read. */
  detail?: string;
  /** How sure the AI is (0–1). */
  confidence?: number;
  /** Where it lives in Zeff (the profile, the todo). */
  href?: string;
  actions: ReviewAction[];
};

export type ReviewSource = {
  /** Unique, the prefix of its items' keys ("people-claim" → "people-claim:28") — no colon. */
  id: string;
  /** Its kind, as the queue's heading (a getter, when translated: read in the language of the request). */
  label: string;
  list(): ReviewEntry[] | Promise<ReviewEntry[]>;
  /** A button pressed on an item; what came of it, in words (or nothing). Throws when it no longer can. */
  act(itemId: string, action: string): string | void | Promise<string | void>;
};

/** Things waiting on a page of their own: only how many, and where. */
export type ReviewLink = { id: string; label: string; href: string; count(): number | Promise<number> };

export const reviewSources = extensionPoint<ReviewSource[]>("review.sources");
export const reviewLinks = extensionPoint<ReviewLink[]>("review.links");
