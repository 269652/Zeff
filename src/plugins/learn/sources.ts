/**
 * Scholarly sources for a course's research, from open services (no key, allowed to be asked by programs — unlike
 * Google Scholar): OpenAlex (works of every field, with citation counts), Semantic Scholar, arXiv. Each answer becomes
 * the same kind of source; duplicates by title go; the most cited first. A service that fails is skipped. Server only
 * (the parsers are pure).
 */
import type { PlanSource } from "./shared";

export type FoundSource = PlanSource & { citations: number };

const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const authorsOf = (names: string[]) => names.filter(Boolean).slice(0, 3).join(", ") + (names.length > 3 ? " et al." : "");

export function parseOpenAlex(json: unknown): FoundSource[] {
  const results = (json as { results?: unknown[] })?.results ?? [];
  return results.flatMap((r) => {
    const w = r as Record<string, unknown>;
    const title = clean(w.display_name);
    const id = clean(w.id).replace(/^https?:\/\/openalex\.org\//, "");
    if (!title || !id) return [];
    const loc = (w.primary_location as { landing_page_url?: string } | undefined)?.landing_page_url;
    const url = clean(loc) || clean(w.doi);
    const names = ((w.authorships as { author?: { display_name?: string } }[] | undefined) ?? []).map((a) => clean(a.author?.display_name));
    const year = typeof w.publication_year === "number" ? w.publication_year : undefined;
    return [{ id: `oa:${id}`, title, authors: authorsOf(names), year, url: url || undefined, kind: w.type === "book" ? "book" : "paper", citations: Number(w.cited_by_count) || 0 } as FoundSource];
  });
}

export function parseSemanticScholar(json: unknown): FoundSource[] {
  const data = (json as { data?: unknown[] })?.data ?? [];
  return data.flatMap((r) => {
    const p = r as Record<string, unknown>;
    const title = clean(p.title);
    const id = clean(p.paperId);
    if (!title || !id) return [];
    const names = ((p.authors as { name?: string }[] | undefined) ?? []).map((a) => clean(a.name));
    return [{ id: `s2:${id}`, title, authors: authorsOf(names), year: typeof p.year === "number" ? p.year : undefined, url: clean(p.url) || `https://www.semanticscholar.org/paper/${id}`, kind: "paper", citations: Number(p.citationCount) || 0 } as FoundSource];
  });
}

const tag = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1]);
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export function parseArxiv(xml: string): FoundSource[] {
  return tag(xml, "entry").flatMap((e) => {
    const title = clean(unescape(tag(e, "title")[0] ?? ""));
    const raw = clean(tag(e, "id")[0]);
    const id = raw.replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
    if (!title || !id) return [];
    const year = Number((tag(e, "published")[0] ?? "").slice(0, 4)) || undefined;
    return [{ id: `arxiv:${id}`, title, authors: authorsOf(tag(e, "name").map((n) => clean(unescape(n)))), year, url: `https://arxiv.org/abs/${id}`, kind: "paper", citations: 0 } as FoundSource];
  });
}

const titleKey = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const weight = (s: FoundSource) => (s.url ? 1 : 0) + (s.authors ? 1 : 0) + (s.year ? 1 : 0);

/** The lists in one: by title once (the entry with more to say, the higher count), the most cited first. */
export function mergeSources(lists: FoundSource[][], limit = 25): FoundSource[] {
  const byTitle = new Map<string, FoundSource>();
  for (const s of lists.flat()) {
    const k = titleKey(s.title);
    const had = byTitle.get(k);
    if (!had) byTitle.set(k, s);
    else byTitle.set(k, { ...(weight(s) > weight(had) ? s : had), citations: Math.max(had.citations, s.citations) });
  }
  return [...byTitle.values()].sort((a, b) => b.citations - a.citations || (b.year ?? 0) - (a.year ?? 0)).slice(0, limit);
}

/** Ask the three services about a topic (each at most 15 s), the answers merged. */
export async function fetchSources(topic: string, deps: { fetch?: typeof fetch } = {}): Promise<FoundSource[]> {
  const f = deps.fetch ?? fetch;
  const q = encodeURIComponent(topic.slice(0, 200));
  const get = async <T>(url: string, parse: (r: Response) => Promise<T>): Promise<T | null> => {
    try {
      const r = await f(url, { signal: AbortSignal.timeout(15000), headers: { accept: "application/json, application/atom+xml" } });
      return r.ok ? await parse(r) : null;
    } catch {
      return null;
    }
  };
  const [oa, s2, ax] = await Promise.all([
    get(`https://api.openalex.org/works?search=${q}&per-page=20&sort=cited_by_count:desc`, async (r) => parseOpenAlex(await r.json())),
    get(`https://api.semanticscholar.org/graph/v1/paper/search?query=${q}&limit=15&fields=title,year,authors,url,citationCount`, async (r) => parseSemanticScholar(await r.json())),
    get(`https://export.arxiv.org/api/query?search_query=all:${q}&max_results=10`, async (r) => parseArxiv(await r.text())),
  ]);
  return mergeSources([oa ?? [], s2 ?? [], ax ?? []]);
}
