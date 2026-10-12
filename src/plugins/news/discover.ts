import { decodeBody, decodeEntities, feedTitle, parseFeed } from "./feed";

/**
 * Feed discovery: from a website (or a profile on one) to the feeds it offers — the ones its pages announce
 * (<link rel="alternate" type="application/rss+xml">), the usual paths (/feed, /rss.xml, /atom.xml …) and the
 * well-known places (a subreddit, a YouTube channel, a GitHub repository, a Medium or Substack author, a Mastodon
 * account). Every candidate is fetched and parsed: only feeds that really answer with items are returned.
 */
export type FoundFeed = { url: string; title: string; items: number; newest: string; sample: string[] };

export type DiscoverDeps = {
  /** GET a page or feed: its text and final address. Default: a real fetch (public addresses only). */
  get?: (url: string) => Promise<{ text: string; url: string }>;
};

/** Public web addresses only: no localhost, no private networks (discovery follows what pages and an AI say). */
export function isPublicUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "::1" || h === "[::1]") return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
    return h.includes(".");
  } catch {
    return false;
  }
}

const UA = "Mozilla/5.0 (compatible; Zeff/1.0; feed discovery)";

const defaultGet: NonNullable<DiscoverDeps["get"]> = async (url) => {
  if (!isPublicUrl(url)) throw new Error("Not a public web address.");
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html, application/rss+xml, application/atom+xml, application/xml, */*" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (!isPublicUrl(r.url)) throw new Error("Redirected to a non-public address.");
  return { text: await decodeBody(r, 2_000_000), url: r.url };
};

/** The feed addresses a page announces. */
export function feedLinksIn(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      out.push(new URL(decodeEntities(href), base).toString());
    } catch {
      // not an address
    }
  }
  return out;
}

const COMMON_PATHS = ["/feed", "/feed/", "/rss", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml", "/feeds/posts/default", "/blog/feed", "/blog/rss.xml", "/?feed=rss2"];

/** Addresses worth trying for a given input without fetching its page first: the well-known places. */
export function knownPlaces(input: URL): string[] {
  const host = input.hostname.replace(/^www\./, "").toLowerCase();
  const parts = input.pathname.split("/").filter(Boolean);
  if (/(^|\.)reddit\.com$/.test(host) && parts[0] === "r" && parts[1]) return [`https://www.reddit.com/r/${parts[1]}/.rss`];
  if (host === "github.com" && parts.length >= 2) return [`https://github.com/${parts[0]}/${parts[1]}/releases.atom`, `https://github.com/${parts[0]}/${parts[1]}/commits.atom`];
  if (host === "medium.com" && parts[0]?.startsWith("@")) return [`https://medium.com/feed/${parts[0]}`];
  if (host === "medium.com" && parts[0] === "tag" && parts[1]) return [`https://medium.com/feed/tag/${parts[1]}`];
  if (host.endsWith(".substack.com")) return [`https://${host}/feed`];
  if (host === "youtube.com" && parts[0] === "channel" && parts[1]) return [`https://www.youtube.com/feeds/videos.xml?channel_id=${parts[1]}`];
  if (host === "youtube.com" && input.searchParams.get("list")) return [`https://www.youtube.com/feeds/videos.xml?playlist_id=${input.searchParams.get("list")}`];
  if (host === "youtube.com" && parts[0]?.startsWith("@")) return []; // its page names the channel id — found from the page below
  if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return [`https://${host}/w/api.php?action=featuredfeed&feed=featured&feedformat=atom`];
  // A Mastodon profile (https://host/@name) has a feed at .rss.
  if (parts[0]?.startsWith("@") && parts.length === 1 && !["medium.com", "youtube.com"].includes(host)) return [`${input.origin}/${parts[0]}.rss`];
  return [];
}

/** YouTube pages name their channel in the page; its feed is videos.xml?channel_id=. */
const youtubeFeedIn = (html: string): string[] => {
  const id = html.match(/"channelId":"(UC[\w-]{20,})"/)?.[1] ?? html.match(/channel_id=(UC[\w-]{20,})/)?.[1];
  return id ? [`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`] : []; // (the first named is the page's own channel; related ones come after)
};

async function validate(url: string, get: NonNullable<DiscoverDeps["get"]>): Promise<FoundFeed | null> {
  try {
    const r = await get(url);
    const items = parseFeed(r.text);
    if (!items.length) return null;
    return { url: r.url || url, title: feedTitle(r.text) || new URL(url).hostname, items: items.length, newest: items[0].publishedAt, sample: items.slice(0, 3).map((i) => i.title) };
  } catch {
    return null;
  }
}

/**
 * The feeds behind an address: the address itself if it is a feed, what its page announces, the well-known and the
 * usual places — each fetched and parsed, the best first (most items, freshest). Empty: none found.
 */
export async function discoverFeeds(input: string, deps: DiscoverDeps = {}): Promise<FoundFeed[]> {
  const get = deps.get ?? defaultGet;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return [];
  }
  if (!isPublicUrl(url.toString())) return [];
  const candidates = new Set<string>([url.toString(), ...knownPlaces(url)]);
  const found = new Map<string, FoundFeed>();
  const take = async (list: Iterable<string>) => {
    await Promise.all([...list].map(async (u) => {
      if (found.has(u)) return;
      const f = await validate(u, get);
      if (f) found.set(f.url, f);
    }));
  };
  await take(candidates);
  if (!found.size) {
    // Not a feed itself: its page says where its feeds are, else the usual places.
    let page: { text: string; url: string } | null = null;
    try {
      page = await get(url.toString());
    } catch {
      page = null;
    }
    const announced = page ? [...feedLinksIn(page.text, page.url), ...(url.hostname.includes("youtube.com") ? youtubeFeedIn(page.text) : [])] : [];
    await take(announced.filter((u) => isPublicUrl(u)));
    if (!found.size) await take(COMMON_PATHS.map((p) => new URL(p, url.origin).toString()));
  }
  return [...found.values()].sort((a, b) => b.items - a.items || b.newest.localeCompare(a.newest));
}
