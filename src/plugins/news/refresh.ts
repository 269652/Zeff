import { discoverWhenLow } from "./auto-discover";
import { expandFromCatalog } from "./expand";
import { aiTagBatch, retagAll } from "./retag";
import { countItems, getPrefs, listSources, unseenCount } from "./store";
import { syncNews, type NewsSyncDeps } from "./sync";

/**
 * Refresh: bring the feed back to a full stream — at least REFRESH_TARGET unseen cards to scroll through before anything has to
 * be loaded. Every source is fetched; if that leaves fewer unseen cards than the target, sources are added (the catalog first,
 * the internet search when the catalog is used up) and fetched, round after round, until the target is met, the sources
 * run out, or the time is. It runs in the background and reports where it is (phase, unseen so far).
 */
export const REFRESH_TARGET = 200;

export type RefreshStatus = {
  running: boolean;
  phase: string;
  unseen: number;
  target: number;
  newItems: number;
  sourcesAdded: number;
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
};

const g = globalThis as { __zeffNewsRefresh?: RefreshStatus };
const idle = (): RefreshStatus => ({ running: false, phase: "", unseen: 0, target: REFRESH_TARGET, newItems: 0, sourcesAdded: 0, startedAt: null, finishedAt: null, message: "" });
export const getRefreshStatus = (): RefreshStatus => g.__zeffNewsRefresh ?? idle();
const set = (patch: Partial<RefreshStatus>) => (g.__zeffNewsRefresh = { ...getRefreshStatus(), ...patch });

export type RefreshDeps = {
  target?: number;
  budgetMs?: number;
  maxRounds?: number;
  sync?: (deps: NewsSyncDeps) => Promise<{ ok: boolean; message: string }>;
  expand?: (batch: number) => { added: number; left: number };
  discover?: () => Promise<number>;
  unseen?: () => number;
  syncDeps?: NewsSyncDeps;
};

/** Starts a refresh in the background (one at a time). Returns the status at once. */
export function startRefresh(deps: RefreshDeps = {}): { status: RefreshStatus; promise: Promise<RefreshStatus> } {
  if (getRefreshStatus().running) return { status: getRefreshStatus(), promise: Promise.resolve(getRefreshStatus()) };
  // Only the newest and the best are kept: the target is what fits in that (none with the funnel on — it fetches, it doesn't add sources).
  const target = deps.target ?? (getPrefs().funnel ? 0 : Math.min(REFRESH_TARGET, Math.floor(getPrefs().keepLatest / 3)));
  set({ ...idle(), running: true, phase: "Fetching your sources …", target, startedAt: new Date().toISOString() });
  const promise = run(deps, target).catch((e) => set({ running: false, phase: "", finishedAt: new Date().toISOString(), message: `Failed: ${e instanceof Error ? e.message : String(e)}` }));
  return { status: getRefreshStatus(), promise };
}

async function run(deps: RefreshDeps, target: number): Promise<RefreshStatus> {
  const t0 = Date.now();
  const budget = deps.budgetMs ?? 4 * 60_000;
  const sync = deps.sync ?? syncNews;
  const unseen = deps.unseen ?? (() => unseenCount(getPrefs().maxAgeDays));
  const before = countItems();
  // Rounds fetch without the extras (no discovery, no AI): those come once at the end.
  const quiet: NewsSyncDeps = { ...deps.syncDeps, noLow: true, discoverFeeds: async () => 0, discoverWhenLow: async () => 0, aiTags: async () => undefined };
  let sourcesAdded = 0;
  const progress = (phase: string) => set({ phase, unseen: unseen(), newItems: countItems() - before, sourcesAdded });

  await sync({ ...quiet, all: true });
  progress("Fetched all sources");
  for (let round = 0; round < (deps.maxRounds ?? 6) && unseen() < target && Date.now() - t0 < budget; round++) {
    const have = new Set(listSources().map((s) => s.id));
    progress(`Only ${unseen()} unseen cards — adding sources …`);
    let added = (deps.expand ?? expandFromCatalog)(40).added;
    if (!added) {
      progress("Catalog used up — searching the internet for new sources …");
      added = await (deps.discover ?? (() => discoverWhenLow({ force: true })))();
    }
    if (!added) break; // nothing more to add: this is what there is
    sourcesAdded += added;
    const fresh = listSources().filter((s) => !have.has(s.id)).map((s) => s.id);
    progress(`Fetching ${fresh.length} new sources …`);
    await sync({ ...quiet, onlyIds: fresh });
  }
  progress("Tagging …");
  try {
    retagAll();
    await aiTagBatch();
  } catch {
    // tags are a bonus
  }
  // The AI tags more of the new cards in the background (a batch each, up to three) — the refresh itself doesn't wait for it.
  void (async () => {
    try {
      for (let i = 0; i < 3; i++) if (!(await aiTagBatch())) break;
    } catch {
      // tags are a bonus
    }
  })();
  const u = unseen();
  return set({
    running: false,
    phase: "",
    unseen: u,
    newItems: countItems() - before,
    sourcesAdded,
    finishedAt: new Date().toISOString(),
    message: `${countItems() - before} new items${sourcesAdded ? `, ${sourcesAdded} sources added` : ""} — ${u} unseen cards${u < target ? ` (the sources have no more fresh news right now)` : ""}`,
  });
}
