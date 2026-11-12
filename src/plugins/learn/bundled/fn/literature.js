// Scholarly sources for a course, from open services that programs may ask (no key): OpenAlex (works of every field, with citation counts),
// Semantic Scholar and arXiv. Each answer becomes the same kind of source; duplicates by title go; the most cited first. A service that fails is skipped.
// inputs: { topic: text }  ->  [{ id, title, authors, year, url, kind, citations }]   (needs the network: Settings → Notebook)
const topic = String(inputs.topic || "").slice(0, 200);
if (!topic.trim()) return [];
const clean = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const authorsOf = (names) => names.filter(Boolean).slice(0, 3).join(", ") + (names.length > 3 ? " et al." : "");
const q = encodeURIComponent(topic);
const get = async (url, parse) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: "application/json, application/atom+xml" } });
    return r.ok ? await parse(r) : [];
  } catch {
    return [];
  }
};
const openAlex = (json) =>
  ((json && json.results) || []).flatMap((w) => {
    const title = clean(w.display_name);
    const id = clean(w.id).replace(/^https?:\/\/openalex\.org\//, "");
    if (!title || !id) return [];
    const url = clean(w.primary_location && w.primary_location.landing_page_url) || clean(w.doi);
    const names = (w.authorships || []).map((a) => clean(a.author && a.author.display_name));
    return [{ id: `oa:${id}`, title, authors: authorsOf(names), year: typeof w.publication_year === "number" ? w.publication_year : undefined, url: url || undefined, kind: w.type === "book" ? "book" : "paper", citations: Number(w.cited_by_count) || 0 }];
  });
const semantic = (json) =>
  ((json && json.data) || []).flatMap((p) => {
    const title = clean(p.title);
    const id = clean(p.paperId);
    if (!title || !id) return [];
    return [{ id: `s2:${id}`, title, authors: authorsOf((p.authors || []).map((a) => clean(a.name))), year: typeof p.year === "number" ? p.year : undefined, url: clean(p.url) || `https://www.semanticscholar.org/paper/${id}`, kind: "paper", citations: Number(p.citationCount) || 0 }];
  });
const tag = (xml, name) => [...xml.matchAll(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1]);
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const arxiv = (xml) =>
  tag(xml, "entry").flatMap((e) => {
    const title = clean(unesc(tag(e, "title")[0] || ""));
    const id = clean(tag(e, "id")[0]).replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
    if (!title || !id) return [];
    return [{ id: `arxiv:${id}`, title, authors: authorsOf(tag(e, "name").map((n) => clean(unesc(n)))), year: Number((tag(e, "published")[0] || "").slice(0, 4)) || undefined, url: `https://arxiv.org/abs/${id}`, kind: "paper", citations: 0 }];
  });
const [oa, s2, ax] = await Promise.all([
  get(`https://api.openalex.org/works?search=${q}&per-page=20&sort=cited_by_count:desc`, async (r) => openAlex(await r.json())),
  get(`https://api.semanticscholar.org/graph/v1/paper/search?query=${q}&limit=15&fields=title,year,authors,url,citationCount`, async (r) => semantic(await r.json())),
  get(`https://export.arxiv.org/api/query?search_query=all:${q}&max_results=10`, async (r) => arxiv(await r.text())),
]);
const titleKey = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const weight = (s) => (s.url ? 1 : 0) + (s.authors ? 1 : 0) + (s.year ? 1 : 0);
const byTitle = new Map();
for (const s of [...oa, ...s2, ...ax]) {
  const k = titleKey(s.title);
  const had = byTitle.get(k);
  if (!had) byTitle.set(k, s);
  else byTitle.set(k, { ...(weight(s) > weight(had) ? s : had), citations: Math.max(had.citations, s.citations) });
}
return [...byTitle.values()].sort((a, b) => b.citations - a.citations || (b.year || 0) - (a.year || 0)).slice(0, 25);
