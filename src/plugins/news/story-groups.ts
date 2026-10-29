import { BIG_STORY, type NewsItem } from "./shared";

/**
 * The stories at the top of the feed (round pictures, tap one and it plays): "Important" first — what the agent found
 * important and the best report of each big story (many outlets on it) — then the stories that run through your news, each
 * told from its first report to its latest. Without stories yet (no tags), the best unseen items make one. Pure, client-safe.
 */
export type StoryGroup = { key: string; label: string; kind: "top" | "story" | "best"; items: NewsItem[] };

export function storyGroups(pool: NewsItem[], opts: { max?: number; perGroup?: number } = {}): StoryGroup[] {
  const max = opts.max ?? 10;
  const per = opts.perGroup ?? 8;
  const live = pool.filter((i) => i.state !== "hidden" && i.gate !== "drop");
  const unseenFirst = (a: NewsItem, b: NewsItem) => Number(a.seen) - Number(b.seen) || b.score - a.score;
  const groups: StoryGroup[] = [];

  // Important: the agent's top, and one report (the best) of each big story.
  const bigBest = new Map<string, NewsItem>();
  for (const it of live) if (it.story && it.storySources >= BIG_STORY && (!bigBest.has(it.story) || bigBest.get(it.story)!.score < it.score)) bigBest.set(it.story, it);
  const important = [...new Map([...live.filter((i) => i.gate === "top"), ...bigBest.values()].map((i) => [i.id, i])).values()].sort(unseenFirst).slice(0, per);
  if (important.length) groups.push({ key: "top", label: "Important", kind: "top", items: important });

  // The stories: a label with at least two reports from at least two outlets (one outlet's run is no story), the ones with most unseen and the best first; each told oldest first.
  const byStory = new Map<string, NewsItem[]>();
  for (const it of live) if (it.story) byStory.set(it.story, [...(byStory.get(it.story) ?? []), it]);
  const ranked = [...byStory]
    .filter(([, list]) => list.length >= 2 && list[0].storySources >= 2)
    .map(([label, list]) => ({ label, list, unseen: list.filter((i) => !i.seen).length, best: Math.max(...list.map((i) => i.score)) }))
    .sort((a, b) => Number(b.unseen > 0) - Number(a.unseen > 0) || b.best - a.best || b.list.length - a.list.length);
  for (const s of ranked.slice(0, max - groups.length)) groups.push({ key: `story:${s.label}`, label: s.label, kind: "story", items: [...s.list].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).slice(-per) });

  // Too few to swipe through: the best unseen ones are a story of their own.
  if (groups.length < 3) {
    const used = new Set(groups.flatMap((g) => g.items.map((i) => i.id)));
    const best = live.filter((i) => !i.seen && !used.has(i.id)).sort((a, b) => b.score - a.score).slice(0, per);
    if (best.length >= 2) groups.push({ key: "best", label: "Best of now", kind: "best", items: best });
  }
  return groups;
}
