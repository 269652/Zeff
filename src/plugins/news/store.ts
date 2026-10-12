import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { DEFAULT_PREFS, diversify, normalizeUrl, scoreItem, snippetOf, titleKey, tokens, type NewsItem, type NewsPrefs, type NewsSource, type NewsState, type ScoreContext } from "./shared";
import type { FeedItem } from "./feed";
import { keyTerms, type ExploreItem } from "./explore-core";

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
  if (!cols.includes("tags")) d.exec("alter table news_items add column tags text not null default '[]'");
  if (!cols.includes("story")) d.exec("alter table news_items add column story text not null default ''");
  if (!cols.includes("tag_src")) d.exec("alter table news_items add column tag_src text not null default ''");
  if (!cols.includes("seen_at")) d.exec("alter table news_items add column seen_at text");
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

/** The words you liked most (headline words of liked items): implicit interests, strongest first. */
export function learnedTop(limit = 10, min = 1): { term: string; score: number }[] {
  return (db().prepare("select term, score from news_terms where score >= ? order by score desc, term limit ?").all(min, limit) as { term: string; score: number }[]);
}

/**
 * Sources whose items you keep disliking are paused by themselves (net votes of −3 or worse): they stop coming, and the
 * source says why — resume it in the settings if that was too quick. Returns the names paused.
 */
export function pauseDisliked(threshold = -3): string[] {
  const d = db();
  const rows = d.prepare("select id, name from news_sources where enabled = 1 and votes <= ?").all(threshold) as { id: number; name: string }[];
  for (const r of rows) d.prepare("update news_sources set enabled = 0, last_error = ? where id = ?").run("paused by Zeff: you disliked its items", r.id);
  return rows.map((r) => r.name);
}

/** How many unseen, visible items there are (what is left to read before the feed runs dry). */
export function unseenCount(maxAgeDays: number): number {
  return (db().prepare("select count(*) n from news_items i left join news_sources s on s.id = i.source_id where i.seen_at is null and i.state = 'new' and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1)").get(new Date(Date.now() - maxAgeDays * 864e5).toISOString()) as { n: number }).n;
}

/** How many visible items were fetched after `sinceIso` (the page shows "N new"). */
export function countNewSince(sinceIso: string): number {
  return (db().prepare("select count(*) n from news_items i left join news_sources s on s.id = i.source_id where i.fetched_at > ? and i.state = 'new' and i.score > -50 and (i.source_id is null or s.enabled = 1)").get(sinceIso) as { n: number }).n;
}

/** When the news were fetched last (a source's last fetch). */
export function lastFetchAt(): string | null {
  return (db().prepare("select max(last_at) m from news_sources").get() as { m: string | null }).m;
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

/** An item's tags: the stored ones (the AI's or the corpus tagger's), else what the headline alone says. */
function tagsOf(r: { tags?: string; title: string }): string[] {
  try {
    const t = JSON.parse(r.tags ?? "[]") as unknown;
    if (Array.isArray(t) && t.length) return t.filter((x): x is string => typeof x === "string").slice(0, 4);
  } catch {
    // fall back
  }
  return keyTerms(r.title).slice(0, 3);
}

type IRow = { id: number; tags: string; story: string; tag_src: string; seen: number; category: string; source_id: number | null; source_name: string; url: string; title: string; summary: string; image: string; has_content: number; published_at: string; state: string; vote: number; score: number; reasons: string };
/** The columns of a list (not the whole articles: only whether one is kept). */
const ICOLS = "i.id, i.tags, i.story, i.tag_src, i.seen_at is not null as seen, coalesce(s.category, '') as category, i.source_id, i.source_name, i.url, i.title, i.summary, i.image, length(i.content) > 1 as has_content, i.published_at, i.state, i.vote, i.score, i.reasons";
const IFROM = "news_items i left join news_sources s on s.id = i.source_id";
const toItem = (r: IRow): NewsItem => ({
  id: r.id,
  sourceId: r.source_id,
  sourceName: r.source_name,
  url: r.url,
  title: r.title,
  summary: r.summary,
  seen: !!r.seen,
  terms: tagsOf(r),
  story: r.story ?? "",
  category: r.category,
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
export function listItems(opts: { view?: NewsView; sourceId?: number; category?: string; term?: string; story?: string; limit?: number; offset?: number; maxAgeDays?: number } = {}): NewsItem[] {
  const view = opts.view ?? "foryou";
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (view === "saved") where.push("i.state = 'saved'");
  else if (view === "hidden") where.push("i.state = 'hidden'");
  else {
    // (a paused or removed source's items are out of the lists; what you saved stays)
    where.push("i.state != 'hidden'", "i.score > -50", "i.published_at > ?", "(i.source_id is null or s.enabled = 1)");
    args.push(new Date(Date.now() - (opts.maxAgeDays ?? 7) * 864e5).toISOString());
  }
  if (opts.sourceId) {
    where.push("i.source_id = ?");
    args.push(opts.sourceId);
  }
  if (opts.story) {
    where.push("i.story = ?");
    args.push(opts.story);
  }
  if (opts.term) {
    // About a thing (Explore): its words in the headline or the summary.
    where.push("(lower(i.title) like ? or lower(i.summary) like ?)");
    args.push(`%${opts.term.toLowerCase()}%`, `%${opts.term.toLowerCase()}%`);
  }
  if (opts.category) {
    where.push("s.category = ?");
    args.push(opts.category);
  }
  // What you have seen goes last (in For you and Latest): the feed is always new things first.
  const unseenFirst = view === "foryou" || view === "latest" ? "i.seen_at is not null, " : "";
  const order = view === "foryou" ? `${unseenFirst}i.score desc, i.published_at desc` : `${unseenFirst}i.published_at desc`;
  const sql = `select ${ICOLS} from ${IFROM} where ${where.map((w) => `(${w})`).join(" and ")} order by ${order}, i.id desc limit ? offset ?`;
  // For you is mixed (diversify) — the mix is made of the best 600 and then paged, so a page continues the one before.
  if (view === "foryou" && getPrefs().diversity) {
    const all = (db().prepare(sql).all(...args, 600, 0) as IRow[]).map(toItem);
    // The unseen are mixed, then the seen (also mixed) after them.
    const mixed = [...diversify(all.filter((i) => !i.seen)), ...diversify(all.filter((i) => i.seen))];
    const from = opts.offset ?? 0;
    return mixed.slice(from, from + (opts.limit ?? 60));
  }
  return (db().prepare(sql).all(...args, opts.limit ?? 60, opts.offset ?? 0) as IRow[]).map(toItem);
}

/**
 * The items a question is about: its words in the headline, summary or the whole article (all words, else any), the best
 * by how many words fit — then newest. For "ask your news".
 */
export function searchItems(question: string, limit = 12): NewsItem[] {
  // The words, without an ending (Quantencomputern → Quantencompute, so it also finds Quantencomputer, Quantencomputers).
  const stem = (w: string) => (w.length >= 6 ? w.replace(/(en|er|es|em|e|n|s)$/, "") : w);
  const words = [...new Set(question.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length >= 4 && !STOPWORDS.has(w)).map(stem))].slice(0, 6);
  if (!words.length) return [];
  const like = (w: string) => `(i.title like ? or i.summary like ? or i.content like ?)`;
  const run = (join: "and" | "or") =>
    db()
      .prepare(`select ${ICOLS}, (${words.map((w) => `(case when lower(i.title) like ? then 3 else 0 end + case when lower(i.summary) like ? then 1 else 0 end + case when lower(i.content) like ? then 1 else 0 end)`).join(" + ")}) as hits from ${IFROM} where i.state != 'hidden' and i.score > -50 and (${words.map(like).join(` ${join} `)}) order by hits desc, i.published_at desc limit ?`)
      .all(...words.flatMap((w) => [`%${w}%`, `%${w}%`, `%${w}%`]), ...words.flatMap((w) => [`%${w}%`, `%${w}%`, `%${w}%`]), limit) as IRow[];
  const all = run("and");
  return (all.length >= 3 || words.length === 1 ? all : [...all, ...run("or").filter((r) => !all.some((a) => a.id === r.id))].slice(0, limit)).map(toItem);
}

const STOPWORDS = new Set("what which when where wann welche welcher welches warum wieso wurde wurden wird werden sind sein haben gibt aber auch oder nicht diese dieser dieses über nach neue neuen about with that this have from were was wie wer wo was neues neuer gibt".split(" "));

export function getItem(id: number): NewsItem | null {
  const r = db().prepare(`select ${ICOLS} from ${IFROM} where i.id = ?`).get(id) as IRow | undefined;
  return r ? toItem(r) : null;
}

/** What is kept in `content` when the page couldn't be read (so it isn't tried again with every fetch). */
export const UNREADABLE = "\u0001";

/** Items that have been on screen: from now on a fresh feed puts them last. */
export function markSeen(ids: number[]): number {
  const list = ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
  if (!list.length) return 0;
  return db().prepare(`update news_items set seen_at = ? where seen_at is null and id in (${list.map(() => "?").join(",")})`).run(now(), ...list).changes;
}

/** The recent items for the Explore map (headlines and short texts only). */
export function recentForExplore(days = 3, limit = 4000): ExploreItem[] {
  return (db().prepare("select i.id, i.title, i.summary, i.tags, i.story, i.published_at, i.source_name from news_items i left join news_sources s on s.id = i.source_id where i.state != 'hidden' and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1) order by i.published_at desc limit ?").all(new Date(Date.now() - days * 864e5).toISOString(), limit) as { id: number; title: string; summary: string; tags: string; story: string; published_at: string; source_name: string }[]).map((r) => ({ id: r.id, title: r.title, summary: r.summary, publishedAt: r.published_at, sourceName: r.source_name, tags: tagsOf(r), story: r.story }));
}

/** The recent items as the tagger wants them (and whether the AI has tagged them already). */
export function corpusForTagging(days = 7, limit = 6000): { id: number; title: string; summary: string; src: string }[] {
  return (db().prepare("select id, title, summary, tag_src from news_items where published_at > ? order by published_at desc limit ?").all(new Date(Date.now() - days * 864e5).toISOString(), limit) as { id: number; title: string; summary: string; tag_src: string }[]).map((r) => ({ id: r.id, title: r.title, summary: r.summary, src: r.tag_src }));
}

/** Tags (and a story label) written for items; the AI's are not overwritten by the corpus tagger's. */
export function setTags(entries: { id: number; tags: string[]; story?: string; src: "auto" | "ai" }[]): void {
  const d = db();
  const up = d.prepare("update news_items set tags = ?, tag_src = ?, story = case when ? != '' then ? else story end where id = ? and (tag_src != 'ai' or ? = 'ai')");
  d.transaction(() => {
    for (const e of entries) up.run(JSON.stringify(e.tags.slice(0, 4)), e.src, e.story ?? "", e.story ?? "", e.id, e.src);
  })();
}

/** The best visible items the AI hasn't tagged yet (what the next AI batch takes). */
export function untaggedByAi(limit: number, maxAgeDays: number): { id: number; title: string; summary: string }[] {
  return db()
    .prepare("select i.id, i.title, i.summary from news_items i left join news_sources s on s.id = i.source_id where i.tag_src != 'ai' and i.state != 'hidden' and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1) order by (i.seen_at is not null), i.score desc, i.published_at desc limit ?")
    .all(new Date(Date.now() - maxAgeDays * 864e5).toISOString(), limit) as { id: number; title: string; summary: string }[];
}

/**
 * Other items about the same thing as this one, for a thread when the AI has given no story label: items from the last days
 * that share at least two of its tags (or one name and much of the headline), the closest first.
 */
export function relatedByTags(item: { id: number; title: string; terms: string[] }, days = 5, limit = 12): NewsItem[] {
  const tags = item.terms.slice(0, 4);
  if (!tags.length) return [];
  const likes = tags.map(() => "i.tags like ?").join(" or ");
  const rows = db()
    .prepare(`select ${ICOLS} from ${IFROM} where i.id != ? and i.state != 'hidden' and i.published_at > ? and (${likes}) order by i.published_at desc limit 120`)
    .all(item.id, new Date(Date.now() - days * 864e5).toISOString(), ...tags.map((t) => `%${JSON.stringify(t).slice(1, -1)}%`)) as IRow[];
  const mine = new Set(tokens(item.title));
  return rows
    .map(toItem)
    .map((it) => {
      const shared = it.terms.filter((t) => tags.some((x) => x.toLowerCase() === t.toLowerCase())).length;
      const other = new Set(tokens(it.title));
      let n = 0;
      for (const w of mine) if (other.has(w)) n++;
      const jac = mine.size + other.size - n ? n / (mine.size + other.size - n) : 0;
      return { it, shared, jac, score: shared * 2 + jac * 4 };
    })
    .filter((x) => x.shared >= 2 || (x.shared >= 1 && x.jac >= 0.25))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.it);
}

/** The items of one story (the same label), newest first. */
export function itemsOfStory(story: string, limit = 30): NewsItem[] {
  if (!story.trim()) return [];
  return (db().prepare(`select ${ICOLS} from ${IFROM} where i.story = ? and i.state != 'hidden' order by i.published_at desc limit ?`).all(story, limit) as IRow[]).map(toItem);
}

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
