import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { BadgePart } from "./badge-shared";

/**
 * What a plugin says about the rows its source brings, for the tree's badges: People about a person's row (open todos about them,
 * promises past their day, unread messages from them) — by the record the row was read from (its `srcref`, "person:12"). The rows
 * themselves are found by the Workspace; the badges add up into their database's ("Personen" shows them all). Cheap, never an AI;
 * read at most every few seconds. Server only.
 */
export type RowBadgeSource = {
  /** The start of the records' refs it knows ("person:"). */
  prefix: string;
  /** The badge parts by ref ("person:12" → "2 open todos …"); a ref without any is left out. */
  badges: () => Map<string, BadgePart[]> | Promise<Map<string, BadgePart[]>>;
};

export const rowBadgeSources = extensionPoint<RowBadgeSource[]>("workspace.rowBadges");
