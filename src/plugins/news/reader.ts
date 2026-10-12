import { decodeEntities, stripHtml } from "./feed";

/**
 * The reader: an article's page → its text (paragraphs, no HTML) and picture, so it can be read in Zeff without
 * the ads, banners and scripts of the site. A small heuristic, not a full readability port: the <article> (or
 * <main>) block, its paragraphs and headings, boilerplate lines dropped. Google News links (feeds of searches
 * point at news.google.com, which only redirects) are resolved to the publisher's address first.
 */
export type Article = { text: string; image: string; title: string; url: string };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const BOILERPLATE = /cookie|datenschutz|privacy policy|newsletter|abonnier|subscribe|alle rechte vorbehalten|all rights reserved|javascript|anmelden|jetzt lesen|werbung|advertisement|teilen auf|share on/i;

const meta = (html: string, name: string): string => {
  const re = new RegExp(`<meta\\b[^>]*?(?:property|name)=["']${name}["'][^>]*?content=["']([^"']*)["']|<meta\\b[^>]*?content=["']([^"']*)["'][^>]*?(?:property|name)=["']${name}["']`, "i");
  const m = html.match(re);
  return decodeEntities(m?.[1] ?? m?.[2] ?? "").trim();
};

/** The page's readable text: its article block's paragraphs, else the description. */
export function extractArticle(html: string, baseUrl: string): Article {
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|form|nav|footer|aside|header|button|select|template)\b[\s\S]*?<\/\1>/gi, " ");
  const blocks = [...clean.matchAll(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  const container = blocks.sort((a, b) => b.length - a.length)[0] ?? (clean.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? clean);
  const lines: string[] = [];
  for (const m of container.matchAll(/<(p|h[2-3]|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = m[1].toLowerCase();
    const text = stripHtml(m[2]);
    if (!text) continue;
    if (tag === "p" || tag === "blockquote") {
      if (text.length < 40 || (BOILERPLATE.test(text) && text.length < 160)) continue;
    } else if (tag === "li") {
      if (text.length < 60 || BOILERPLATE.test(text)) continue;
    } else if (text.length < 4 || text.length > 140 || BOILERPLATE.test(text)) continue;
    if (lines[lines.length - 1] !== text) lines.push(tag.startsWith("h") ? `${text}` : text);
  }
  let text = lines.join("\n\n").slice(0, 40000);
  const description = meta(html, "og:description") || meta(html, "description");
  if (text.length < 400 && description) text = text ? `${description}\n\n${text}` : description;
  let image = "";
  try {
    const raw = meta(html, "og:image") || meta(html, "twitter:image");
    if (raw) {
      const u = new URL(raw, baseUrl);
      if (u.protocol === "http:" || u.protocol === "https:") image = u.toString();
    }
  } catch {
    image = "";
  }
  return { text, image, title: meta(html, "og:title") || stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") , url: baseUrl };
}

export type ReaderDeps = {
  fetchText?: (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{ text: string; url: string; type: string }>;
};

const defaultFetch: NonNullable<ReaderDeps["fetchText"]> = async (url, init) => {
  const r = await fetch(url, { method: init?.method ?? "GET", body: init?.body, headers: { "user-agent": UA, "accept-language": "de,en;q=0.8", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(20000), redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { text: (await r.text()).slice(0, 3_000_000), url: r.url, type: r.headers.get("content-type") ?? "" };
};

/** news.google.com/rss/articles/<id> → the publisher's address (Google's own batchexecute call, as its page makes). */
export async function resolveGoogleNews(url: string, deps: ReaderDeps = {}): Promise<string | null> {
  const id = url.match(/news\.google\.com\/(?:rss\/)?(?:articles|read)\/([^?/#]+)/)?.[1];
  if (!id) return null;
  const get = deps.fetchText ?? defaultFetch;
  const page = (await get(`https://news.google.com/rss/articles/${id}`)).text;
  const sg = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = page.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) return null;
  const inner = JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
  const body = `f.req=${encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]))}`;
  const r = await get("https://news.google.com/_/DotsSplashUi/data/batchexecute", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" } });
  try {
    const parsed = JSON.parse(r.text.split("\n\n")[1]) as [[string, string, string]];
    const out = (JSON.parse(parsed[0][2]) as [string, string])[1];
    return /^https?:\/\//i.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** The article behind an address: resolved if it is a Google News link, fetched, its text and picture taken out. Throws with a reason. */
export async function fetchArticle(url: string, deps: ReaderDeps = {}): Promise<Article> {
  const get = deps.fetchText ?? defaultFetch;
  let target = url;
  if (/news\.google\.com/.test(url)) {
    const real = await resolveGoogleNews(url, deps);
    if (!real) throw new Error("Google News didn't give the article's address.");
    target = real;
  }
  const r = await get(target);
  if (r.type && !/html|xml/i.test(r.type)) throw new Error(`Not a web page (${r.type.split(";")[0]}).`);
  const a = extractArticle(r.text, r.url || target);
  if (a.text.length < 200) throw new Error("No readable text on that page (it may be behind a paywall or built by scripts).");
  return a;
}
