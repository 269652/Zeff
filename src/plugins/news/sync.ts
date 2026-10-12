import { parseFeed } from "./feed";
import { fetchArticle, type Article } from "./reader";
import { addItems, dueForFetch, fetchState, getPrefs, listSources, pauseDisliked, prune, recordFetch, rescore, setContent, setFetchState, UNREADABLE, withoutContent } from "./store";
import { tokens, topicFeedUrl, type ProfileTerm } from "./shared";

/**
 * The News sync: every enabled source (and one Google News search per interest, if you want those)
 * fetched, new items kept, everything scored again for you, old items pruned. No browser, no sign-in —
 * feeds are public; nothing of yours is sent except the address asked for.
 */
export type NewsSyncDeps = {
  fetchText?: (url: string) => Promise<string>;
  /** A feed fetched with what the server said last time (null text: not changed). Default: a real conditional GET. */
  fetchFeed?: (url: string) => Promise<{ text: string | null }>;
  /** Words your open todos are about (default: read from the todos). */
  work?: () => string[];
  /** What Zeff knows about you (default: facts, todos, tickets). */
  profile?: () => ProfileTerm[];
  now?: () => number;
  /** The AI tagging of a batch (default: when the LLM plugin is there and the preference is on). */
  aiTags?: () => Promise<void>;
  /** An article's page read (default: the reader; tests give their own). */
  fetchArticle?: (url: string) => Promise<Article>;
  /** Looks for new feeds by itself (default: the auto-discovery, when it is on). */
  discoverFeeds?: () => Promise<number>;
  /** Looks for new feeds because fresh news run low (default: the low-news discovery, when it is on). */
  discoverWhenLow?: () => Promise<number>;
  /** (internal) the round after a discovery fetches the new feeds and doesn't search again. */
  noLow?: boolean;
  /** After the sync: the AI overview (default: when the preference is on). */
  digest?: () => Promise<void>;
};

/** A feed fetched with ETag / Last-Modified from last time: an unchanged one answers 304 and costs next to nothing. */
const defaultFetchFeed = async (url: string): Promise<{ text: string | null }> => {
  const state = fetchState(url);
  const r = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; Zeff/1.0; news reader)",
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      ...(state.etag ? { "if-none-match": state.etag } : {}),
      ...(state.modified ? { "if-modified-since": state.modified } : {}),
    },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  if (r.status === 304) return { text: null };
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  setFetchState(url, r.headers.get("etag"), r.headers.get("last-modified"));
  return { text: (await r.text()).slice(0, 4_000_000) };
};

/** The words your open todos are about: the ones that come up, 5+ letters. */
export async function workWords(limit = 25): Promise<string[]> {
  try {
    const { listTodos } = await import("@/lib/boards/store");
    const count = new Map<string, number>();
    for (const todo of listTodos({ status: "open" })) for (const w of tokens(todo.text)) if (w.length >= 5) count.set(w, (count.get(w) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
  } catch {
    return [];
  }
}

/** Runs `fn` over `list`, `n` at a time. */
async function pool<T>(list: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, list.length) }, async () => {
      while (i < list.length) await fn(list[i++]);
    }),
  );
}

/** Everything recent scored again — after a sync, or when your interests, votes or sources changed. */
export async function rescoreAll(opts: { work?: () => string[]; profile?: () => ProfileTerm[]; nowMs?: number } = {}): Promise<number> {
  const prefs = getPrefs();
  const work = prefs.useWork ? await (opts.work ? Promise.resolve(opts.work()) : workWords()) : [];
  const profile = prefs.useProfile ? await (opts.profile ? Promise.resolve(opts.profile()) : (await import("./profile")).profileTerms()) : [];
  const byId = new Map(listSources().map((s) => [s.id, s]));
  return rescore((item) => {
    const s = item.sourceId ? byId.get(item.sourceId) : undefined;
    return { prefs, work, profile, sourceWeight: s?.weight ?? 1, sourceVotes: s?.votes ?? 0 };
  }, opts.nowMs);
}

export async function syncNews(deps: NewsSyncDeps = {}): Promise<{ ok: boolean; message: string }> {
  // New feeds found by itself first (once a day), so they are fetched in this very sync.
  let discovered = 0;
  try {
    discovered = await (deps.discoverFeeds ?? (async () => (await import("./auto-discover")).autoDiscover()))();
  } catch {
    // finding is a bonus; the sync goes on
  }
  const prefs = getPrefs();
  const fetchFeed = deps.fetchFeed ?? (deps.fetchText ? async (u: string) => ({ text: await deps.fetchText!(u) as string | null }) : defaultFetchFeed);
  const nowMs = (deps.now ?? Date.now)();
  // What you keep disliking is paused by itself (and says so); paused ones and ones that keep failing (tried once a day) are left out.
  const paused = pauseDisliked();
  // A round fetches a part of the feeds: the ones fetched longest ago (never fetched first), `perRun` of them — a steady trickle
  // of new things all day instead of one wave; the rest are next in line.
  const due = listSources().filter((s) => s.enabled && dueForFetch(s, (deps.now ?? Date.now)()));
  const sources = [...due].sort((a, b) => (a.lastAt ?? "").localeCompare(b.lastAt ?? "")).slice(0, Math.max(10, getPrefs().perRun));
  const topics = prefs.topicSearch ? [...prefs.interests].sort((a, b) => b.weight - a.weight).slice(0, 8) : [];
  if (!sources.length && !topics.length) return { ok: true, message: "No sources and no interests yet — add some under Settings → News." };

  const since = nowMs - prefs.maxAgeDays * 864e5;
  const jobs: { id: number | null; name: string; url: string }[] = [
    ...sources.map((s) => ({ id: s.id as number | null, name: s.name, url: s.url })),
    ...topics.map((i) => ({ id: null, name: `Google News: ${i.term}`, url: topicFeedUrl(i.term, prefs.language, prefs.maxAgeDays) })),
  ];
  let added = 0;
  const failed: string[] = [];
  let unchanged = 0;
  await pool(jobs, 8, async (job) => {
    try {
      const got = await fetchFeed(job.url);
      if (got.text === null) {
        unchanged++;
        if (job.id) recordFetch(job.id, null);
        return;
      }
      const items = parseFeed(got.text, new Date(nowMs).toISOString())
        .filter((it) => Date.parse(it.publishedAt) >= since)
        .slice(0, prefs.perSource);
      added += addItems({ id: job.id, name: job.name }, items);
      if (job.id) recordFetch(job.id, null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push(`${job.name}: ${msg}`);
      if (job.id) recordFetch(job.id, msg);
    }
  });

  await rescoreAll({ work: deps.work, profile: deps.profile, nowMs });
  prune(prefs.keepDays);

  // Reading ahead: the best unread items' whole text, so they open at once (a page that can't be read is marked, not retried).
  let read = 0;
  if (prefs.prefetch) {
    await pool(withoutContent(30, prefs.maxAgeDays), 3, async (it) => {
      try {
        const a = await (deps.fetchArticle ?? ((u: string) => fetchArticle(u)))(it.url);
        setContent(it.id, a.text, a.image);
        read++;
      } catch {
        setContent(it.id, UNREADABLE);
      }
    });
  }

  // What each headline is about: the corpus tagger always, the AI (when there is one) for a batch of the best unseen ones.
  try {
    (await import("./retag")).retagAll();
    await (deps.aiTags ?? (async () => void (await (await import("./retag")).aiTagBatch())))();
  } catch {
    // tags are a bonus; the sync goes on
  }

  let digestNote = "";
  if (prefs.digest) {
    try {
      await (deps.digest ?? (async () => void (await (await import("./digest")).buildDigest())))();
    } catch (e) {
      digestNote = ` · overview failed (${e instanceof Error ? e.message : String(e)})`.slice(0, 160);
    }
  }
  // Fresh news running low: look for new feeds now and fetch them straight away — the stream shouldn't run dry.
  let foundLow = 0;
  if (!deps.noLow) {
    try {
      foundLow = await (deps.discoverWhenLow ?? (async () => (await import("./auto-discover")).discoverWhenLow()))();
    } catch {
      // finding is a bonus
    }
    if (foundLow > 0) await syncNews({ ...deps, noLow: true, discoverFeeds: async () => 0 });
  }
  const ok = failed.length < jobs.length;
  const failNote = failed.length ? ` — ${failed.length} failed: ${failed.slice(0, 3).join("; ").slice(0, 300)}${failed.length > 3 ? " …" : ""}` : "";
  return { ok, message: `${added} new from ${jobs.length - failed.length} of ${jobs.length} sources${sources.length < due.length ? ` (this round; ${due.length - sources.length} more next)` : ""}${unchanged ? ` (${unchanged} unchanged)` : ""}${discovered ? `, ${discovered} new feeds found` : ""}${paused.length ? `, paused: ${paused.slice(0, 3).join(", ")}` : ""}${foundLow ? `, ${foundLow} new feeds found (fresh news were running low)` : ""}${read ? `, ${read} read in full` : ""}${failNote}${digestNote}` };
}
