/**
 * Watching folders: Documents' local folders read in by the "localdocs" step on its schedule — with the Explorer installed, also
 * the moment something changes in them. One file-system watcher per folder and account (subfolders included); a change waits a
 * few seconds for more to come (a copy of many files is one read-in), then the folders are read in. Server only.
 */
import fs from "node:fs";
import { toLocalPath } from "@/lib/hostpath";

type Watch = { account: string; path: string; watcher: fs.FSWatcher };
type State = { watches: Map<string, Watch>; timers: Map<string, ReturnType<typeof setTimeout>>; running: Set<string>; again: Set<string>; refresher?: ReturnType<typeof setInterval> };

const g = globalThis as { __zeffExplorerWatch?: State };
const state = (): State => (g.__zeffExplorerWatch ??= { watches: new Map(), timers: new Map(), running: new Set(), again: new Set() });

/** How long a change waits for more before the folders are read in. */
export const SETTLE_MS = 3000;

/** Files whose changes don't count: Office's lock files, downloads in progress, temporary and hidden files. */
export const ignored = (name: string | null): boolean => {
  if (!name) return false;
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.startsWith("~$") || base.startsWith(".") || /\.(tmp|temp|crdownload|part|partial|download|swp)$/i.test(base) || /^(desktop\.ini|thumbs\.db)$/i.test(base);
};

/** The folders read in now for an account (after the changes settled); a change meanwhile reads them once more after. */
async function readIn(account: string): Promise<void> {
  const s = state();
  if (s.running.has(account)) return void s.again.add(account);
  s.running.add(account);
  try {
    const { withAccount } = await import("@/db/accounts");
    await withAccount(account, async () => {
      const { isInstalled } = await import("@/plugins/state");
      if (!isInstalled("explorer") || !isInstalled("documents")) return;
      await (await import("@/lib/sync/registry")).syncAndWait("localdocs");
    });
  } catch (e) {
    console.error(`[explorer] reading in the watched folders of ${account} failed`, e);
  } finally {
    s.running.delete(account);
    if (s.again.delete(account)) schedule(account);
  }
}

function schedule(account: string): void {
  const s = state();
  clearTimeout(s.timers.get(account));
  s.timers.set(
    account,
    setTimeout(() => {
      s.timers.delete(account);
      void readIn(account);
    }, SETTLE_MS),
  );
}

/** The watchers made or closed so they match the watched folders of every account that has the Explorer. */
export async function refreshWatchers(): Promise<void> {
  const s = state();
  const want = new Map<string, { account: string; path: string }>();
  const { listAccounts, withAccount } = await import("@/db/accounts");
  const { isInstalled } = await import("@/plugins/state");
  const { listFolders } = await import("@/plugins/documents/folders");
  for (const a of listAccounts()) {
    try {
      withAccount(a.id, () => {
        if (!isInstalled("explorer") || !isInstalled("documents")) return;
        for (const f of listFolders()) want.set(`${a.id}|${f.path}`, { account: a.id, path: f.path });
      });
    } catch (e) {
      console.error(`[explorer] the watched folders of ${a.id} couldn't be read`, e);
    }
  }
  for (const [k, w] of s.watches) {
    if (want.has(k)) continue;
    w.watcher.close();
    s.watches.delete(k);
  }
  for (const w of want.values()) watchFolder(w.account, w.path);
}

/** One folder watched live for an account (already watched: nothing changes). Answers whether it is watched now. */
export function watchFolder(account: string, folder: string): boolean {
  const s = state();
  const k = `${account}|${folder}`;
  if (s.watches.has(k)) return true;
  const local = toLocalPath(folder);
  if (!fs.existsSync(local)) return false; // a drive not connected: tried again on the next refresh
  try {
    const watcher = fs.watch(/*turbopackIgnore: true*/ local, { recursive: true, persistent: false }, (_event, name) => {
      if (!ignored(name ? String(name) : null)) schedule(account);
    });
    watcher.on("error", () => {
      // The folder went away (a drive pulled out): dropped; the next refresh makes it again if it comes back.
      watcher.close();
      s.watches.delete(k);
    });
    s.watches.set(k, { account, path: folder, watcher });
    return true;
  } catch (e) {
    console.error(`[explorer] watching ${folder} failed`, e);
    return false;
  }
}

/** The folders watched live for this account (by their path as Documents keeps it). */
export function liveFolders(account: string): string[] {
  return [...state().watches.values()].filter((w) => w.account === account).map((w) => w.path);
}

/** Started once per server (not in tests): the watchers made now and kept up with the folders and plugins every minute. */
export function startWatching(): void {
  const s = state();
  if (s.refresher || process.env.NODE_ENV === "test" || process.env.DATABASE_PATH?.includes("zeff-test-")) return;
  const tick = () => void refreshWatchers().catch((e) => console.error("[explorer] keeping the watchers up to date failed", e));
  s.refresher = setInterval(tick, 60_000);
  s.refresher.unref?.();
  setTimeout(tick, 5000).unref?.();
}
