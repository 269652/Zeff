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
  "board.run": async (a) => (await import("@/lib/boards/run")).startBoardRun({ syncJira: !!a.syncJira }),
  "board.stop": async () => ({ ok: (await import("@/lib/boards/run")).stopBoardRun() }),
  "recap.start": async (a) => (await import("@/lib/boards/recap")).startRecap(str(a.day)),
  "boardlage.scope": async (a) => {
    (await import("@/plugins/jira-lage/board-lage")).setBoardLageScope(!!a.all);
    return { ok: true };
  },

  // Longer jobs the pages start.
  "keepboard.sync": async (a) => ({ started: (await import("@/plugins/keep-write/board-sync")).startBoardSync(Number(a.boardId)) }),
  "people.datesAll": async () => ({ started: (await import("@/plugins/people/dates")).findAllDates() }),

  /** What this server is doing that a restart would cut off — for `npm run deploy` (see /api/busy). */
  busy: async () => (await import("@/lib/host/busy")).busyThings(),
};

/** Whether the shared secret of a request matches — see role.ts. */
export { authorized } from "./role";
