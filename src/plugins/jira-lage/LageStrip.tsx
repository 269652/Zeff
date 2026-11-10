import { isInstalled } from "@/plugins/state";
import { BoardLageButton } from "./BoardLageButton";

/**
 * The Jira briefing's stripe over its databases (once Kanban's board pages): on a Jira board's database its Board-Lage
 * ("Auswerten") — nothing on Meine Lage (its ↻ syncs Jira and fills Lage and Attention) nor on any other database.
 * Server component.
 */
export async function LageStrip({ dbId }: { dbId: number }) {
  if (!isInstalled("jira-lage")) return null;
  const kind = (await import("./to-workspace")).lageDatabaseKind(dbId);
  if (kind !== "board") return null;
  const board = await import("./board");
  return (
    <BoardLageButton state={board.boardLageRunState()} />
  );
}
