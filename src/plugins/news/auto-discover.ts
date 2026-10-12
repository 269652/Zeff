import { getPref, setPref } from "@/lib/prefs";
import { findFeeds, type FinderDeps } from "./finder";
import { addSource, getPrefs, listSources } from "./store";

/**
 * Finding feeds by itself: once a day (when it is on), for two of your interests — different ones each day — the finder
 * looks for feeds and the best few are added (category "Discovered"). What it added is logged, so you see what it did and
 * can remove it. A fresh interest therefore gets sources without anyone searching.
 */
export type Discovery = { at: string; topic: string; name: string; url: string; why: string };

export const discoveries = (): Discovery[] => getPref<Discovery[]>("news:discoveries", []);

const DAY = 864e5;

export async function autoDiscover(deps: { now?: () => number; find?: typeof findFeeds; finder?: FinderDeps; perTopic?: number; topics?: number } = {}): Promise<number> {
  const prefs = getPrefs();
  const nowMs = (deps.now ?? Date.now)();
  if (!prefs.autoDiscover || !prefs.interests.length) return 0;
  const last = Number(getPref<number>("news:autodiscover-at", 0));
  if (nowMs - last < DAY * 0.9) return 0;
  setPref("news:autodiscover-at", nowMs); // (also when it finds nothing: tomorrow again, not at every sync)

  const day = Math.floor(nowMs / DAY);
  const ranked = [...prefs.interests].sort((a, b) => b.weight - a.weight);
  const topics = Array.from({ length: Math.min(deps.topics ?? 2, ranked.length) }, (_, i) => ranked[(day * 2 + i) % ranked.length]);
  const hostOf = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const have = new Set(listSources().map((s) => hostOf(s.url)));
  const log: Discovery[] = [];
  for (const topic of topics) {
    const found = await (deps.find ?? findFeeds)(topic.term, { ...deps.finder, have, language: prefs.language, limit: 6 });
    for (const s of found.slice(0, deps.perTopic ?? 2)) {
      if (have.has(s.domain)) continue;
      addSource({ name: s.feed.title.slice(0, 80), url: s.feed.url, category: "Discovered", lang: prefs.language === "any" ? "" : prefs.language });
      have.add(s.domain);
      log.push({ at: new Date(nowMs).toISOString(), topic: topic.term, name: s.feed.title.slice(0, 80), url: s.feed.url, why: s.why });
    }
  }
  if (log.length) setPref("news:discoveries", [...log, ...discoveries()].slice(0, 40));
  return log.length;
}
