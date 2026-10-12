import { parseFeed } from "./feed";
import { fetchArticle, type Article } from "./reader";
import { addItems, getPrefs, listSources, prune, recordFetch, rescore, setContent, UNREADABLE, withoutContent } from "./store";
import { tokens, topicFeedUrl } from "./shared";

/**
 * The News sync: every enabled source (and one Google News search per interest, if you want those)
 * fetched, new items kept, everything scored again for you, old items pruned. No browser, no sign-in —
 * feeds are public; nothing of yours is sent except the address asked for.
 */
export type NewsSyncDeps = {
  fetchText?: (url: string) => Promise<string>;
  /** Words your open todos are about (default: read from the todos). */
  work?: () => string[];
  now?: () => number;
  /** An article's page read (default: the reader; tests give their own). */
  fetchArticle?: (url: string) => Promise<Article>;
  /** After the sync: the AI overview (default: when the preference is on). */
  digest?: () => Promise<void>;
};

const defaultFetch = async (url: string): Promise<string> => {
  const r = await fetch(url, { headers: { "user-agent": "Zeff/1.0 (+news reader)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(20000), redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.text()).slice(0, 4_000_000);
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
export async function rescoreAll(opts: { work?: () => string[]; nowMs?: number } = {}): Promise<number> {
  const prefs = getPrefs();
  const work = prefs.useWork ? await (opts.work ? Promise.resolve(opts.work()) : workWords()) : [];
  const byId = new Map(listSources().map((s) => [s.id, s]));
  return rescore((item) => {
    const s = item.sourceId ? byId.get(item.sourceId) : undefined;
    return { prefs, work, sourceWeight: s?.weight ?? 1, sourceVotes: s?.votes ?? 0 };
  }, opts.nowMs);
}

export async function syncNews(deps: NewsSyncDeps = {}): Promise<{ ok: boolean; message: string }> {
  const prefs = getPrefs();
  const fetchText = deps.fetchText ?? defaultFetch;
  const nowMs = (deps.now ?? Date.now)();
  const sources = listSources().filter((s) => s.enabled);
  const topics = prefs.topicSearch ? [...prefs.interests].sort((a, b) => b.weight - a.weight).slice(0, 8) : [];
  if (!sources.length && !topics.length) return { ok: true, message: "No sources and no interests yet — add some under Settings → News." };

  const since = nowMs - prefs.maxAgeDays * 864e5;
  const jobs: { id: number | null; name: string; url: string }[] = [
    ...sources.map((s) => ({ id: s.id as number | null, name: s.name, url: s.url })),
    ...topics.map((i) => ({ id: null, name: `Google News: ${i.term}`, url: topicFeedUrl(i.term, prefs.language, prefs.maxAgeDays) })),
  ];
  let added = 0;
  const failed: string[] = [];
  await pool(jobs, 4, async (job) => {
    try {
      const items = parseFeed(await fetchText(job.url), new Date(nowMs).toISOString())
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

  await rescoreAll({ work: deps.work, nowMs });
  prune(prefs.keepDays);

  // Reading ahead: the best unread items' whole text, so they open at once (a page that can't be read is marked, not retried).
  let read = 0;
  if (prefs.prefetch) {
    await pool(withoutContent(12, prefs.maxAgeDays), 3, async (it) => {
      try {
        const a = await (deps.fetchArticle ?? ((u: string) => fetchArticle(u)))(it.url);
        setContent(it.id, a.text, a.image);
        read++;
      } catch {
        setContent(it.id, UNREADABLE);
      }
    });
  }

  let digestNote = "";
  if (prefs.digest) {
    try {
      await (deps.digest ?? (async () => void (await (await import("./digest")).buildDigest())))();
    } catch (e) {
      digestNote = ` · overview failed (${e instanceof Error ? e.message : String(e)})`.slice(0, 160);
    }
  }
  const ok = failed.length < jobs.length;
  return { ok, message: `${added} new from ${jobs.length - failed.length} of ${jobs.length} sources${read ? `, ${read} read in full` : ""}${failed.length ? ` — failed: ${failed.join("; ").slice(0, 300)}` : ""}${digestNote}` };
}
