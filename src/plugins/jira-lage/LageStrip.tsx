import { isInstalled } from "@/plugins/state";
import { BoardLageButton } from "./BoardLageButton";
import { BriefingRunButton } from "./BriefingRunButton";

/**
 * The Jira briefing's stripe over its databases (once Kanban's board pages): on Meine Lage the briefing's run, on a
 * Jira board's database its Board-Lage ("Auswerten") — nothing on any other database. Server component.
 */
export async function LageStrip({ dbId }: { dbId: number }) {
  if (!isInstalled("jira-lage")) return null;
  const kind = (await import("./to-workspace")).lageDatabaseKind(dbId);
  if (!kind) return null;
  const board = await import("./board");
  return (
    <div className="mx-auto w-full max-w-md px-4 pt-3">
      {kind === "briefing" ? <BriefingRunButton state={board.briefingRunState()} /> : <BoardLageButton state={board.boardLageRunState()} />}
    </div>
  );
}
