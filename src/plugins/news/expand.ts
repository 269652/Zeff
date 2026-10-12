import { getPref, setPref } from "@/lib/prefs";
import { ALL_FEEDS, STARTER_NAMES, type CatalogFeed } from "./catalog";
import type { NewsPrefs } from "./shared";
import { addSources, getPrefs, learnedTop, listSources } from "./store";

/**
 * More sources from the catalog, when the ones there are don't give enough fresh news: the catalog's feeds that aren't
 * yours yet, best fit first — your language, the starter pack, outlets before searches, and whatever matches what you are
 * interested in or liked. This is the fast way to volume (checked feeds, no search needed); the finder (the internet
 * search) takes over when the catalog is used up.
 */
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/** The `batch` catalog feeds that fit best and aren't added yet (pure: what you have and what you like are given). */
export function pickFromCatalog(have: Set<string>, prefs: Pick<NewsPrefs, "language" | "interests">, liked: string[], batch: number, feeds: CatalogFeed[] = ALL_FEEDS): CatalogFeed[] {
  const terms = [...prefs.interests.map((i) => i.term), ...liked].map((t) => t.toLowerCase()).filter((t) => t.length >= 3);
  const score = (f: CatalogFeed): number => {
    let s = 0;
    const hay = `${f.name} ${f.category}`.toLowerCase();
    const match = terms.some((t) => hay.includes(t));
    if (prefs.language === "any") s += 1.5;
    else if (f.lang === prefs.language) s += 2;
    else if (f.lang === "en") s += 1;
    else s -= 1;
    if (STARTER_NAMES.includes(f.name)) s += 3;
    if (f.category === "Topics") s += match ? 4 : -0.5;
    else s += 1 + (match ? 2 : 0);
    return s + (hash(f.url) % 100) / 400; // a stable shuffle among equals
  };
  return feeds
    .filter((f) => !have.has(f.url))
    .map((f) => ({ f, s: score(f) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, batch)
    .map((x) => x.f);
}

/** Adds the next batch; returns how many were added and how many catalog feeds are left. */
export function expandFromCatalog(batch = 40, feeds: CatalogFeed[] = ALL_FEEDS): { added: number; left: number } {
  const have = new Set(listSources().map((s) => s.url));
  const picks = pickFromCatalog(have, getPrefs(), learnedTop(8).map((l) => l.term), batch, feeds);
  const added = addSources(picks);
  return { added, left: feeds.filter((f) => !have.has(f.url)).length - added };
}

/** The same, but not more often than every half hour (the background sync asks every round). */
export function expandWhenLow(nowMs: number = Date.now(), batch = 30): number {
  if (nowMs - Number(getPref<number>("news:expand-at", 0)) < 30 * 60_000) return 0;
  const r = expandFromCatalog(batch);
  if (r.added) setPref("news:expand-at", nowMs);
  return r.added;
}
