import { db } from "./db";

/**
 * Searching: the chunks by their words, headings, page titles and the page's concepts (what
 * Copilot says it's about, in other words — so a search finds it by meaning too), ranked by BM25;
 * by page, each with its best passage. And the entities by name, aliases and summary, each with
 * what it's related to. (Vector search can join in here later, merged by rank.)
 */

export const STOP = new Set(
  "der die das und oder aber den dem des ein eine einer eines einem einen ist sind war wird werden wurde mit von vom zum zur für fur auf aus bei nach über uber unter vor im in an am als auch noch nur nicht kein keine wie was wer wo wann warum dass daß es er sie wir ihr ich du man sich so zu um bis durch ob wenn dann da hier dort mal schon mehr sehr soll sollen kann können muss müssen hat haben the and or of to in on for with from by at is are was be this that these those it as an a not no can could should would will what which who how when where why do does did have has had into about please bitte".split(
    " ",
  ),
);

/** A search's words as an FTS5 query: each word (and what it starts) — any of them; ticket keys as they are. */
export function ftsQuery(text: string, max = 24): string | null {
  const raw = (text.match(/[\p{L}\p{N}][\p{L}\p{N}_.-]*/gu) ?? []).map((w) => w.replace(/[._-]+$/, ""));
  // A name and its number apart ("CMS 11") is also the one word ("CMS 11").
  const joined = raw.flatMap((w, i) => (i && /^\d{1,3}$/.test(w) && /^\p{L}{2,}$/u.test(raw[i - 1]) ? [`${raw[i - 1]}${w}`] : []));
  const words = [...joined, ...raw].filter((w) => (w.length >= 3 || /\d/.test(w)) && w.length >= 2 && !STOP.has(w.toLowerCase()));
  const uniq = [...new Map(words.map((w) => [w.toLowerCase(), w])).values()].slice(0, max);
  if (!uniq.length) return null;
  return uniq.map((w) => (/^[A-Z][A-Z0-9]+-\d+$/.test(w) ? `"${w}"` : `"${w.replace(/"/g, "")}"*`)).join(" OR ");
}

export type PageHit = { id: string; title: string; space: string; url: string; summary: string | null; snippet: string; heading: string; score: number; updatedAt: string | null };
export type EntityHit = { id: number; name: string; type: string; summary: string; aliases: string[]; pages: number; related: { name: string; rel: string; dir: "out" | "in"; fact: string }[] };

/** The pages a search finds, best first — each once, with its best passage (⟦…⟧ marks the words found). */
export function searchPages(q: string, limit = 8): PageHit[] {
  const query = ftsQuery(q);
  if (!query) return [];
  const rows = db()
    .prepare(
      `select f.page_id, f.chunk_id, bm25(chunks_fts, 1.5, 1.5, 1.0, 0.5) as rank,
              snippet(chunks_fts, 2, '⟦', '⟧', ' … ', 24) as snip, f.heading
         from chunks_fts f where chunks_fts match ? order by rank limit ?`,
    )
    .all(query, limit * 6) as { page_id: string; chunk_id: number; rank: number; snip: string; heading: string }[];
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!best.has(r.page_id)) best.set(r.page_id, r);
  const ids = [...best.keys()].slice(0, limit);
  if (!ids.length) return [];
  const pages = new Map(
    (db().prepare(`select id, title, space, url, summary, updated_at from pages where id in (${ids.map(() => "?").join(",")})`).all(...ids) as { id: string; title: string; space: string; url: string; summary: string | null; updated_at: string | null }[]).map((p) => [p.id, p]),
  );
  return ids.flatMap((id) => {
    const p = pages.get(id);
    const r = best.get(id)!;
    return p ? [{ id, title: p.title, space: p.space, url: p.url, summary: p.summary, snippet: r.snip, heading: r.heading, score: -r.rank, updatedAt: p.updated_at }] : [];
  });
}

export type ChunkHit = { id: number; pageId: string; title: string; url: string; heading: string; text: string };

/**
 * The chunks a search finds (for an answer's sources), best first: BM25 over the 60 best, then
 * re-ranked by how many of the searched words each holds (a passage with "CMS 11", "Login" and
 * "Credentials" beats one with only one of them, short or not).
 */
export function searchChunks(q: string, limit = 10): ChunkHit[] {
  const query = ftsQuery(q, 32);
  if (!query) return [];
  const rows = db()
    .prepare(
      `select c.id, f.page_id pageId, p.title, p.url, c.heading, c.text, bm25(chunks_fts, 1.5, 1.5, 1.0, 0.5) rank
         from chunks_fts f join chunks c on c.id = f.chunk_id join pages p on p.id = f.page_id
        where chunks_fts match ? order by rank limit 60`,
    )
    .all(query) as (ChunkHit & { rank: number })[];
  const terms = [...query.matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase());
  const covers = (r: ChunkHit) => {
    const hay = `${r.title} ${r.heading} ${r.text}`.toLowerCase();
    return terms.filter((t) => hay.includes(t)).length;
  };
  return rows
    .map((r, i) => ({ r, score: covers(r) * 2 + 1 / (i + 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r }) => ({ id: r.id, pageId: r.pageId, title: r.title, url: r.url, heading: r.heading, text: r.text }));
}

/** The entities a search finds, with what they're related to (both ways). */
export function searchEntities(q: string, limit = 6): EntityHit[] {
  const query = ftsQuery(q);
  if (!query) return [];
  const rows = db()
    .prepare(
      `select e.id, e.name, e.type, e.summary, e.aliases, (select count(*) from entity_pages ep where ep.entity_id = e.id) pages
         from entities_fts f join entities e on e.id = f.entity_id
        where entities_fts match ? order by bm25(entities_fts, 5.0, 3.0, 1.0) limit ?`,
    )
    .all(query, limit) as { id: number; name: string; type: string; summary: string; aliases: string; pages: number }[];
  return rows.map((e) => ({ ...e, aliases: JSON.parse(e.aliases) as string[], related: relatedOf(e.id) }));
}

export function relatedOf(id: number, limit = 12): EntityHit["related"] {
  const out = db()
    .prepare(
      `select e.name, r.rel, 'out' dir, r.fact from relations r join entities e on e.id = r.dst where r.src = ?
       union all
       select e.name, r.rel, 'in' dir, r.fact from relations r join entities e on e.id = r.src where r.dst = ?
       limit ?`,
    )
    .all(id, id, limit) as EntityHit["related"];
  return out;
}

/** An entity in full: what it is, its relations, the pages that name it. */
export function entity(id: number) {
  const e = db().prepare("select id, name, type, summary, aliases from entities where id = ?").get(id) as { id: number; name: string; type: string; summary: string; aliases: string } | undefined;
  if (!e) return null;
  const pages = db().prepare("select p.id, p.title, p.url, p.space from entity_pages ep join pages p on p.id = ep.page_id where ep.entity_id = ? order by p.updated_at desc limit 30").all(id);
  return { ...e, aliases: JSON.parse(e.aliases) as string[], related: relatedOf(id, 50), pages };
}

/**
 * What's relevant to a piece of work (a todo): its words and its ticket — the pages, and the
 * entities it touches. No AI: quick enough to ask for every todo.
 */
export function related(text: string, ticket?: string | null, limit = 5): { pages: PageHit[]; entities: EntityHit[] } {
  const q = [ticket ?? "", text].join(" ");
  return { pages: searchPages(q, limit), entities: searchEntities(q, 4) };
}

export type SystemLink = { env: "prod" | "test" | "dev" | "other"; label: string; url: string; pageId: string; pageTitle: string; pageUrl: string };

const ENV_WORDS: [SystemLink["env"], RegExp][] = [
  ["prod", /\b(prod|production|produktion|produktiv|live|www)\b/i],
  ["test", /\b(test|testing|staging|stage|stg|abnahme|uat|qa|int|integration|preview|preprod|pre-prod)\b/i],
  ["dev", /\b(dev|develop|development|entwicklung|ddev|local|lokal)\b/i],
];
const envOf = (label: string, url: string): SystemLink["env"] => {
  for (const [env, re] of ENV_WORDS) if (re.test(label)) return env;
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (/(^|[.-])(test|staging|stage|stg|uat|qa|int|preview)([.-]|$)/i.test(host)) return "test";
  if (/(^|[.-])(dev|ddev|docker|local)([.-]|$)/i.test(host)) return "dev";
  return "other";
};

/**
 * The addresses of a piece of work's systems (test, prod …): the lines with a web address from the pages that are about it —
 * "Production | https://…", "Staging | https://…" — each with the environment its label (or host) says. No AI: the caller picks.
 */
export function systemLinks(text: string, ticket?: string | null, limit = 40): SystemLink[] {
  const q = [ticket ?? "", text].join(" ");
  const pages = new Map<string, { id: string; title: string; url: string }>();
  for (const p of [...searchPages(q, 8), ...searchPages(`${q} Production Staging Test Dev URL`, 8)]) pages.set(p.id, p);
  const out: SystemLink[] = [];
  const seen = new Set<string>();
  for (const p of pages.values()) {
    if (/^zeff:/.test(p.id)) continue;
    const body = (db().prepare("select body from pages where id = ?").get(p.id) as { body: string } | undefined)?.body ?? "";
    let n = 0;
    for (const line of body.split("\n")) {
      const m = line.match(/https?:\/\/[^\s|)<>"]+/);
      if (!m || /mailto:/.test(line)) continue;
      const url = m[0].replace(/[.,;]+$/, "");
      const label = line.slice(0, m.index).replace(/[|:()\-*•\s]+$/g, "").replace(/^[|:()\-*•\s]+/g, "").slice(0, 80);
      const env = envOf(label, url);
      // Environments only (and a few named systems with a label): documentation links and the like are no systems.
      if (label.length > 40 || (env === "other" && (!label || /^(https?:|doku|doc|official|siehe|see|head over)/i.test(label)))) continue;
      const key = `${env}|${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ env, label, url, pageId: p.id, pageTitle: p.title, pageUrl: p.url });
      if (++n >= 14) break;
    }
  }
  const rank = { prod: 0, test: 1, dev: 2, other: 3 } as const;
  return out.sort((a, b) => rank[a.env] - rank[b.env]).slice(0, limit);
}

export type RepoSource = { id: string; title: string; space: string; url: string; summary: string | null; lines: string[] };

/**
 * What the knowledge holds about a project, as raw material for a summary: for each search term (its name, repository,
 * Jira projects …) the best pages — Zeff's own sources left out — each with its abstract and the lines that carry a web
 * address (the label stands in front of it: "Staging | https://…"). No AI: the caller decides what belongs.
 */
export function repoSources(terms: string[], limit = 14): RepoSource[] {
  const pages = new Map<string, PageHit & { hits: number }>();
  for (const term of terms) {
    for (const p of searchPages(term, 8)) {
      if (/^zeff:/.test(p.id)) continue;
      const have = pages.get(p.id);
      pages.set(p.id, { ...p, hits: (have?.hits ?? 0) + 1, score: Math.max(p.score, have?.score ?? 0) });
    }
  }
  // Found by several terms first (the name AND the project), then by score.
  const best = [...pages.values()].sort((a, b) => b.hits - a.hits || b.score - a.score).slice(0, limit);
  return best.map((p) => {
    const body = (db().prepare("select body from pages where id = ?").get(p.id) as { body: string } | undefined)?.body ?? "";
    const lines = body
      .split("\n")
      .filter((l) => /https?:\/\//.test(l) && !/mailto:/.test(l))
      .map((l) => l.replace(/\s+/g, " ").trim().slice(0, 240))
      .slice(0, 30);
    return { id: p.id, title: p.title, space: p.space, url: p.url, summary: p.summary, lines };
  });
}
