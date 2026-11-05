import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { BIG_STORY, DEFAULT_PREFS, diversify, normalizeUrl, scoreItem, snippetOf, titleKey, tokens, type NewsItem, type NewsPrefs, type NewsSource, type NewsState, type ScoreContext } from "./shared";
import type { FeedItem } from "./feed";
import { aliasesOf } from "./gazetteer";
import { currentAccountId } from "@/db/accounts";

/**
 * News: the sources, the items fetched from them, what you made of them (read, saved, hidden, liked,
 * disliked) and the words that learned from that. Its own tables, made when first needed.
 */
function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists news_sources (id integer primary key autoincrement, name text not null, url text not null unique, enabled integer not null default 1, weight real not null default 1, votes integer not null default 0, last_at text, last_error text, created_at text not null);
    create table if not exists news_items (id integer primary key autoincrement, source_id integer references news_sources(id) on delete set null, source_name text not null, guid text not null, url text not null, url_key text not null unique, title text not null, title_key text not null, summary text not null default '', published_at text not null, fetched_at text not null, state text not null default 'new', vote integer not null default 0, score real not null default 0, reasons text not null default '[]');
    create index if not exists news_items_source on news_items (source_id);
    create index if not exists news_items_published on news_items (published_at);
    create index if not exists news_items_title on news_items (title_key);
    create table if not exists news_terms (term text primary key, score real not null);
  `);
  // Pictures and whole articles: columns added later.
  const cols = (d.prepare("pragma table_info(news_items)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("image")) d.exec("alter table news_items add column image text not null default ''");
  d.exec("create table if not exists news_similar (item_id integer not null, like_of integer not null, score real not null, why text not null default '', at text not null, primary key (item_id, like_of))");
  if (!cols.includes("tags")) d.exec("alter table news_items add column tags text not null default '[]'");
  if (!cols.includes("story")) d.exec("alter table news_items add column story text not null default ''");
  if (!cols.includes("tag_src")) d.exec("alter table news_items add column tag_src text not null default ''");
  if (!cols.includes("seen_at")) d.exec("alter table news_items add column seen_at text");
  if (!cols.includes("content")) d.exec("alter table news_items add column content text not null default ''");
  // The funnel: what the agent made of an item ('' not looked at, pass, top = important, drop) and why.
  if (!cols.includes("gate")) d.exec("alter table news_items add column gate text not null default ''");
  if (!cols.includes("gate_why")) d.exec("alter table news_items add column gate_why text not null default ''");
  if (!cols.includes("gate_at")) d.exec("alter table news_items add column gate_at text");
  d.exec("create index if not exists news_items_story on news_items (story)");
  // What was cleared away (its link and headline): a feed that still carries it doesn't bring it back.
  d.exec("create table if not exists news_gone (url_key text primary key, title_key text not null default '', at text not null)");
  const scols = (d.prepare("pragma table_info(news_sources)").all() as { name: string }[]).map((c) => c.name);
  for (const [name, def] of [["category", "text not null default ''"], ["lang", "text not null default ''"], ["etag", "text"], ["modified", "text"], ["fails", "integer not null default 0"]] as const) if (!scols.includes(name)) d.exec(`alter table news_sources add column ${name} ${def}`);
  // Stub summaries (Hacker News's "Article URL: … Points: 8") kept before they were dropped: emptied, so the page's own text is used.
  if (!cleaned.has(currentAccountId())) {
    d.exec("update news_items set summary = '' where summary like 'Article URL:%' or summary like 'Comments URL:%'");
    cleaned.add(currentAccountId());
  }
  return d;
}
/** Done for these accounts' databases (each its own — two accounts run side by side). */
const cleaned = new Set<string>();

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
  const gone = d.prepare("select 1 from news_gone where url_key = ?");
  const goneStory = d.prepare("select 1 from news_gone where title_key = ?");
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
      // Cleared away before (kept: only the newest and the best): not again.
      if (gone.get(normalizeUrl(it.url)) || (key.length > 12 && goneStory.get(key))) continue;
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

/** How many items there are (all of them). */
export function countItems(): number {
  return (db().prepare("select count(*) n from news_items").get() as { n: number }).n;
}

/** How many unseen, visible items there are (what is left to read before the feed runs dry). */
export function unseenCount(maxAgeDays: number): number {
  return (db().prepare("select count(*) n from news_items i left join news_sources s on s.id = i.source_id where i.seen_at is null and i.state = 'new' and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1)").get(new Date(Date.now() - maxAgeDays * 864e5).toISOString()) as { n: number }).n;
}

/** How many visible items were fetched after `sinceIso` (the page shows "N new"). */
export function countNewSince(sinceIso: string): number {
  // With the funnel: what the agent let through since.
  if (funnelOn()) return (db().prepare(`select count(*) n from news_items i where ${PASSED} and i.gate_at > ? and i.state = 'new' and i.seen_at is null`).get(sinceIso) as { n: number }).n;
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

/** Old items out: read and unread ones past `keepDays`; saved and liked ones stay. */
export function prune(keepDays: number): number {
  return db().prepare("delete from news_items where state != 'saved' and vote != 1 and published_at < ?").run(new Date(Date.now() - keepDays * 864e5).toISOString()).changes;
}

/**
 * Only what is worth it stays: the newest `keepLatest` and the best `keepLatest`, and besides them what you saved or liked,
 * what the agent let through (while it is fresh) or found important, the best report of each big story, what you hid (for
 * its view) and what the agent filtered out today (to look at). The rest goes — its link and headline are remembered for a
 * while, so a feed that still carries it doesn't bring it back. Returns how many went.
 */
export function trim(opts: { keepLatest: number; maxAgeDays: number; nowMs?: number }): number {
  const d = db();
  const nowMs = opts.nowMs ?? Date.now();
  const since = new Date(nowMs - opts.maxAgeDays * 864e5).toISOString();
  const day = new Date(nowMs - 864e5).toISOString();
  const n = Math.max(20, Math.floor(opts.keepLatest));
  const keep = `
    select id from news_items where state = 'saved' or vote = 1 or gate = 'top'
    union select id from news_items where (gate = 'pass' or state = 'hidden') and published_at > @since
    union select id from news_items where gate = 'drop' and gate_at > @day
    union select sm.item_id from news_similar sm join news_items x on x.id = sm.item_id where sm.at > @day or x.published_at > @since
    union select id from (select id from news_items where state != 'hidden' and gate != 'drop' order by published_at desc limit @n)
    union select id from (select id from news_items where state != 'hidden' and gate != 'drop' and score > -50 and published_at > @since order by score desc limit @n)
    union select id from (select id, row_number() over (partition by story order by score desc) rn from news_items
      where story in (select story from news_items where story != '' and published_at > @since group by story having count(distinct source_name) >= ${BIG_STORY})) where rn = 1`;
  let gone = 0;
  d.transaction(() => {
    d.prepare("create temp table if not exists news_keep (id integer primary key)").run();
    d.prepare("delete from news_keep").run();
    d.prepare(`insert or ignore into news_keep (id) ${keep}`).run({ since, day, n });
    // Only what a feed could still bring is remembered (older than the days fetched can't come back anyway).
    d.prepare("insert or replace into news_gone (url_key, title_key, at) select url_key, case when length(title_key) > 12 then title_key else '' end, @now from news_items where id not in (select id from news_keep) and published_at > @since").run({ since, now: new Date(nowMs).toISOString() });
    gone = d.prepare("delete from news_items where id not in (select id from news_keep)").run().changes;
    d.prepare("delete from news_similar where item_id not in (select id from news_items)").run();
    d.prepare("delete from news_gone where at < ?").run(new Date(nowMs - (opts.maxAgeDays + 2) * 864e5).toISOString());
  })();
  return gone;
}

/** An item's tags: the stored ones (the AI's or the corpus tagger's), else what the headline alone says. */
function tagsOf(r: { tags?: string; title: string }): string[] {
  try {
    const t = JSON.parse(r.tags ?? "[]") as unknown;
    if (Array.isArray(t) && t.length) return t.filter((x): x is string => typeof x === "string").slice(0, 4);
  } catch {
    // fall back
  }
  return [];
}

type IRow = { id: number; gate: string; gate_why: string; story_n: number; tags: string; story: string; tag_src: string; seen: number; category: string; source_id: number | null; source_name: string; url: string; title: string; summary: string; image: string; has_content: number; published_at: string; state: string; vote: number; score: number; reasons: string };
/** The columns of a list (not the whole articles: only whether one is kept). */
const ICOLS = "i.id, i.gate, i.gate_why, (select count(distinct x.source_name) from news_items x where i.story != '' and x.story = i.story) as story_n, i.tags, i.story, i.tag_src, i.seen_at is not null as seen, coalesce(s.category, '') as category, i.source_id, i.source_name, i.url, i.title, i.summary, i.image, length(i.content) > 1 as has_content, i.published_at, i.state, i.vote, i.score, i.reasons";
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
  storySources: r.story_n ?? 0,
  gate: (["pass", "top", "drop"].includes(r.gate) ? r.gate : "") as NewsItem["gate"],
  gateWhy: r.gate_why ?? "",
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

export type NewsView = "foryou" | "latest" | "saved" | "hidden" | "discover" | "filtered";

/** The agent filters the news (For you shows only what it let through). */
export const funnelOn = (): boolean => getPrefs().funnel;
/** The items the agent let through or found important. */
const PASSED = "i.gate in ('pass', 'top')";

/** The items of a view: For you (best first, nothing hidden or muted), Latest (by date), Saved, Hidden. */
export function listItems(opts: { view?: NewsView; sourceId?: number; category?: string; term?: string; story?: string; likeOf?: number; limit?: number; offset?: number; maxAgeDays?: number; exclude?: number[] } = {}): NewsItem[] {
  const view = opts.view ?? "foryou";
  // Discover: what was found for the taste description (like_of −1).
  if (view === "discover") opts = { ...opts, likeOf: -1 };
  // "More like this": what was found for an item, the closest first (what you have seen after).
  if (opts.likeOf) {
    return (db().prepare(`select ${ICOLS} from ${IFROM} join news_similar sm on sm.item_id = i.id where sm.like_of = ? and i.state != 'hidden' and i.id not in (select value from json_each(?)) order by (i.seen_at is not null), sm.score desc, i.published_at desc limit ? offset ?`).all(opts.likeOf, JSON.stringify(opts.exclude ?? []), opts.limit ?? 60, opts.offset ?? 0) as IRow[]).map(toItem);
  }
  const where: string[] = [];
  const args: (string | number)[] = [];
  const gated = view === "foryou" && funnelOn();
  if (view === "saved") where.push("i.state = 'saved'");
  else if (view === "hidden") where.push("i.state = 'hidden'");
  else if (view === "filtered") where.push("i.gate = 'drop'", "i.state != 'hidden'");
  else {
    // (a paused or removed source's items are out of the lists; what you saved stays)
    where.push("i.state != 'hidden'", "i.score > -50", "i.published_at > ?", "(i.source_id is null or s.enabled = 1)");
    args.push(new Date(Date.now() - (opts.maxAgeDays ?? 7) * 864e5).toISOString());
    if (gated) where.push(PASSED);
  }
  // Paging by what is on the screen already, not by an offset: what you have seen moves to the end of the list, so an offset would skip unseen items.
  if (opts.exclude?.length) {
    where.push("i.id not in (select value from json_each(?))");
    args.push(JSON.stringify(opts.exclude));
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
    // About a thing (Explore, a card's chip): items tagged with it, or naming it (or a spelling the gazetteer knows: KI, AI → Künstliche
    // Intelligence) in the headline or summary. Short spellings are only matched through the tags — "ki" is in half of all words.
    const spellings = aliasesOf(opts.term).filter((a) => a.length >= 5);
    if (!spellings.length) spellings.push(opts.term.toLowerCase());
    const tag = `%${JSON.stringify(opts.term).slice(1, -1)}%`;
    where.push(`(i.tags like ? or ${spellings.map(() => "lower(i.title) like ? or lower(i.summary) like ?").join(" or ")})`);
    args.push(tag, ...spellings.flatMap((a) => [`%${a}%`, `%${a}%`]));
  }
  if (opts.category) {
    where.push("s.category = ?");
    args.push(opts.category);
  }
  // What you have seen goes last (in For you and Latest): the feed is always new things first.
  const unseenFirst = view === "foryou" || view === "latest" ? "i.seen_at is not null, " : "";
  // What the agent found important comes first among the unseen.
  const order = view === "foryou" ? `${unseenFirst}${gated ? "i.gate = 'top' desc, " : ""}i.score desc, i.published_at desc` : view === "filtered" ? "i.gate_at desc, i.score desc" : `${unseenFirst}i.published_at desc`;
  const sql = `select ${ICOLS} from ${IFROM} where ${where.map((w) => `(${w})`).join(" and ")} order by ${order}, i.id desc limit ? offset ?`;
  // For you is mixed (diversify) — the mix is made of the best 600 and then paged, so a page continues the one before.
  if (view === "foryou" && getPrefs().diversity) {
    const all = (db().prepare(sql).all(...args, 600, 0) as IRow[]).map(toItem);
    // The unseen are mixed, then the seen (also mixed) after them.
    const fresh = all.filter((i) => !i.seen);
    const mixed = [...fresh.filter((i) => i.gate === "top"), ...diversify(fresh.filter((i) => i.gate !== "top")), ...diversify(all.filter((i) => i.seen))];
    const from = opts.offset ?? 0;
    return mixed.slice(from, from + (opts.limit ?? 60));
  }
  return (db().prepare(sql).all(...args, opts.limit ?? 60, opts.offset ?? 0) as IRow[]).map(toItem);
}

/** What you kept: the saved and the liked items, newest first — not the hidden, however liked. */
export function keptItems(limit = 500): NewsItem[] {
  const sql = `select ${ICOLS} from ${IFROM} where (i.state = 'saved' or (i.vote = 1 and i.state != 'hidden')) order by i.published_at desc, i.id desc limit ?`;
  return (db().prepare(sql).all(limit) as IRow[]).map(toItem);
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

/** The recent items as the tagger wants them (and whether the AI has tagged them already). */
export function corpusForTagging(days = 7, limit = 6000): { id: number; title: string; summary: string; src: string; at: string }[] {
  return (db().prepare("select id, title, summary, tag_src, published_at from news_items where published_at > ? order by published_at desc limit ?").all(new Date(Date.now() - days * 864e5).toISOString(), limit) as { id: number; title: string; summary: string; tag_src: string; published_at: string }[]).map((r) => ({ id: r.id, title: r.title, summary: r.summary, src: r.tag_src, at: r.published_at }));
}

/** Tags (and a story label) written for items; the AI's are not overwritten by the corpus tagger's. */
export function setTags(entries: { id: number; tags: string[]; story?: string; src: "auto" | "ai" }[]): void {
  const d = db();
  const up = d.prepare("update news_items set tags = ?, tag_src = ?, story = case when ? != '' then ? else story end where id = ? and (tag_src != 'ai' or ? = 'ai')");
  d.transaction(() => {
    for (const e of entries) up.run(JSON.stringify(e.tags.slice(0, 4)), e.src, e.story ?? "", e.story ?? "", e.id, e.src);
  })();
}

/** Story labels written for items (the clusters'): an item in no story loses its old label — unless the AI gave it one. */
export function setStories(entries: { id: number; story: string }[]): void {
  const d = db();
  const up = d.prepare("update news_items set story = ? where id = ? and (tag_src != 'ai' or ? != '' or story = '')");
  d.transaction(() => {
    for (const e of entries) up.run(e.story, e.id, e.story);
  })();
}

/** The best visible items the AI hasn't tagged yet (what the next AI batch takes). */
export function untaggedByAi(limit: number, maxAgeDays: number): { id: number; title: string; summary: string }[] {
  return db()
    .prepare(`select i.id, i.title, i.summary from news_items i left join news_sources s on s.id = i.source_id where i.tag_src != 'ai' and i.state != 'hidden' and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1)${funnelOn() ? ` and ${PASSED}` : ""} order by (i.seen_at is not null), i.score desc, i.published_at desc limit ?`)
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

/** The items for these addresses (id by address) — what was just added from a search. */
export function idsByUrls(urls: string[]): Map<string, number> {
  const d = db();
  const get = d.prepare("select id from news_items where url_key = ?");
  const out = new Map<string, number>();
  for (const u of urls) {
    const r = get.get(normalizeUrl(u)) as { id: number } | undefined;
    if (r) out.set(u, r.id);
  }
  return out;
}

/** What was found for "More like this" on an item: its matches with how close each is. */
export function setSimilar(likeOf: number, entries: { id: number; score: number; why: string }[]): void {
  const d = db();
  d.prepare("delete from news_similar where like_of = ?").run(likeOf);
  const ins = d.prepare("insert or replace into news_similar (item_id, like_of, score, why, at) values (?, ?, ?, ?, ?)");
  d.transaction(() => {
    for (const e of entries) ins.run(e.id, likeOf, e.score, e.why, now());
  })();
}

/** The reasons shown on items ("like: …"), unless they have better ones already. */
export function setReasons(ids: number[], reasons: string[]): void {
  const d = db();
  const up = d.prepare("update news_items set reasons = ? where id = ? and reasons = '[]'");
  for (const id of ids) up.run(JSON.stringify(reasons), id);
}

/** What you liked, saved and rejected before (the newest first): the first signals of the taste description. */
export function tasteSignals(limit = 24): { id: number; kind: "like" | "save" | "dislike"; title: string; summary: string; tags: string[]; at: string }[] {
  const rows = db().prepare("select id, title, summary, tags, vote, state, published_at from news_items where vote != 0 or state = 'saved' order by published_at desc limit ?").all(limit) as { id: number; title: string; summary: string; tags: string; vote: number; state: string; published_at: string }[];
  return rows.map((r) => ({ id: r.id, kind: (r.vote < 0 ? "dislike" : r.vote > 0 ? "like" : "save") as "like" | "save" | "dislike", title: r.title, summary: r.summary.slice(0, 300), tags: tagsOf(r).slice(0, 4), at: r.published_at }));
}

/** The unseen items still to read (what Discover matches the taste against). */
export function unreadForMatching(days: number, limit = 20000): { id: number; title: string; summary: string; terms: string[] }[] {
  const rows = db()
    .prepare("select i.id, i.title, i.summary, i.tags from news_items i left join news_sources s on s.id = i.source_id where i.seen_at is null and i.state = 'new' and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1) order by i.published_at desc limit ?")
    .all(new Date(Date.now() - days * 864e5).toISOString(), limit) as { id: number; title: string; summary: string; tags: string }[];
  return rows.map((r) => ({ id: r.id, title: r.title, summary: r.summary, terms: tagsOf(r) }));
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
    .prepare(`select i.id, i.url from news_items i where i.content = '' and i.state = 'new' and i.score > -50 and i.published_at > ?${funnelOn() ? ` and ${PASSED}` : ""} order by i.score desc limit ?`)
    .all(new Date(Date.now() - maxAgeDays * 864e5).toISOString(), limit) as { id: number; url: string }[];
}

/** What you keep is a database of the Workspace (searchable there): it takes a saved or liked item in at once, not at its next hourly read. */
function keptChanged(): void {
  void import("@/plugins/workspace/news-database").then((m) => m.refreshNewsDatabase()).catch(() => undefined);
}

export function setState(id: number, state: NewsState): void {
  db().prepare("update news_items set state = ? where id = ?").run(state, id);
  keptChanged();
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
  keptChanged();
  if (item.source_id) d.prepare("update news_sources set votes = votes + ? where id = ?").run(delta, item.source_id);
  const bump = d.prepare("insert into news_terms (term, score) values (?, ?) on conflict (term) do update set score = max(-3, min(3, score + excluded.score))");
  d.transaction(() => {
    for (const w of tokens(item.title)) bump.run(w, delta * 0.5);
  })();
}

export function counts(): { foryou: number; saved: number; hidden: number; unread: number; discover: number; filtered: number; waiting: number } {
  const d = db();
  const n = (sql: string, ...a: unknown[]) => (d.prepare(sql).get(...a) as { n: number }).n;
  const since = new Date(Date.now() - getPrefs().maxAgeDays * 864e5).toISOString();
  return {
    foryou: n("select count(*) n from news_items where state != 'hidden' and score > -50 and published_at > ?", since),
    saved: n("select count(*) n from news_items where state = 'saved'"),
    hidden: n("select count(*) n from news_items where state = 'hidden'"),
    discover: n("select count(*) n from news_similar sm join news_items i on i.id = sm.item_id where sm.like_of = -1 and i.seen_at is null and i.state = 'new'"),
    unread: n(`select count(*) n from news_items i where i.state = 'new' and i.score > -50 and i.published_at > ?${funnelOn() ? ` and ${PASSED} and i.seen_at is null` : ""}`, since),
    filtered: n("select count(*) n from news_items where gate = 'drop' and state != 'hidden'"),
    waiting: n("select count(*) n from news_items where gate = '' and state = 'new' and seen_at is null and score > -50 and published_at > ?", new Date(Date.now() - FUNNEL_DAYS * 864e5).toISOString()),
  };
}

/** The learning forgotten (the words), e.g. when the taste changed. */
export function forgetLearning(): void {
  const d = db();
  d.prepare("delete from news_terms").run();
  d.prepare("update news_sources set votes = 0").run();
}

/** The agent looks at news of the last two days only (older ones are history by the time it would let them through). */
export const FUNNEL_DAYS = 2;

/** What the agent looks at next: the best items it hasn't looked at yet (unseen, fresh, not muted, from a source that is on). */
export function funnelCandidates(limit: number, nowMs: number = Date.now()): { id: number; title: string; summary: string; sourceName: string; publishedAt: string }[] {
  return (db()
    .prepare("select i.id, i.title, i.summary, i.source_name, i.published_at from news_items i left join news_sources s on s.id = i.source_id where i.gate = '' and i.state = 'new' and i.seen_at is null and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1) order by i.score desc, i.published_at desc limit ?")
    .all(new Date(nowMs - FUNNEL_DAYS * 864e5).toISOString(), limit) as { id: number; title: string; summary: string; source_name: string; published_at: string }[]).map((r) => ({ id: r.id, title: r.title, summary: r.summary, sourceName: r.source_name, publishedAt: r.published_at }));
}

/**
 * With the agent on, what it hasn't read by the time it is stale never shows in For you, so it goes before the agent reads: it
 * isn't left waiting, and no tokens are spent on it. What you saved, liked or have seen stays, and so does what Discover found.
 * Remembered like what `trim` clears, so a feed that still carries it doesn't bring it back. Returns how many went.
 */
export function clearStale(nowMs: number = Date.now()): number {
  if (!funnelOn()) return 0;
  const d = db();
  const cutoff = new Date(nowMs - FUNNEL_DAYS * 864e5).toISOString();
  const stale = "gate = '' and state = 'new' and seen_at is null and vote != 1 and published_at <= @cutoff and id not in (select item_id from news_similar)";
  let gone = 0;
  d.transaction(() => {
    d.prepare(`insert or replace into news_gone (url_key, title_key, at) select url_key, case when length(title_key) > 12 then title_key else '' end, @now from news_items where ${stale}`).run({ cutoff, now: new Date(nowMs).toISOString() });
    gone = d.prepare(`delete from news_items where ${stale}`).run({ cutoff }).changes;
  })();
  return gone;
}

/** What the agent decided about items, with why. */
export function setGate(entries: { id: number; gate: "pass" | "top" | "drop"; why: string }[], nowMs: number = Date.now()): void {
  const d = db();
  const up = d.prepare("update news_items set gate = ?, gate_why = ?, gate_at = ? where id = ?");
  const at = new Date(nowMs).toISOString();
  d.transaction(() => {
    for (const e of entries) up.run(e.gate, e.why.slice(0, 200), at, e.id);
  })();
}

/** The day's funnel: how many came in, how many the agent looked at, let through, found important, filtered out, cleared away. */
export type FunnelStats = { day: string; fetched: number; judged: number; passed: number; top: number; dropped: number; cleared: number };
const dayOf = (ms: number) => new Date(ms).toLocaleDateString("sv-SE");
export function funnelStats(nowMs: number = Date.now()): FunnelStats {
  const s = getPref<Partial<FunnelStats>>("news:funnel-stats", {});
  const empty: FunnelStats = { day: dayOf(nowMs), fetched: 0, judged: 0, passed: 0, top: 0, dropped: 0, cleared: 0 };
  return s.day === empty.day ? { ...empty, ...s } : empty;
}
export function bumpFunnel(add: Partial<Omit<FunnelStats, "day">>, nowMs: number = Date.now()): FunnelStats {
  const next = { ...funnelStats(nowMs) };
  for (const [k, v] of Object.entries(add) as [keyof Omit<FunnelStats, "day">, number][]) next[k] += v ?? 0;
  setPref("news:funnel-stats", next);
  return next;
}
