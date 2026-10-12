/**
 * The News plugin's types, the starter sources and the scoring — pure, no database, client-safe.
 * Scoring is what makes it yours: your interests (with a weight), what you mute, the sources you trust,
 * how fresh an item is, what you liked and disliked before, and — if you let it — what your open todos
 * and tickets are about.
 */

export type NewsSource = {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
  /** How much you trust it: 0.5 (meh) … 2 (first). */
  weight: number;
  /** Likes minus dislikes of its items. */
  votes: number;
  lastAt: string | null;
  lastError: string | null;
  itemCount: number;
  /** From the catalog: its category ("World", "Tech" …) and language; "" for one you added. */
  category: string;
  lang: string;
  /** Fetches in a row that failed (a source that keeps failing is tried only once a day). */
  fails: number;
};

export type NewsState = "new" | "read" | "saved" | "hidden";

export type NewsItem = {
  id: number;
  sourceId: number | null;
  sourceName: string;
  url: string;
  title: string;
  summary: string;
  /** A picture of it (address), or "". */
  image: string;
  /** Its page was looked at for a picture already (none found, if `image` is empty). */
  imageChecked: boolean;
  /** The whole article is kept (read it here). */
  hasContent: boolean;
  publishedAt: string;
  state: NewsState;
  vote: -1 | 0 | 1;
  score: number;
  /** Why it is up here: "AI ×2", "fresh", "you liked similar …". */
  reasons: string[];
};

export type Interest = { term: string; weight: number };

export type NewsPrefs = {
  /** What you want to read about (weight 1–3). */
  interests: Interest[];
  /** Items with one of these words are left out. */
  mutes: string[];
  /** "de", "en" or "any": the language of the topic searches. */
  language: "de" | "en" | "any";
  /** One search per interest (Google News) besides your sources. */
  topicSearch: boolean;
  /** Boost what your open todos and tickets are about. */
  useWork: boolean;
  /** An AI overview of the best items (needs the LLM plugin). */
  digest: boolean;
  /** Zeff looks for new feeds by itself (once a day, for your interests) and adds the best few. */
  autoDiscover: boolean;
  /** Show each item's picture (the pictures are loaded from their sites by your browser). */
  images: boolean;
  /** After each fetch, read the whole text of the best unread items so they open at once. */
  prefetch: boolean;
  /** Items older than this aren't fetched or shown. */
  maxAgeDays: number;
  /** Most items kept per source and fetch. */
  perSource: number;
  /** How long read items are kept (saved ones always). */
  keepDays: number;
};

export const DEFAULT_PREFS: NewsPrefs = { interests: [], mutes: [], language: "de", topicSearch: true, useWork: true, digest: false, autoDiscover: false, images: true, prefetch: true, maxAgeDays: 7, perSource: 25, keepDays: 30 };

export type Preset = { name: string; url: string; about: string; lang: "de" | "en" };

/** Starter sources — one click each on the settings page. */
export const PRESETS: Preset[] = [
  { name: "Tagesschau", url: "https://www.tagesschau.de/index~rss2.xml", about: "Nachrichten", lang: "de" },
  { name: "Spiegel", url: "https://www.spiegel.de/schlagzeilen/index.rss", about: "Nachrichten", lang: "de" },
  { name: "ZEIT ONLINE", url: "https://newsfeed.zeit.de/index", about: "Nachrichten", lang: "de" },
  { name: "heise online", url: "https://www.heise.de/rss/heise-atom.xml", about: "Tech", lang: "de" },
  { name: "Golem.de", url: "https://rss.golem.de/rss.php?feed=RSS2.0", about: "Tech", lang: "de" },
  { name: "Hacker News", url: "https://hnrss.org/frontpage", about: "Tech", lang: "en" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", about: "Tech", lang: "en" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", about: "Tech", lang: "en" },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", about: "World", lang: "en" },
  { name: "NPR", url: "https://feeds.npr.org/1001/rss.xml", about: "World", lang: "en" },
  // Google News: its public headline feeds (not your personal "For you", which has no feed).
  { name: "Google News · Top", url: "https://news.google.com/rss?hl=de&gl=DE&ceid=DE:de", about: "Google News", lang: "de" },
  { name: "Google News · Technologie", url: "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=de&gl=DE&ceid=DE:de", about: "Google News", lang: "de" },
  { name: "Google News · Wirtschaft", url: "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=de&gl=DE&ceid=DE:de", about: "Google News", lang: "de" },
  { name: "Google News · Wissenschaft", url: "https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=de&gl=DE&ceid=DE:de", about: "Google News", lang: "de" },
  { name: "Google News · Sport", url: "https://news.google.com/rss/headlines/section/topic/SPORTS?hl=de&gl=DE&ceid=DE:de", about: "Google News", lang: "de" },
  { name: "Google News · Top (EN)", url: "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en", about: "Google News", lang: "en" },
  { name: "Google News · Technology (EN)", url: "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en", about: "Google News", lang: "en" },
];

/** The address of a Google News search for a term (an RSS feed). */
export function topicFeedUrl(term: string, language: NewsPrefs["language"], maxAgeDays: number): string {
  const [hl, gl, ceid] = language === "en" ? ["en", "US", "US:en"] : ["de", "DE", "DE:de"];
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${term} when:${Math.max(1, Math.min(30, maxAgeDays))}d`)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

/** "AI", "Formula 1 x3" → interests; one per line or comma. A trailing "x2" / "×3" / "*3" is the weight. */
export function parseInterests(text: string): Interest[] {
  const seen = new Set<string>();
  const out: Interest[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const m = raw.trim().match(/^(.*?)(?:\s*[x×*]\s*([1-3]))?$/i);
    const term = (m?.[1] ?? "").trim();
    if (term.length < 2 || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push({ term, weight: Number(m?.[2] ?? 1) });
  }
  return out.slice(0, 40);
}

export const formatInterests = (list: Interest[]): string => list.map((i) => (i.weight > 1 ? `${i.term} x${i.weight}` : i.term)).join("\n");

export const parseMutes = (text: string): string[] => [...new Set(text.split(/[\n,;]+/).map((s) => s.trim()).filter((s) => s.length >= 2))].slice(0, 60);

/** Tracking parameters off, host lower-cased, no fragment, no trailing slash — the same article under two links is one. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|source$|cmp$|wt_)/i.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw.trim();
  }
}

/** A headline as a key: lower-case words only — "Foo bar – Spiegel" and "foo bar" are the same story. */
export const titleKey = (title: string): string =>
  title
    .toLowerCase()
    .replace(/\s[-–—|]\s[^-–—|]{2,40}$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const STOP = new Set(
  "the and for with that this from have has are was were will would could about into over after before more than also but not you your they their them what when which who how why can new says said say nach auch eine einer eines einem einen sind wird wurde werden haben nicht über noch aber oder wie was wer mit von der die das den dem des und ein für auf bei dass zum zur vor aus als sich war".split(" "),
);

/** The words worth learning from a headline: 4+ letters, no stop words. */
export function tokens(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[\p{L}][\p{L}\p{N}-]{3,}/gu) ?? [])].filter((w) => !STOP.has(w)).slice(0, 30);
}

const includesTerm = (text: string, term: string): boolean => {
  const t = term.toLowerCase();
  if (t.length <= 3) return new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
  return text.includes(t);
};

export type ScoreContext = {
  prefs: Pick<NewsPrefs, "interests" | "mutes">;
  /** What you liked / disliked before: word → score. */
  learned: Map<string, number>;
  /** Words of your open todos and tickets. */
  work: string[];
  /** The source's weight and its votes. */
  sourceWeight: number;
  sourceVotes: number;
  now: number;
};

/** How well an item fits you: higher is more, with the reasons. Muted items get a very low score. */
export function scoreItem(item: { title: string; summary: string; publishedAt: string }, ctx: ScoreContext): { score: number; reasons: string[] } {
  const title = item.title.toLowerCase();
  const text = `${title} ${item.summary.toLowerCase()}`;
  const reasons: string[] = [];
  for (const m of ctx.prefs.mutes) if (includesTerm(text, m)) return { score: -100, reasons: [`muted: ${m}`] };

  let score = 0;
  for (const i of ctx.prefs.interests) {
    if (includesTerm(title, i.term)) {
      score += 3 * i.weight;
      reasons.push(i.weight > 1 ? `${i.term} ×${i.weight}` : i.term);
    } else if (includesTerm(text, i.term)) {
      score += 1.5 * i.weight;
      reasons.push(i.weight > 1 ? `${i.term} ×${i.weight}` : i.term);
    }
  }

  // What you liked and disliked before: the words of the headline.
  let learned = 0;
  const hit: string[] = [];
  for (const w of tokens(item.title)) {
    const s = ctx.learned.get(w);
    if (s) {
      learned += s;
      if (s > 0) hit.push(w);
    }
  }
  learned = Math.max(-4, Math.min(4, learned));
  if (learned) score += learned;
  if (learned > 0.5 && hit.length) reasons.push(`like ${hit.slice(0, 2).join(", ")}`);

  // What you work on.
  const work = ctx.work.filter((w) => includesTerm(text, w));
  if (work.length) {
    score += Math.min(3, work.length * 1.5);
    reasons.push(`work: ${work.slice(0, 2).join(", ")}`);
  }

  // The source you trust (and its votes) scales what is good about the item, not what isn't.
  const trust = Math.max(0.4, ctx.sourceWeight * (1 + Math.max(-0.5, Math.min(0.5, ctx.sourceVotes / 10))));
  score = score > 0 ? score * trust : score;

  // Fresh first: up to +2, gone after about two days.
  const ageH = Math.max(0, (ctx.now - Date.parse(item.publishedAt)) / 3600000);
  const fresh = 2 * Math.exp(-ageH / 18);
  score += fresh;
  if (fresh > 1.4) reasons.push("fresh");
  return { score: Math.round(score * 100) / 100, reasons };
}

/** A feed's "summary" that is only a stub (Hacker News: "Article URL: … Comments URL: … Points: 8"): no summary at all. */
export const isStubSummary = (s: string): boolean => /^\s*Article URL:/i.test(s) || /^\s*Comments URL:/i.test(s);

/** The opening of an article as a card's summary: its first paragraphs, about 320 characters, cut at a word. */
export function snippetOf(text: string, max = 320): string {
  let out = "";
  for (const p of text.split(/\n{2,}/)) {
    out = out ? `${out} ${p}` : p;
    if (out.length >= max * 0.6) break;
  }
  if (out.length <= max) return out;
  const cut = out.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.7))}…`;
}

/** Items per page (infinite scroll loads this many at a time). */
export const NEWS_PAGE = 24;
