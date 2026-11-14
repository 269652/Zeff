import { getPref, setPref } from "@/lib/prefs";
import { aiWebSearch, canAiSearch } from "@/lib/web/ai-search";

/**
 * Web search for Zeff's AI (the MCP server's tools, the Workspace chat): by itself the web search of your Claude login, which needs no
 * key or card, only the Claude CLI; quicker with a key of an official API — Brave Search, or Google Programmable Search (Google takes
 * no new customers and ends it on 2027-01-01) — and a page read as text. Never by scraping Google's pages. A fetch stays off the machine's own network: a page's text is data,
 * and an AI steered by it must not be able to read Zeff's local pages or the router. Server only.
 */

export type SearchConfig = { provider: "google" | "brave"; googleKey: string; googleCx: string; braveKey: string };
const KEY = "web-search.config";
const EMPTY: SearchConfig = { provider: "brave", googleKey: "", googleCx: "", braveKey: "" };

export function getSearchConfig(): SearchConfig {
  const c = { ...EMPTY, ...getPref<Partial<SearchConfig>>(KEY, {}) };
  // (Google was the default once: chosen without a key, it was never set up.)
  return c.provider === "google" && !c.googleKey ? { ...c, provider: "brave" } : c;
}

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

/** Whether a search can run at all: with a key, else through the Claude login. */
export const canSearch = (c = getSearchConfig()): boolean => searchReady(c) || canAiSearch();

export type SearchHit = { title: string; url: string; snippet: string };
type Deps = { fetch?: typeof fetch; lookup?: (host: string) => Promise<string>; /** A search by the Claude login (tests give their own). */ claude?: typeof claudeSearch };

const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const web = (u: unknown): string | null => {
  try {
    const url = new URL(String(u));
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/** A search by the web search of the Claude login (lib/web/ai-search.ts — the kernel's driver now). */
const claudeSearch = aiWebSearch;

/** A search: up to `count` hits (1–10); `site` limits it to a domain; `language` (de, en …) prefers one. */
export async function webSearch(query: string, opts: { count?: number; site?: string; language?: string } = {}, deps: Deps = {}): Promise<SearchHit[]> {
  const cfg = getSearchConfig();
  const f = deps.fetch ?? fetch;
  const count = Math.min(10, Math.max(1, Math.round(opts.count ?? 5)));
  const q = [query.trim(), opts.site ? `site:${opts.site.trim()}` : ""].filter(Boolean).join(" ");
  if (!q) throw new Error("A search needs words.");
  if (!searchReady(cfg)) {
    if (!deps.claude && !canSearch(cfg)) throw new Error("Web search needs the Claude CLI, signed in, or a Brave Search API key under Settings → Web search.");
    return (deps.claude ?? claudeSearch)(q, count, opts.language);
  }
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
// A page as text: Zeff's kernel now (lib/web/read.ts) — here for what imported it from this plugin
// ---------------------------------------------------------------------------

export { htmlToText, isPrivateAddress, publicUrl, webFetch } from "@/lib/web/read";
