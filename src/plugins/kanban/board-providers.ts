import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { BoardSummary, RichBoard } from "./shared";

/**
 * Kanban's extension point for boards: a plugin brings boards of its own (read-only here — Jira
 * Lage's "Meine Lage" and your Jira boards), shown beside the boards you make in Kanban. Defined here;
 * the plugins contribute from their own `server.ts`.
 */
export type BoardProvider = {
  /** Its board ids start with this ("jira-"): the board page asks the provider whose prefix fits. */
  idPrefix: string;
  /** What the overview and the Kanban menu list. */
  list(): BoardSummary[] | Promise<BoardSummary[]>;
  /** One board in full; null when the id isn't one of its boards. */
  get(id: string): Promise<RichBoard | null>;
};

export const boardProviders = extensionPoint<BoardProvider>("kanban.boardProviders");
