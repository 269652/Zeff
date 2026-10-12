import { getPref, setPref } from "@/lib/prefs";
import { findFeeds, type FinderDeps } from "./finder";
import type { ProfileTerm } from "./shared";
import { addSource, getPrefs, learnedTop, listSources, unseenCount } from "./store";

/**
 * Finding feeds by itself, in two ways:
 *   · daily — once a day, for two of the things you care about (different ones each day);
 *   · when fresh news run low — as soon as fewer than LOW_UNSEEN unseen items are left (the feed is about to run dry), a
 *     search goes out for three things you care about, at most every two hours and at most 12 feeds a day, and the new
 *     feeds are fetched straight away (the sync does that), so the stream doesn't stop.
 * "Things you care about": your interests, the words of what you liked, and what Zeff knows about you (facts, open todos,
 * tickets). The best feeds the finder checks are added (category "Discovered"); what it added is logged, so you see it
 * and can remove it — and a source you then keep disliking is paused by itself.
 */
export type Discovery = { at: string; topic: string; name: string; url: string; why: string; reason?: "daily" | "low" };

export const discoveries = (): Discovery[] => getPref<Discovery[]>("news:discoveries", []);

const DAY = 864e5;
/** Fewer unseen items than this: the feed is running out. */
export const LOW_UNSEEN = 80;
const LOW_COOLDOWN = 2 * 3600e3;
const LOW_DAILY_CAP = 12;

type Wanted = { term: string; weight: number };
export type DiscoverDeps = { now?: () => number; find?: typeof findFeeds; finder?: FinderDeps; perTopic?: number; topics?: number; profile?: () => Promise<ProfileTerm[]> | ProfileTerm[]; unseen?: () => number };

/** What to look for: interests, the words of what you liked, and what Zeff knows about you — strongest first. */
export async function wantedTopics(deps: Pick<DiscoverDeps, "profile"> = {}): Promise<Wanted[]> {
  const prefs = getPrefs();
  const own = new Set(prefs.interests.map((i) => i.term.toLowerCase()));
  const out: Wanted[] = prefs.interests.map((i) => ({ term: i.term, weight: i.weight }));
  for (const l of learnedTop(8)) if (!own.has(l.term)) out.push({ term: l.term, weight: Math.min(3, l.score / 2) });
  if (prefs.useProfile) {
    try {
      const terms = await (deps.profile ?? (async () => (await import("./profile")).profileTerms()))();
      for (const p of terms.slice(0, 12)) if (!own.has(p.term.toLowerCase()) && !out.some((o) => o.term.toLowerCase() === p.term.toLowerCase())) out.push({ term: p.term, weight: p.weight * 0.8 });
    } catch {
      // no profile: the rest
    }
  }
  return out.sort((a, b) => b.weight - a.weight);
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** One round: look for feeds on `topics`, add the best `perTopic` of each that isn't there yet. Returns how many were added. */
async function round(topics: Wanted[], reason: "daily" | "low", deps: DiscoverDeps, nowMs: number): Promise<number> {
  const prefs = getPrefs();
  const have = new Set(listSources().map((s) => hostOf(s.url)));
  const log: Discovery[] = [];
  for (const topic of topics) {
    const found = await (deps.find ?? findFeeds)(topic.term, { ...deps.finder, have, language: prefs.language, limit: 6 });
    for (const s of found.slice(0, deps.perTopic ?? 2)) {
      if (have.has(s.domain)) continue;
      addSource({ name: s.feed.title.slice(0, 80), url: s.feed.url, category: "Discovered", lang: prefs.language === "any" ? "" : prefs.language });
      have.add(s.domain);
      log.push({ at: new Date(nowMs).toISOString(), topic: topic.term, name: s.feed.title.slice(0, 80), url: s.feed.url, why: s.why, reason });
    }
  }
  if (log.length) setPref("news:discoveries", [...log, ...discoveries()].slice(0, 60));
  return log.length;
}

/** Once a day: two of the things you care about, different ones each day. */
export async function autoDiscover(deps: DiscoverDeps = {}): Promise<number> {
  const prefs = getPrefs();
  const nowMs = (deps.now ?? Date.now)();
  if (!prefs.autoDiscover) return 0;
  const wanted = await wantedTopics(deps);
  if (!wanted.length) return 0;
  const last = Number(getPref<number>("news:autodiscover-at", 0));
  if (nowMs - last < DAY * 0.9) return 0;
  setPref("news:autodiscover-at", nowMs); // (also when it finds nothing: tomorrow again, not at every sync)
  const day = Math.floor(nowMs / DAY);
  const topics = Array.from({ length: Math.min(deps.topics ?? 2, wanted.length) }, (_, i) => wanted[(day * 2 + i) % wanted.length]);
  return round(topics, "daily", deps, nowMs);
}

/** How many feeds were added today by the "running low" searches. */
const addedToday = (nowMs: number) => discoveries().filter((d) => d.reason === "low" && nowMs - Date.parse(d.at) < DAY).length;

let searching = false;
export const isSearching = () => searching;

/**
 * Fresh news running low: fewer than LOW_UNSEEN unseen items — look for new feeds now (three things you care about, a different
 * three each time), if it hasn't just done so. Returns how many feeds it added (0: not low, too soon, nothing found).
 */
export async function discoverWhenLow(deps: DiscoverDeps = {}): Promise<number> {
  const prefs = getPrefs();
  const nowMs = (deps.now ?? Date.now)();
  if (!prefs.autoDiscover || searching) return 0;
  if ((deps.unseen ?? (() => unseenCount(prefs.maxAgeDays)))() >= LOW_UNSEEN) return 0;
  if (nowMs - Number(getPref<number>("news:lowdiscover-at", 0)) < LOW_COOLDOWN) return 0;
  if (addedToday(nowMs) >= LOW_DAILY_CAP) return 0;
  const wanted = await wantedTopics(deps);
  if (!wanted.length) return 0;
  searching = true;
  try {
    setPref("news:lowdiscover-at", nowMs);
    const turn = Number(getPref<number>("news:low-turn", 0));
    setPref("news:low-turn", turn + 1);
    const topics = Array.from({ length: Math.min(deps.topics ?? 3, wanted.length) }, (_, i) => wanted[(turn * 3 + i) % wanted.length]);
    return await round(topics, "low", { ...deps, perTopic: deps.perTopic ?? 3 }, nowMs);
  } finally {
    searching = false;
  }
}
