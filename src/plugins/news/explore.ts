import { buildIndex, related, trending, wild, type Bubble, type Index } from "./explore-core";
import { getPrefs, learnedTop, recentForExplore } from "./store";

/**
 * Explore, composed: the map of the last days' news (kept for a few minutes), and from it the bubble fields — the home
 * (what is rising, what is yours, what is out there) and the field around one thing (what hangs together with it).
 * Server only.
 */
const g = globalThis as { __zeffNewsIndex?: { at: number; ix: Index } };

/** The index of the recent news (rebuilt when it is older than three minutes). */
export function exploreIndex(nowMs: number = Date.now()): Index {
  if (g.__zeffNewsIndex && nowMs - g.__zeffNewsIndex.at < 180_000) return g.__zeffNewsIndex.ix;
  const ix = buildIndex(recentForExplore(3, 4000));
  g.__zeffNewsIndex = { at: nowMs, ix };
  return ix;
}

/** Your own things (interests, what you liked) as bubbles — with how much news there is on each right now. */
export function yoursBubbles(ix: Index, limit = 8): Bubble[] {
  const prefs = getPrefs();
  const mine = [...prefs.interests.map((i) => i.term), ...learnedTop(6).map((l) => l.term)];
  const seen = new Set<string>();
  return mine.flatMap((term): Bubble[] => {
    const k = term.toLowerCase();
    if (seen.has(k)) return [];
    seen.add(k);
    // A term of yours matches the news as a word in headlines: count the items (any term containing it).
    let count = ix.terms.get(k)?.items.size ?? 0;
    if (!count) for (const [t, v] of ix.terms) if (t.includes(k)) count += v.items.size;
    return count ? [{ term, count, weight: Math.min(1, 0.45 + count / 20), kind: "yours" as const }] : [];
  }).slice(0, limit);
}

export type Field = { trending: Bubble[]; yours: Bubble[]; wild: Bubble[] };

/** The home: what is rising, what is yours, what is out there. `seed` changes the out-there bubbles (every ten minutes by default). */
export function exploreHome(nowMs: number = Date.now(), seed: number = Math.floor(nowMs / 600_000)): Field {
  const ix = exploreIndex(nowMs);
  const yours = yoursBubbles(ix);
  return { trending: trending(ix, nowMs, 9), yours, wild: wild(ix, yours.map((y) => y.term), seed, 7) };
}

/** The field round one thing: its related bubbles, how much news names it, which outlets cover it most. */
export function exploreTopic(term: string, nowMs: number = Date.now()): { count: number; related: Bubble[]; outlets: { name: string; count: number }[]; stories: { label: string; count: number }[] } {
  const ix = exploreIndex(nowMs);
  const here = ix.terms.get(term.toLowerCase());
  const mine = new Set(yoursBubbles(ix, 12).map((b) => b.term.toLowerCase()));
  const rel = related(ix, term, 12).map((b) => (mine.has(b.term.toLowerCase()) ? { ...b, kind: "yours" as const } : b));
  const outlets = new Map<string, number>();
  for (const id of here?.items ?? []) {
    const name = ix.items.get(id)!.sourceName;
    outlets.set(name, (outlets.get(name) ?? 0) + 1);
  }
  // The stories (AI labels) that name it — the red threads through it.
  const stories = new Map<string, number>();
  for (const id of here?.items ?? []) {
    const label = ix.items.get(id)!.story;
    if (label) stories.set(label, (stories.get(label) ?? 0) + 1);
  }
  return { count: here?.items.size ?? 0, related: rel, stories: [...stories].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 5), outlets: [...outlets].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5) };
}

/** "Surprise me": one of the out-there bubbles (a different one each minute). */
export function surpriseTerm(home: Field, nowMs: number = Date.now()): string | undefined {
  return home.wild[Math.floor(nowMs / 60_000) % Math.max(1, home.wild.length)]?.term;
}
