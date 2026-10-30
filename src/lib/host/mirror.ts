import { activeAccountId } from "@/db/accounts";
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
  // What runs per account (lib/sync/account-flags.ts: flag → account → value).
  "__zeffAccountFlags",
] as const;

export type HostSnapshot = {
  /** The mirrored fields that are set (objects as they are, flags as true). */
  flags: Record<string, unknown>;
  /** The syncs of the sync menu: the steps running, and "Sync all" (null: not; "" : starting; else its step) — the active account's (a host before the per-account syncs sends only this). */
  syncs: { running: string[]; all: string | null };
  /** The same, per account (each runs its own). */
  syncsByAccount?: Record<string, { running: string[]; all: string | null }>;
  /** Backups running (a number: the account switch only asks whether there are any). */
  backups: number;
};

type LiveSyncs = { running: Set<string>; all: string | null | undefined; stops?: Map<string, AbortController>; allStopped?: boolean };
type Globals = Record<string, unknown> & {
  __zeffSyncsByAccount?: Record<string, LiveSyncs>;
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
  const view = (s: LiveSyncs | undefined) => ({ running: s ? [...s.running] : [], all: s && s.all !== undefined ? (s.all ?? "") : null });
  const syncsByAccount = Object.fromEntries(Object.entries(g.__zeffSyncsByAccount ?? {}).map(([a, s]) => [a, view(s)]));
  return {
    flags,
    syncs: syncsByAccount[activeAccountId()] ?? view(undefined),
    syncsByAccount,
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
  const views = snap?.syncsByAccount ?? (snap ? { [activeAccountId()]: snap.syncs } : {});
  const byAccount = (g.__zeffSyncsByAccount ??= {});
  for (const a of Object.keys(byAccount)) if (!views[a]) delete byAccount[a];
  for (const [a, v] of Object.entries(views)) {
    const syncs = (byAccount[a] ??= { running: new Set(), all: undefined });
    syncs.running = new Set(v.running);
    syncs.all = v.all == null ? undefined : v.all === "" ? null : v.all;
  }
  if (snap?.backups) g.__zeffBackups = new Map(Array.from({ length: snap.backups }, (_, i) => [String(i), true]));
  else delete g.__zeffBackups;
}

const state = globalThis as { __zeffHostMirror?: { timer: ReturnType<typeof setInterval> | null; up: boolean; busy: boolean } };

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
