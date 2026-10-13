import { callHost } from "./client";
import { delegates } from "./role";

/**
 * What the sync host is doing, as the pages see it. The syncs and runs keep their state in the memory of
 * the server that runs them (globalThis.__zeff…) — and many pages, the menu and the account switch read it.
 * With a sync host the web server doesn't run them, so it copies that state from the host (every second or two,
 * and at once when the host says something changed) into the same globalThis fields: whatever reads them
 * doesn't know the difference. Only these fields — nothing else of the host's memory leaves it.
 */
export const MIRRORED_FLAGS = [
  "__zeffBoardRun",
  "__zeffRecap",
  "__zeffBoardSync",
  "__zeffPeopleDates",
  "__zeffTeamsSyncing",
  "__zeffMailSyncing",
  "__zeffWhatsappSyncing",
  "__zeffSignalSyncing",
  "__zeffKeepSyncing",
  "__zeffNewsSyncing",
  "__zeffGcalSyncing",
  "__zeffGitlabSyncing",
  "__zeffDriveBackup",
  "__zeffDriveDocs",
  "__zeffMailTodos",
  "__zeffMailRelations",
  "__zeffNoteTodos",
  "__zeffNoteRelations",
  "__zeffDocTodos",
  "__zeffDocRelations",
  "__zeffAutoActions",
  "__zeffBoardLage",
  "__zeffPeopleNormalize",
  "__zeffKnowledgeRelations",
] as const;

export type HostSnapshot = {
  /** The mirrored fields that are set (objects as they are, flags as true). */
  flags: Record<string, unknown>;
  /** The syncs of the sync menu: the steps running, and "Sync all" (null: not; "" : starting; else its step). */
  syncs: { running: string[]; all: string | null };
  /** Backups running (a number: the account switch only asks whether there are any). */
  backups: number;
};

type Globals = Record<string, unknown> & {
  __zeffSyncs?: { running: Set<string>; all: string | null | undefined; stops?: Map<string, AbortController>; allStopped?: boolean };
  __zeffBackups?: Map<string, unknown>;
};
const g = globalThis as Globals;

/** The host's side: what is going on right now. */
export function buildSnapshot(): HostSnapshot {
  const flags: Record<string, unknown> = {};
  for (const name of MIRRORED_FLAGS) {
    const v = g[name];
    if (!v) continue;
    try {
      flags[name] = typeof v === "object" ? JSON.parse(JSON.stringify(v)) : true;
    } catch {
      flags[name] = true;
    }
  }
  const s = g.__zeffSyncs;
  return {
    flags,
    syncs: { running: s ? [...s.running] : [], all: s && s.all !== undefined ? (s.all ?? "") : null },
    backups: g.__zeffBackups?.size ?? 0,
  };
}

/** The web side: what the host says goes into the fields the pages read. */
export function applySnapshot(snap: HostSnapshot | null): void {
  for (const name of MIRRORED_FLAGS) {
    const v = snap?.flags?.[name];
    if (v) g[name] = v;
    else delete g[name];
  }
  const syncs = (g.__zeffSyncs ??= { running: new Set(), all: undefined });
  syncs.running = new Set(snap?.syncs.running ?? []);
  syncs.all = snap?.syncs.all == null ? undefined : snap.syncs.all === "" ? null : snap.syncs.all;
  if (snap?.backups) g.__zeffBackups = new Map(Array.from({ length: snap.backups }, (_, i) => [String(i), true]));
  else delete g.__zeffBackups;
}

const state = globalThis as { __zeffHostMirror?: { timer: ReturnType<typeof setInterval> | null; up: boolean; busy: boolean } };

/** Whether the sync host answered the last time (false before the first answer). */
export const hostReachable = (): boolean => !!state.__zeffHostMirror?.up;

/** Ask the host now (a change was announced, or an action just started something). */
export async function refreshMirror(): Promise<void> {
  const m = (state.__zeffHostMirror ??= { timer: null, up: false, busy: false });
  if (m.busy) return;
  m.busy = true;
  try {
    applySnapshot(await callHost<HostSnapshot>("snapshot", {}, 4000));
    m.up = true;
  } catch {
    // The host is restarting or not running: what it was doing is no longer going on — the pages show idle.
    m.up = false;
    applySnapshot(null);
  } finally {
    m.busy = false;
  }
}

/** The web server's loop (once; instrumentation starts it). */
export function startHostMirror(): void {
  if (!delegates()) return;
  const m = (state.__zeffHostMirror ??= { timer: null, up: false, busy: false });
  if (m.timer) return;
  void refreshMirror();
  m.timer = setInterval(() => void refreshMirror(), 1500);
  m.timer.unref();
}
