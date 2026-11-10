/**
 * Zeff on the go: the app at app.getzeff.com without the PC — your todos, the Workspace (pages, tables, boards) and the
 * calendar from the phone's own copy (src/lib/replica/engine.ts), edited here and queued; sent and refreshed whenever
 * the PC is reachable (at home on the Wi-Fi, or over the tunnel). companion/app/_zc/app.js mounts it (`mountOffline`)
 * and lends it the connection to the PC (`transport`) while there is one. Bundled by scripts/companion-build.mjs.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReplicaEngine, idbStore, type Edit, type Transport } from "@/lib/replica/engine";
import type { Tmp } from "@/lib/replica/shared";
import { fmtTime, tr } from "./words";
import { TodosView } from "./todos";
import { WorkspaceView } from "./workspace";
import { CalendarView } from "./calendar";
import { ConflictsView } from "./conflicts";
import { SeenView } from "./seen";

export type Host = {
  /** The account shown (null: none known yet). */
  account(): string | null;
  /** Its route on the PC ("/privat"; ""). */
  prefix(): string;
  /** The way to Zeff on the PC — null while it isn't reachable. */
  transport(): Transport | null;
  /** Called when the connection or the account changes. Returns: stop listening. */
  onChange(fn: () => void): () => void;
  /** Show the whole Zeff (only while connected). */
  showFull?: () => void;
  /** Called when something changed in Zeff on the PC (pushed while connected). Returns: stop listening. */
  onRemoteChange?(fn: () => void): () => void;
  /** The account is locked on the PC (Zeff's lock): nothing of it here. */
  locked?(): boolean;
  /** Every account the phone knows (id, route, locked) — their queued edits go too while the PC is reachable. */
  accounts?(): { id: string; prefix: string; locked?: boolean }[];
};

type Ctx = { engine: ReplicaEngine; rev: number; edit: (e: Edit) => Promise<Tmp | undefined>; online: boolean };
const ReplicaCtx = createContext<Ctx | null>(null);
export const useReplica = () => useContext(ReplicaCtx)!;

const kv = idbStore();
const TABS = ["Todos", "Workspace", "Calendar", "Seen", "Conflicts"] as const;
type Tab = (typeof TABS)[number];

function App({ host }: { host: Host }) {
  const [account, setAccount] = useState(host.account());
  const [online, setOnline] = useState(!!host.transport());
  // The account's engine once loaded (another account's while the next one loads is not shown).
  const [loaded, setLoaded] = useState<{ account: string; engine: ReplicaEngine } | null>(null);
  const engine = loaded && loaded.account === account ? loaded.engine : null;
  const [rev, setRev] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem("zeff.offline.tab") as Tab) || "Todos");
  const [more, setMore] = useState(false);
  const bump = useCallback(() => setRev((r) => r + 1), []);

  useEffect(() => host.onChange(() => (setAccount(host.account()), setOnline(!!host.transport()))), [host]);
  useEffect(() => {
    if (!account) return;
    const e = new ReplicaEngine(kv, account);
    let live = true;
    void e.load().then(() => live && setLoaded({ account, engine: e }));
    return () => void (live = false);
  }, [account]);

  const busy = useRef(false);
  const sync = useCallback(async () => {
    const t = host.transport();
    if (!engine || !t || busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      await engine.sync(t, host.prefix());
      // The other accounts' edits made while away (each to its own account on the PC).
      for (const a of host.accounts?.() ?? []) {
        if (a.id === engine.account || a.locked || !(await ReplicaEngine.pendingOf(kv, a.id))) continue;
        const other = new ReplicaEngine(kv, a.id);
        await other.load();
        await other.sync(t, a.prefix);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busy.current = false;
      setSyncing(false);
      bump();
    }
  }, [engine, host, bump]);

  // Synced when the PC is reachable: at once, then every two minutes, and shortly after an edit.
  useEffect(() => {
    if (!online || !engine) return;
    const first = setTimeout(() => void sync(), 0);
    const timer = setInterval(() => void sync(), 120_000);
    return () => (clearTimeout(first), clearInterval(timer));
  }, [online, engine, sync]);
  // A change on the PC: fetched shortly after (several in a row make one sync).
  const remote = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () =>
      host.onRemoteChange?.(() => {
        if (remote.current) clearTimeout(remote.current);
        remote.current = setTimeout(() => void sync(), 1500);
      }),
    [host, sync],
  );
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edit = useCallback(
    async (e: Edit) => {
      if (!engine) return undefined;
      const tmp = await engine.edit(e);
      bump();
      if (soon.current) clearTimeout(soon.current);
      soon.current = setTimeout(() => void sync(), 1500);
      return tmp;
    },
    [engine, bump, sync],
  );

  if (host.locked?.()) return <div data-zo="locked" className="p-6 text-center text-sm text-zinc-500">🔒 {tr("lockedAccount")}</div>;
  if (!engine) return <div className="p-6 text-center text-sm text-zinc-500">{tr("emptyCopy")}</div>;
  const ctx: Ctx = { engine, rev, edit, online };
  const waiting = engine.pending().length;
  const conflicts = engine.conflicts().length + engine.failures().length;
  const lastSync = engine.lastSync;
  const go = (t: Tab) => (setTab(t), setMore(false), localStorage.setItem("zeff.offline.tab", t));
  // Zeff's own bar at the bottom of a phone (src/components/SiteHeader.tsx): the main screens a thumb away, "More" for the rest.
  const tabs: { id: Tab; icon: string }[] = [
    { id: "Todos", icon: "M5 10.5l3 3 7-7" },
    { id: "Workspace", icon: "M5.5 3.5h6l3 3v10h-9zM11.5 3.5v3h3M7.5 10h5M7.5 13h5" },
    { id: "Calendar", icon: "M4 5.5h12v10.5H4zM4 8.5h12M7.5 3.5v3M12.5 3.5v3" },
  ];
  const tabClass = (on: boolean) => `relative flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 px-1 py-2 text-xs font-medium ${on ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-600 dark:text-zinc-400"}`;

  return (
    <ReplicaCtx.Provider value={ctx}>
      <div className="min-h-full pb-24 font-sans text-[var(--foreground)]">
        {/* Where things stand: connected or offline, what waits to be sent, when it last synced. */}
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-zinc-200 bg-white/90 px-4 py-2 text-xs text-zinc-600 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90 dark:text-zinc-400" role="status">
          <span className={`size-2 shrink-0 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
          <span data-zo="state" className="min-w-0 flex-1 truncate">
            {online ? tr("live") : tr("offline")}
            {waiting ? ` · ${tr("waiting", { n: waiting })}` : ""}
            {" · "}
            {syncing ? tr("syncing") : lastSync ? tr("asOf", { time: fmtTime(lastSync) }) : tr("never")}
          </span>
          {online && (
            <button type="button" className="btn btn-sm" onClick={() => void sync()} disabled={syncing} aria-label={tr("syncing")}>
              ↻
            </button>
          )}
          {online && host.showFull && (
            <button type="button" className="btn btn-sm btn-primary" onClick={host.showFull}>
              {tr("fullZeff")}
            </button>
          )}
        </div>
        {error && <p className="mx-3 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{tr("syncFailed", { error })}</p>}
        <main className="mx-auto w-full max-w-3xl px-3 py-3">
          {tab === "Todos" && <TodosView />}
          {tab === "Workspace" && <WorkspaceView />}
          {tab === "Calendar" && <CalendarView />}
          {tab === "Seen" && <SeenView />}
          {tab === "Conflicts" && <ConflictsView onDone={bump} />}
        </main>
        {/* "More": the rest — pages as last seen, the conflicts, all of Zeff while connected. */}
        {more && (
          <div className="fixed inset-0 z-30 bg-black/30" onClick={() => setMore(false)}>
            <div className="card absolute inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] space-y-1 p-2" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => go("Seen")}>
                {tr("Seen")}
              </button>
              <button type="button" className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => go("Conflicts")}>
                {tr("Conflicts")}
                {conflicts > 0 && <span className="ml-auto rounded-full bg-red-100 px-2 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">{conflicts}</span>}
              </button>
              {online && host.showFull && (
                <button type="button" className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm font-medium text-indigo-700 hover:bg-zinc-100 dark:text-indigo-300 dark:hover:bg-zinc-800" onClick={host.showFull}>
                  {tr("fullZeff")} →
                </button>
              )}
            </div>
          </div>
        )}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-zinc-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90" aria-label="Main">
          {tabs.map(({ id, icon }) => (
            <button key={id} type="button" className={tabClass(tab === id && !more)} aria-current={tab === id ? "page" : undefined} onClick={() => go(id)}>
              {tab === id && !more && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-indigo-600 dark:bg-indigo-400" aria-hidden />}
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={icon} />
              </svg>
              <span className="max-w-full truncate">{tr(id)}</span>
            </button>
          ))}
          <button type="button" className={tabClass(more || tab === "Seen" || tab === "Conflicts")} aria-expanded={more} onClick={() => setMore((m) => !m)}>
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="M4 6h12M4 10h12M4 14h12" />
            </svg>
            <span>{tr("More")}</span>
            {conflicts > 0 && <span className="absolute top-1 left-[calc(50%+0.5rem)] size-2 rounded-full bg-red-500" aria-hidden />}
          </button>
        </nav>
      </div>
    </ReplicaCtx.Provider>
  );
}

/** Mount the offline app into `el`. */
export function mountOffline(el: HTMLElement, host: Host): { unmount(): void } {
  const root = createRoot(el);
  root.render(<App host={host} />);
  return { unmount: () => root.unmount() };
}
