/**
 * Whether a live session is working on an answer right now — asked of the server that follows it. Zeff's own server
 * follows the sessions it started; the phone's server (a "web" server that hands the work to Zeff's own) doesn't, so
 * it asks there (host op "work.live"). Server only.
 */
import { delegates } from "@/lib/host/role";
import { liveDriverOf } from "./live-driver";

export type LiveState = { busy: boolean | null; followed: boolean };

/** Here: the session as this server follows it (busy: working, or asking you; null: not followed here). */
export function liveStateHere(runId: number): LiveState {
  const d = liveDriverOf(runId);
  const v = d?.view(runId);
  if (!v) return { busy: null, followed: false };
  return { busy: !!v.live.busy && !v.live.permission, followed: true };
}

/** The session's state — here, or from Zeff's own server when this one hands it the work. */
export async function liveState(runId: number): Promise<LiveState> {
  let here = liveStateHere(runId);
  // Zeff's own server: a session it doesn't follow yet (started by the phone's server, or before a restart) — followed now.
  if (!here.followed && !delegates() && followHere(runId)) here = liveStateHere(runId);
  if (here.followed || !delegates()) return here;
  try {
    const { callHost } = await import("@/lib/host/client");
    return await callHost<LiveState>("work.live", { runId }, 4000);
  } catch {
    return here;
  }
}

/** A session this server doesn't follow yet (it started elsewhere, or before a restart): followed from now on. */
function followHere(runId: number): boolean {
  const d = liveDriverOf(runId);
  if (!d) return false;
  if (!d.view(runId)) d.reattach([runId]);
  return !!d.view(runId);
}

/**
 * Here: a message into the running live session of a conversation (`runId` one of its runs) — the newest running
 * session of its todo. Its id when it went in; null when there is none (then a new run goes on with the conversation).
 */
export async function sendToSessionHere(runId: number, text: string): Promise<number | null> {
  const { getRun, runsByStatus } = await import("./store");
  const r = getRun(runId);
  if (!r) return null;
  const live = runsByStatus(["running"]).filter((x) => x.todoId === r.todoId && !!liveDriverOf(x.id)).sort((a, b) => b.id - a.id)[0];
  if (!live || !followHere(live.id)) return null;
  await liveDriverOf(live.id)!.send(live.id, text.slice(0, 100000), []);
  return live.id;
}

/**
 * A message into the conversation's running live session — here, or on Zeff's own server when this one hands it the
 * work (the phone's server doesn't follow the sessions: a message it queued behind one waited for good).
 */
export async function sendToSession(runId: number, text: string): Promise<number | null> {
  if (!delegates()) return sendToSessionHere(runId, text);
  try {
    const { callHost } = await import("@/lib/host/client");
    return await callHost<number | null>("work.send", { runId, text }, 15000);
  } catch {
    return null;
  }
}
