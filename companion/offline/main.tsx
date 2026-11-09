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

  if (host.locked?.()) return <div className="zo-empty zo-locked">🔒 {tr("lockedAccount")}</div>;
  if (!engine) return <div className="zo-empty">{tr("emptyCopy")}</div>;
  const ctx: Ctx = { engine, rev, edit, online };
  const waiting = engine.pending().length;
  const conflicts = engine.conflicts().length + engine.failures().length;
  const lastSync = engine.lastSync;
  const go = (t: Tab) => (setTab(t), localStorage.setItem("zeff.offline.tab", t));

  return (
    <ReplicaCtx.Provider value={ctx}>
      <div className="zo">
        <header className="zo-bar">
          <span className={`zo-dot ${online ? "on" : ""}`} aria-hidden />
          <span className="zo-state">
            {online ? tr("live") : tr("offline")}
            {waiting ? ` · ${tr("waiting", { n: waiting })}` : ""}
            {" · "}
            {syncing ? tr("syncing") : lastSync ? tr("asOf", { time: fmtTime(lastSync) }) : tr("never")}
          </span>
          {online && (
            <button type="button" className="zo-btn" onClick={() => void sync()} disabled={syncing}>
              ↻
            </button>
          )}
          {online && host.showFull && (
            <button type="button" className="zo-btn" onClick={host.showFull}>
              {tr("fullZeff")}
            </button>
          )}
        </header>
        {error && <p className="zo-error">{tr("syncFailed", { error })}</p>}
        <main className="zo-main">
          {tab === "Todos" && <TodosView />}
          {tab === "Workspace" && <WorkspaceView />}
          {tab === "Calendar" && <CalendarView />}
          {tab === "Seen" && <SeenView />}
          {tab === "Conflicts" && <ConflictsView onDone={bump} />}
        </main>
        <nav className="zo-tabs">
          {TABS.filter((t) => t !== "Conflicts" || conflicts > 0 || tab === "Conflicts").map((t) => (
            <button key={t} type="button" className={tab === t ? "on" : ""} aria-current={tab === t ? "page" : undefined} onClick={() => go(t)}>
              {tr(t)}
              {t === "Conflicts" && conflicts > 0 ? ` (${conflicts})` : ""}
            </button>
          ))}
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
