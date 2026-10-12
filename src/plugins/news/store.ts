import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { DEFAULT_PREFS, normalizeUrl, scoreItem, snippetOf, titleKey, tokens, type NewsItem, type NewsPrefs, type NewsSource, type NewsState, type ScoreContext } from "./shared";
import type { FeedItem } from "./feed";

/**
 * News: the sources, the items fetched from them, what you made of them (read, saved, hidden, liked,
 * disliked) and the words that learned from that. Its own tables, made when first needed.
 */
function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists news_sources (id integer primary key autoincrement, name text not null, url text not null unique, enabled integer not null default 1, weight real not null default 1, votes integer not null default 0, last_at text, last_error text, created_at text not null);
    create table if not exists news_items (id integer primary key autoincrement, source_id integer references news_sources(id) on delete set null, source_name text not null, guid text not null, url text not null, url_key text not null unique, title text not null, title_key text not null, summary text not null default '', published_at text not null, fetched_at text not null, state text not null default 'new', vote integer not null default 0, score real not null default 0, reasons text not null default '[]');
    create index if not exists news_items_published on news_items (published_at);
    create index if not exists news_items_title on news_items (title_key);
    create table if not exists news_terms (term text primary key, score real not null);
  `);
  // Pictures and whole articles: columns added later.
  const cols = (d.prepare("pragma table_info(news_items)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("image")) d.exec("alter table news_items add column image text not null default ''");
  if (!cols.includes("content")) d.exec("alter table news_items add column content text not null default ''");
  const scols = (d.prepare("pragma table_info(news_sources)").all() as { name: string }[]).map((c) => c.name);
  for (const [name, def] of [["category", "text not null default ''"], ["lang", "text not null default ''"], ["etag", "text"], ["modified", "text"], ["fails", "integer not null default 0"]] as const) if (!scols.includes(name)) d.exec(`alter table news_sources add column ${name} ${def}`);
  // Stub summaries (Hacker News's "Article URL: … Points: 8") kept before they were dropped: emptied, so the page's own text is used.
  if (!cleaned) {
    d.exec("update news_items set summary = '' where summary like 'Article URL:%' or summary like 'Comments URL:%'");
    cleaned = true;
  }
  return d;
}
let cleaned = false;

const now = () => new Date().toISOString();

export function getPrefs(): NewsPrefs {
  return { ...DEFAULT_PREFS, ...getPref<Partial<NewsPrefs>>("news:prefs", {}) };
}
export function setPrefs(patch: Partial<NewsPrefs>): NewsPrefs {
  const next = { ...getPrefs(), ...patch };
  setPref("news:prefs", next);
  return next;
}

type SRow = { id: number; name: string; url: string; enabled: number; weight: number; votes: number; last_at: string | null; last_error: string | null; items: number; category: string; lang: string; fails: number };
const toSource = (r: SRow): NewsSource => ({ id: r.id, name: r.name, url: r.url, enabled: !!r.enabled, weight: r.weight, votes: r.votes, lastAt: r.last_at, lastError: r.last_error, itemCount: r.items, category: r.category, lang: r.lang, fails: r.fails });

export function listSources(): NewsSource[] {
  return (db().prepare("select s.*, (select count(*) from news_items i where i.source_id = s.id) as items from news_sources s order by s.name collate nocase").all() as SRow[]).map(toSource);
}

/** A source added by address (http/https only). The same address twice is one source. */
export function addSource(input: { name: string; url: string; category?: string; lang?: string }): NewsSource {
  const url = input.url.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error("The address must start with http:// or https://.");
  const d = db();
  const have = d.prepare("select id from news_sources where url = ?").get(url) as { id: number } | undefined;
  if (have) {
    if (input.category) d.prepare("update news_sources set category = ?, lang = ? where id = ? and category = ''").run(input.category, input.lang ?? "", have.id);
    return listSources().find((s) => s.id === have.id)!;
  }
  const name = input.name.trim() || new URL(url).hostname.replace(/^www\./, "");
  const id = Number(d.prepare("insert into news_sources (name, url, created_at, category, lang) values (?, ?, ?, ?, ?)").run(name, url, now(), input.category ?? "", input.lang ?? "").lastInsertRowid);
  return listSources().find((s) => s.id === id)!;
}

export function updateSource(id: number, patch: { name?: string; enabled?: boolean; weight?: number }): void {
  const d = db();
  if (patch.name !== undefined && patch.name.trim()) d.prepare("update news_sources set name = ? where id = ?").run(patch.name.trim(), id);
  if (patch.enabled !== undefined) d.prepare("update news_sources set enabled = ? where id = ?").run(patch.enabled ? 1 : 0, id);
  if (patch.weight !== undefined) d.prepare("update news_sources set weight = ? where id = ?").run(Math.max(0.5, Math.min(2, patch.weight)), id);
}

export function removeSource(id: number): void {
  const d = db();
  // Saved items stay (without a source); the rest goes with it.
  d.prepare("delete from news_items where source_id = ? and state != 'saved'").run(id);
  d.prepare("delete from news_sources where id = ?").run(id);
}

/** How a fetch went: a failure counts up (a source that keeps failing is left alone for a day), a success resets it. */
export function recordFetch(id: number, error: string | null): void {
  db().prepare("update news_sources set last_at = ?, last_error = ?, fails = case when ? then fails + 1 else 0 end where id = ?").run(now(), error ? error.slice(0, 300) : null, error ? 1 : 0, id);
}

/** What the server told about the feed last time (ETag, Last-Modified): the next fetch asks "changed?" and gets a short "no". */
export function fetchState(url: string): { etag: string | null; modified: string | null } {
  return (db().prepare("select etag, modified from news_sources where url = ?").get(url) as { etag: string | null; modified: string | null } | undefined) ?? { etag: null, modified: null };
}
export function setFetchState(url: string, etag: string | null, modified: string | null): void {
  db().prepare("update news_sources set etag = ?, modified = ? where url = ?").run(etag, modified, url);
}

/** Several sources at once (a catalog category, the starter pack). Returns how many were new. */
export function addSources(list: { name: string; url: string; category?: string; lang?: string }[]): number {
  const d = db();
  let added = 0;
  d.transaction(() => {
    for (const f of list) {
      const had = d.prepare("select 1 from news_sources where url = ?").get(f.url);
      addSource(f);
      if (!had) added++;
    }
  })();
  return added;
}

/** Sources that keep failing: not tried every time, once a day. */
export const dueForFetch = (s: Pick<NewsSource, "fails" | "lastAt">, nowMs: number = Date.now()): boolean => s.fails < 5 || !s.lastAt || nowMs - Date.parse(s.lastAt) > 864e5;

/** Keeps new items (a link or headline already there is skipped). Returns how many were new. */
export function addItems(source: { id: number | null; name: string }, items: FeedItem[]): number {
  const d = db();
  const insert = d.prepare("insert or ignore into news_items (source_id, source_name, guid, url, url_key, title, title_key, summary, published_at, fetched_at, image, content) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const fill = d.prepare("update news_items set image = case when image in ('', '-') then ? else image end, content = case when length(content) <= 1 then ? else content end where url_key = ?");
  const known = d.prepare("select 1 from news_items where url_key = ?");
  const sameStory = d.prepare("select 1 from news_items where title_key = ? and published_at > ?");
  let added = 0;
  d.transaction(() => {
    for (const it of items) {
      const key = titleKey(it.title);
      // Kept already (same link): only what is new about it — a picture, the text — is added.
      if (known.get(normalizeUrl(it.url))) {
        if (it.image || it.content) fill.run(it.image ?? "", it.content ?? "", normalizeUrl(it.url));
        continue;
      }
      const since = new Date(Date.parse(it.publishedAt) - 3 * 864e5).toISOString();
      if (key.length > 12 && sameStory.get(key, since)) continue;
      added += insert.run(source.id, source.name, it.guid, it.url, normalizeUrl(it.url), it.title, key, it.summary, it.publishedAt, now(), it.image ?? "", it.content ?? "").changes;
    }
  })();
  return added;
}

export function learnedTerms(): Map<string, number> {
  return new Map((db().prepare("select term, score from news_terms").all() as { term: string; score: number }[]).map((r) => [r.term, r.score]));
}

/** Scores everything recent again (your interests, votes or work changed). */
export function rescore(ctx: (item: { sourceId: number | null }) => Omit<ScoreContext, "learned" | "now">, nowMs: number = Date.now()): number {
  const d = db();
  const learned = learnedTerms();
  const rows = d.prepare("select id, source_id, title, summary, published_at from news_items where published_at > ?").all(new Date(nowMs - 40 * 864e5).toISOString()) as { id: number; source_id: number | null; title: string; summary: string; published_at: string }[];
  const update = d.prepare("update news_items set score = ?, reasons = ? where id = ?");
  d.transaction(() => {
    for (const r of rows) {
      const s = scoreItem({ title: r.title, summary: r.summary, publishedAt: r.published_at }, { ...ctx({ sourceId: r.source_id }), learned, now: nowMs });
      update.run(s.score, JSON.stringify(s.reasons), r.id);
    }
  })();
  return rows.length;
}

/** Old items out: read and unread ones past `keepDays`; saved ones stay. */
export function prune(keepDays: number): number {
  return db().prepare("delete from news_items where state != 'saved' and published_at < ?").run(new Date(Date.now() - keepDays * 864e5).toISOString()).changes;
}

type IRow = { id: number; source_id: number | null; source_name: string; url: string; title: string; summary: string; image: string; has_content: number; published_at: string; state: string; vote: number; score: number; reasons: string };
/** The columns of a list (not the whole articles: only whether one is kept). */
const ICOLS = "id, source_id, source_name, url, title, summary, image, length(content) > 1 as has_content, published_at, state, vote, score, reasons";
const toItem = (r: IRow): NewsItem => ({
  id: r.id,
  sourceId: r.source_id,
  sourceName: r.source_name,
  url: r.url,
  title: r.title,
  summary: r.summary,
  image: r.image === "-" ? "" : r.image,
  imageChecked: r.image !== "",
  hasContent: !!r.has_content,
  publishedAt: r.published_at,
  state: r.state as NewsState,
  vote: (r.vote > 0 ? 1 : r.vote < 0 ? -1 : 0) as 1 | 0 | -1,
  score: r.score,
  reasons: (() => {
    try {
      return JSON.parse(r.reasons) as string[];
    } catch {
      return [];
    }
  })(),
});

export type NewsView = "foryou" | "latest" | "saved" | "hidden";

/** The items of a view: For you (best first, nothing hidden or muted), Latest (by date), Saved, Hidden. */
export function listItems(opts: { view?: NewsView; sourceId?: number; category?: string; limit?: number; offset?: number; maxAgeDays?: number } = {}): NewsItem[] {
  const view = opts.view ?? "foryou";
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (view === "saved") where.push("state = 'saved'");
  else if (view === "hidden") where.push("state = 'hidden'");
  else {
    where.push("state != 'hidden'", "score > -50", "published_at > ?");
    args.push(new Date(Date.now() - (opts.maxAgeDays ?? 7) * 864e5).toISOString());
  }
  if (opts.sourceId) {
    where.push("source_id = ?");
    args.push(opts.sourceId);
  }
  if (opts.category) {
    where.push("source_id in (select id from news_sources where category = ?)");
    args.push(opts.category);
  }
  const order = view === "foryou" ? "score desc, published_at desc" : "published_at desc";
  const rows = db().prepare(`select ${ICOLS} from news_items where ${where.map((w) => `(${w})`).join(" and ")} order by ${order}, id desc limit ? offset ?`).all(...args, opts.limit ?? 60, opts.offset ?? 0) as IRow[];
  return rows.map(toItem);
}

export function getItem(id: number): NewsItem | null {
  const r = db().prepare(`select ${ICOLS} from news_items where id = ?`).get(id) as IRow | undefined;
  return r ? toItem(r) : null;
}

/** What is kept in `content` when the page couldn't be read (so it isn't tried again with every fetch). */
export const UNREADABLE = "\u0001";

/** The kept whole article of an item ("" if none, UNREADABLE if its page couldn't be read). */
export function getContent(id: number): { content: string; url: string; title: string } | null {
  return (db().prepare("select content, url, title from news_items where id = ?").get(id) as { content: string; url: string; title: string } | undefined) ?? null;
}

export function setContent(id: number, content: string, image?: string): void {
  const d = db();
  d.prepare("update news_items set content = ? where id = ?").run(content, id);
  // A card with no summary of its own gets the opening of the article.
  if (content.length > 1) d.prepare("update news_items set summary = ? where id = ? and summary = ''").run(snippetOf(content), id);
  // The page was looked at: a picture found is kept; none found is remembered (not looked for again).
  if (image) d.prepare("update news_items set image = ? where id = ? and image in ('', '-')").run(image, id);
  else d.prepare("update news_items set image = '-' where id = ? and image = ''").run(id);
}

/** Looked at for a picture, found none ("-": not looked at again). */
export function markNoImage(id: number): void {
  db().prepare("update news_items set image = '-' where id = ? and image = ''").run(id);
}

/** The best items without their whole article yet (for reading ahead). */
export function withoutContent(limit: number, maxAgeDays: number): { id: number; url: string }[] {
  return db()
    .prepare("select id, url from news_items where content = '' and state = 'new' and score > -50 and published_at > ? order by score desc limit ?")
    .all(new Date(Date.now() - maxAgeDays * 864e5).toISOString(), limit) as { id: number; url: string }[];
}

export function setState(id: number, state: NewsState): void {
  db().prepare("update news_items set state = ? where id = ?").run(state, id);
}

/**
 * Like (+1) / dislike (−1) / take back (0): the item's vote, its source's votes and the words of its headline
 * learn from it — the scoring picks that up at the next scoring.
 */
export function vote(id: number, value: -1 | 0 | 1): void {
  const d = db();
  const item = d.prepare("select title, source_id, vote from news_items where id = ?").get(id) as { title: string; source_id: number | null; vote: number } | undefined;
  if (!item) return;
  const delta = value - item.vote;
  d.prepare("update news_items set vote = ? where id = ?").run(value, id);
  if (!delta) return;
  if (item.source_id) d.prepare("update news_sources set votes = votes + ? where id = ?").run(delta, item.source_id);
  const bump = d.prepare("insert into news_terms (term, score) values (?, ?) on conflict (term) do update set score = max(-3, min(3, score + excluded.score))");
  d.transaction(() => {
    for (const w of tokens(item.title)) bump.run(w, delta * 0.5);
  })();
}

export function counts(): { foryou: number; saved: number; hidden: number; unread: number } {
  const d = db();
  const n = (sql: string, ...a: unknown[]) => (d.prepare(sql).get(...a) as { n: number }).n;
  const since = new Date(Date.now() - getPrefs().maxAgeDays * 864e5).toISOString();
  return {
    foryou: n("select count(*) n from news_items where state != 'hidden' and score > -50 and published_at > ?", since),
    saved: n("select count(*) n from news_items where state = 'saved'"),
    hidden: n("select count(*) n from news_items where state = 'hidden'"),
    unread: n("select count(*) n from news_items where state = 'new' and score > -50 and published_at > ?", since),
  };
}

/** The learning forgotten (the words), e.g. when the taste changed. */
export function forgetLearning(): void {
  const d = db();
  d.prepare("delete from news_terms").run();
  d.prepare("update news_sources set votes = 0").run();
}
