import { isInstalled } from "@/plugins/state";
import type { BoardSummary, RichBoard } from "./shared";

/**
 * The boards other plugins bring to Kanban — shown beside your own, read-only here. Jira Lage:
 * "Meine Lage" and your Jira boards.
 */
export async function providerBoards(): Promise<BoardSummary[]> {
  if (!isInstalled("jira-lage")) return [];
  return (await import("@/plugins/jira-lage/board")).lageBoards();
}

export async function providerBoard(id: string): Promise<RichBoard | null> {
  if (id.startsWith("jira-") && isInstalled("jira-lage")) return (await import("@/plugins/jira-lage/board")).lageBoard(id);
  return null;
}
