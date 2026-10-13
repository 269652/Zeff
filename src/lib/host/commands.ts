import { callHost } from "./client";
import { refreshMirror } from "./mirror";
import { delegates } from "./role";

type Result = { ok: boolean; message: string };

/** The answer of a remote start, or why it didn't happen (the sync host is down). What it started shows at once. */
export async function remoteResult(op: string, args: unknown): Promise<Result> {
  try {
    const r = await callHost<Result>(op, args);
    void refreshMirror();
    return r;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The runs the pages start — here when this server runs work itself, else on the sync host (the pages' buttons
 * look the same either way). A run in the host keeps going while this server is deployed.
 */
export async function startBoardRunAnywhere(opts: { syncJira?: boolean } = {}): Promise<Result> {
  if (!delegates()) return (await import("@/lib/boards/run")).startBoardRun(opts);
  return remoteResult("board.run", opts);
}

export async function stopBoardRunAnywhere(): Promise<boolean> {
  if (!delegates()) return (await import("@/lib/boards/run")).stopBoardRun();
  return (await remoteResult("board.stop", {})).ok;
}

export async function startRecapAnywhere(day: string): Promise<Result> {
  if (!delegates()) return (await import("@/lib/boards/recap")).startRecap(day);
  return remoteResult("recap.start", { day });
}

/** A Keep board's sync (the Keep write plugin): started — false when one runs already. */
export async function startBoardSyncAnywhere(boardId: number): Promise<boolean> {
  if (!delegates()) return (await import("@/plugins/keep-write/board-sync")).startBoardSync(boardId);
  const r = await callHost<{ started: boolean }>("keepboard.sync", { boardId });
  void refreshMirror();
  return r.started;
}

/** The search for everyone's dates (the People plugin): started — false when one runs already. */
export async function findAllDatesAnywhere(): Promise<boolean> {
  if (!delegates()) return (await import("@/plugins/people/dates")).findAllDates();
  const r = await callHost<{ started: boolean }>("people.datesAll", {});
  void refreshMirror();
  return r.started;
}
