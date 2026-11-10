import { buildSnapshot } from "./mirror";

/**
 * What the web server can ask the sync host to do (POST /api/sync-host { op, args, account }). Each runs in the
 * account the web server was in; what it returns goes back as JSON, what it throws as the error text.
 * Server only — the host's side of client.ts.
 */
type Op = (args: Record<string, unknown>) => unknown | Promise<unknown>;

const str = (v: unknown) => String(v ?? "");

export const HOST_OPS: Record<string, Op> = {
  /** What is going on here (the web server mirrors it). */
  snapshot: () => buildSnapshot(),

  // The sync menu's steps.
  "sync.start": async (a) => (await import("@/lib/sync/registry")).startSyncHere(str(a.key) as never),
  "sync.startAll": async () => (await import("@/lib/sync/registry")).startSyncAllHere(),
  "sync.stop": async (a) => {
    const stopped = (await import("@/lib/sync/registry")).stopSyncHere(str(a.key));
    return { ok: stopped, message: stopped ? "Stopping." : "Not running." };
  },
  "sync.stopAll": async () => {
    const stopped = (await import("@/lib/sync/registry")).stopSyncAllHere();
    return { ok: stopped, message: stopped ? "Stopping." : "Not running." };
  },
  "sync.wait": async (a) => (await import("@/lib/sync/registry")).syncAndWaitHere(str(a.key) as never),
  // Google Calendar with the days shown (a month gone by) besides its window.
  "gcal.range": async (a) => (await import("@/plugins/google-calendar/sync")).syncGoogleCalendar({ range: { from: str(a.from), to: str(a.to) } }),

  // The Ticket-Lage, the day recap, the Board-Lage's scope.
  "board.run": async (a) => (await import("@/lib/runs/run")).startBoardRun({ syncJira: !!a.syncJira }),
  "board.stop": async () => ({ ok: (await import("@/lib/runs/run")).stopBoardRun() }),
  "recap.start": async (a) => (await import("@/lib/runs/recap")).startRecap(str(a.day)),
  "boardlage.scope": async (a) => {
    (await import("@/plugins/jira-lage/board-lage")).setBoardLageScope(!!a.all);
    return { ok: true };
  },

  // A live session as the server following it sees it (the phone's server shows a lesson's progress with it).
  "work.live": async (a) => (await import("@/lib/work/live-state")).liveStateHere(Number(a.runId)),
  // The queue looked at (the phone's server starts no workers: Zeff's own does).
  "work.pump": async () => {
    (await import("@/lib/work/runner")).pump();
    return { ok: true };
  },
  // What you do in a live session, from the phone's server (it only watches them): done here, where it's followed.
  "work.liveDo": async (a) => (await import("@/lib/work/live-actions")).liveDo(Number(a.runId), (a.body ?? {}) as import("@/lib/work/live-actions").LiveBody),
  // A message into a conversation's running live session (the phone's server doesn't follow the sessions).
  "work.send": async (a) => (await import("@/lib/work/live-state")).sendToSessionHere(Number(a.runId), str(a.text)),

  // Longer jobs the pages start.
  "people.datesAll": async () => ({ started: (await import("@/plugins/people/dates")).findAllDates() }),

  /** What this server is doing that a restart would cut off — for `npm run deploy` (see /api/busy). */
  busy: async () => (await import("@/lib/host/busy")).busyThings(),
};

/** Whether the shared secret of a request matches — see role.ts. */
export { authorized } from "./role";
