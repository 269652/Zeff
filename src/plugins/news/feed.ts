/**
 * RSS 2.0, RSS 1.0 (RDF) and Atom feeds → items. A small tolerant reader (no XML library): it takes the
 * <item> / <entry> blocks and the few fields it needs, decodes entities and CDATA, strips the HTML out of
 * summaries. Pure; the fetching is in sync.ts.
 */
export type FeedItem = { guid: string; url: string; title: string; summary: string; publishedAt: string; /** A picture of it (address), if the feed has one. */ image?: string; /** The whole text, if the feed carries it (content:encoded, Atom content). */ content?: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };

/** &amp; &#228; &#xE4; → the characters. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const unCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

/** HTML → plain text: tags out, entities decoded, whitespace collapsed. */
export function stripHtml(html: string): string {
  // (Atom escapes its HTML: &lt;p&gt; — decoded first, so the tags can go.)
  const raw = unCdata(html);
  return decodeEntities((/&lt;\/?[a-z]/i.test(raw) ? decodeEntities(raw) : raw).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/li>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** HTML → plain text with its paragraphs kept (blank line between): block ends become line breaks first. */
export function paragraphs(html: string): string {
  const flat = unCdata(html)
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n");
  return decodeEntities(/&lt;\/?[a-z]/i.test(flat) ? decodeEntities(flat) : flat)
    .replace(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** An address that can be a picture: http(s) only, no data: or script. */
const imageUrl = (raw: string | undefined, base?: string): string => {
  if (!raw) return "";
  try {
    const u = new URL(decodeEntities(raw.trim()), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
};

/** A feed item's picture: media:content / media:thumbnail, an image enclosure, else the first <img> of its text. */
function itemImage(block: string): string {
  for (const m of block.matchAll(/<media:(?:content|thumbnail)\b([^>]*)>/gi)) {
    const a = m[1];
    const url = a.match(/url=["']([^"']+)["']/i)?.[1];
    if (url && (!/type=["']([^"']+)["']/i.test(a) || /type=["']image/i.test(a) || /medium=["']image/i.test(a) || m[0].toLowerCase().startsWith("<media:thumbnail"))) return imageUrl(url);
  }
  const enc = [...block.matchAll(/<enclosure\b([^>]*)>/gi)].map((m) => m[1]).find((a) => /type=["']image/i.test(a));
  if (enc) return imageUrl(enc.match(/url=["']([^"']+)["']/i)?.[1]);
  const html = decodeEntities(unCdata(rawTag(block, "content:encoded") || rawTag(block, "description") || rawTag(block, "content") || rawTag(block, "summary")));
  return imageUrl(html.match(/<img\b[^>]*?\bsrc=["']([^"']+)["']/i)?.[1]);
}

/** The text of the first <tag> in a block (namespaces allowed: dc:date, content:encoded). */
function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(unCdata(m[1])).trim() : "";
}

/** The raw (still HTML) text of a tag — for the summary, which strips it itself. */
function rawTag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

/** An Atom entry's link: rel="alternate" (or none) first. */
function atomLink(block: string): string {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  const pick = links.find((a) => /rel=["']alternate["']/i.test(a)) ?? links.find((a) => !/rel=/i.test(a)) ?? links[0] ?? "";
  return decodeEntities(pick.match(/href=["']([^"']+)["']/i)?.[1] ?? "");
}

/** Feed dates (RFC 822, ISO 8601) → ISO; the fallback when there is none or it is nonsense. */
export function parseDate(raw: string, fallback: string): string {
  const t = Date.parse(raw.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

/** All items of a feed document, newest first; items without a title or link are dropped. */
export function parseFeed(xml: string, nowIso: string = new Date().toISOString()): FeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({ atom: m[1].toLowerCase() === "entry", body: m[2] }));
  const items: FeedItem[] = [];
  for (const { atom, body } of blocks) {
    const title = stripHtml(rawTag(body, "title"));
    const url = atom ? atomLink(body) : tag(body, "link") || decodeEntities(body.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] ?? "") || tag(body, "guid");
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const summary = stripHtml(rawTag(body, "description") || rawTag(body, "summary") || rawTag(body, "content:encoded") || rawTag(body, "content")).slice(0, 600);
    const when = tag(body, "pubDate") || tag(body, "published") || tag(body, "updated") || tag(body, "dc:date");
    // A feed that carries the whole article (content:encoded, Atom content) saves fetching the page.
    const full = paragraphs(rawTag(body, "content:encoded") || (atom ? rawTag(body, "content") : ""));
    const image = itemImage(body);
    items.push({ guid: tag(body, "guid") || tag(body, "id") || url, url, title, summary, publishedAt: parseDate(when, nowIso), ...(image ? { image } : {}), ...(full.length > 600 ? { content: full.slice(0, 40000) } : {}) });
  }
  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** A feed's own name (<title> before the first item), for a source added by address only. */
export function feedTitle(xml: string): string {
  const head = xml.split(/<(?:item|entry)\b/i)[0] ?? "";
  return stripHtml(rawTag(head.replace(/<image[\s\S]*?<\/image>/gi, ""), "title"));
}
