import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getPref, setPref } from "@/lib/prefs";

/**
 * Web search for Zeff's AI (the MCP server's tools, the Workspace chat): a search through an official API — Google
 * Programmable Search (an API key and a search engine id, made once in Google's console) or Brave Search (one key) — and a
 * page read as text. Never by scraping Google's pages. A fetch stays off the machine's own network: a page's text is data,
 * and an AI steered by it must not be able to read Zeff's local pages or the router. Server only.
 */

export type SearchConfig = { provider: "google" | "brave"; googleKey: string; googleCx: string; braveKey: string };
const KEY = "web-search.config";
const EMPTY: SearchConfig = { provider: "google", googleKey: "", googleCx: "", braveKey: "" };

export const getSearchConfig = (): SearchConfig => ({ ...EMPTY, ...getPref<Partial<SearchConfig>>(KEY, {}) });

/** What's set changes (a key left out stays: the other provider's). */
export function saveSearchConfig(patch: Partial<SearchConfig>): SearchConfig {
  const cur = getSearchConfig();
  const next: SearchConfig = {
    provider: patch.provider === "brave" ? "brave" : patch.provider === "google" ? "google" : cur.provider,
    googleKey: patch.googleKey !== undefined ? patch.googleKey.trim() : cur.googleKey,
    googleCx: patch.googleCx !== undefined ? patch.googleCx.trim() : cur.googleCx,
    braveKey: patch.braveKey !== undefined ? patch.braveKey.trim() : cur.braveKey,
  };
  setPref(KEY, next);
  return next;
}

/** Whether the chosen provider has what it needs. */
export const searchReady = (c = getSearchConfig()): boolean => (c.provider === "brave" ? !!c.braveKey : !!c.googleKey && !!c.googleCx);

export type SearchHit = { title: string; url: string; snippet: string };
type Deps = { fetch?: typeof fetch; lookup?: (host: string) => Promise<string> };

const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const web = (u: unknown): string | null => {
  try {
    const url = new URL(String(u));
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/** A search: up to `count` hits (1–10); `site` limits it to a domain; `language` (de, en …) prefers one. */
export async function webSearch(query: string, opts: { count?: number; site?: string; language?: string } = {}, deps: Deps = {}): Promise<SearchHit[]> {
  const cfg = getSearchConfig();
  if (!searchReady(cfg)) throw new Error("Web search is not set up: add the API key (Google: key and search engine id; or Brave) under Settings → Web search.");
  const f = deps.fetch ?? fetch;
  const count = Math.min(10, Math.max(1, Math.round(opts.count ?? 5)));
  const q = [query.trim(), opts.site ? `site:${opts.site.trim()}` : ""].filter(Boolean).join(" ");
  if (!q) throw new Error("A search needs words.");
  if (cfg.provider === "brave") {
    const url = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q, count: String(count), ...(opts.language ? { search_lang: opts.language } : {}) })}`;
    const r = await f(url, { headers: { Accept: "application/json", "X-Subscription-Token": cfg.braveKey }, signal: AbortSignal.timeout(20000) });
    const data = (await r.json().catch(() => null)) as { web?: { results?: { title?: string; url?: string; description?: string }[] }; error?: { message?: string } } | null;
    if (!r.ok) throw new Error(`Brave Search: ${data?.error?.message ?? r.status}`);
    return (data?.web?.results ?? []).flatMap((x) => (web(x.url) ? [{ title: clean(x.title, 200), url: web(x.url)!, snippet: clean(x.description, 500) }] : []));
  }
  const url = `https://www.googleapis.com/customsearch/v1?${new URLSearchParams({ key: cfg.googleKey, cx: cfg.googleCx, q, num: String(count), ...(opts.language ? { lr: `lang_${opts.language}` } : {}) })}`;
  const r = await f(url, { signal: AbortSignal.timeout(20000) });
  const data = (await r.json().catch(() => null)) as { items?: { title?: string; link?: string; snippet?: string }[]; error?: { message?: string } } | null;
  if (!r.ok) throw new Error(`Google search: ${data?.error?.message ?? r.status}`);
  return (data?.items ?? []).flatMap((x) => (web(x.link) ? [{ title: clean(x.title, 200), url: web(x.link)!, snippet: clean(x.snippet, 500) }] : []));
}

// ---------------------------------------------------------------------------
// A page as text
// ---------------------------------------------------------------------------

/** The same check for others that reach the web (the Browser plugin). */
export const publicUrl = (raw: string): Promise<URL> => checkUrl(raw, {});

/** Whether an address is the machine's own or a private network's (loopback, link-local, RFC 1918, carrier NAT, unique-local …). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1] ?? (isIP(ip) === 4 ? ip : null);
  if (v4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || /^fe[89ab]/.test(v6);
}

const resolve = async (host: string): Promise<string> => (await dnsLookup(host)).address;

/** A URL checked for a fetch: http(s) only, no local names, and the address it resolves to is a public one. The URL. */
async function checkUrl(raw: string, deps: Deps): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Not a URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https pages can be read.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) throw new Error(`${host}: not allowed (the machine's own network).`);
  const ip = isIP(host) ? host : await (deps.lookup ?? resolve)(host);
  if (isPrivateAddress(ip)) throw new Error(`${host}: not allowed (a private address).`);
  return url;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** HTML as readable text: no scripts, styles, navigation; blocks on their own lines; entities decoded. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1], 200);
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|table|ul|ol|br)\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10) || 32) : (ENTITIES[e.toLowerCase()] ?? m)))
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title, text };
}

/** A page read as text — at most `maxChars`; redirects followed (each hop checked), 2 MB read at most. */
export async function webFetch(raw: string, deps: Deps & { maxChars?: number } = {}): Promise<{ url: string; title: string; text: string; truncated: boolean }> {
  const f = deps.fetch ?? fetch;
  let url = await checkUrl(raw, deps);
  for (let hop = 0; hop < 5; hop++) {
    const r = await f(url.toString(), { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; Zeff)", accept: "text/html, text/plain, application/json, */*;q=0.5" }, signal: AbortSignal.timeout(20000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      url = await checkUrl(new URL(r.headers.get("location")!, url).toString(), deps);
      continue;
    }
    if (!r.ok) throw new Error(`${url.hostname}: ${r.status}`);
    const type = (r.headers.get("content-type") ?? "").toLowerCase();
    if (type && !/^(text\/|application\/(json|xml|xhtml|ld\+json|rss|atom))/.test(type)) throw new Error(`${url.hostname}: that isn't text (${type.split(";")[0]}).`);
    const body = (await r.text()).slice(0, 2_000_000);
    const page = /html|xml/.test(type) || /^\s*</.test(body) ? htmlToText(body) : { title: "", text: body.trim() };
    const max = deps.maxChars ?? 20000;
    return { url: url.toString(), title: page.title, text: page.text.slice(0, max), truncated: page.text.length > max };
  }
  throw new Error("Too many redirects.");
}
