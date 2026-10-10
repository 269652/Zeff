import { keyOf } from "./compile";
import { db } from "./db";
import { STOP, type ChunkHit, type EntityHit } from "./search";

/**
 * GraphRAG — the knowledge graph in an answer: the entities a question names ("Karla", "Karlas",
 * an alias, a name normalizing merged), what the graph knows of them (every relation, with the
 * sentence it comes from and its page), how they're connected to each other, and the passages of
 * the pages they're on — not only what the words of the question find.
 */

type Seed = { id: number; name: string; type: string; summary: string; aliases: string[]; pages: number };

const parse = <T>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};

/** An entity by a key: its own, or one normalizing merged into it. */
function byKey(key: string): number | null {
  const d = db();
  const own = d.prepare("select id from entities where key = ?").get(key) as { id: number } | undefined;
  if (own) return own.id;
  try {
    return (d.prepare("select entity_id id from entity_keys where key = ?").get(key) as { id: number } | undefined)?.id ?? null;
  } catch {
    return null; // no normalizing yet
  }
}

/**
 * The entities a text names: its words and runs of up to four of them, matched against the
 * entities' keys (longest first; a genitive "Karlas" is "Karla"). Single stop words ("ich",
 * "was") don't count. At most `max`, the most-named first.
 */
export function linkEntities(text: string, max = 5): Seed[] {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}.'’-]*/gu) ?? [];
  const found = new Map<number, number>();
  const covered = new Set<number>();
  for (let n = 4; n >= 1; n--)
    for (let i = 0; i + n <= words.length; i++) {
      if ([...Array(n).keys()].some((k) => covered.has(i + k))) continue;
      const gram = words.slice(i, i + n);
      if (n === 1 && (STOP.has(gram[0].toLowerCase()) || gram[0].length < 3)) continue;
      const key = keyOf(gram.join(" "));
      if (!key) continue;
      const id = byKey(key) ?? (n === 1 && /s$|['’]s?$/i.test(gram[0]) ? byKey(keyOf(gram[0].replace(/(['’]s?|s)$/i, ""))) : null);
      if (id === null) continue;
      found.set(id, Math.max(found.get(id) ?? 0, n));
      for (let k = 0; k < n; k++) covered.add(i + k);
    }
  if (!found.size) return [];
  const ids = [...found.keys()];
  const rows = db()
    .prepare(`select e.id, e.name, e.type, e.summary, e.aliases, (select count(*) from entity_pages ep where ep.entity_id = e.id) pages from entities e where e.id in (${ids.map(() => "?").join(",")})`)
    .all(...ids) as (Omit<Seed, "aliases"> & { aliases: string })[];
  return rows
    .map((r) => ({ ...r, aliases: parse<string[]>(r.aliases, []) }))
    .sort((a, b) => found.get(b.id)! - found.get(a.id)! || a.pages - b.pages)
    .slice(0, max);
}

type Rel = { src: string; dst: string; rel: string; fact: string; pageId: string; pageTitle: string; otherId: number; otherName: string; otherType: string };

function relationsOf(id: number, limit: number): Rel[] {
  return db()
    .prepare(
      `select s.name src, t.name dst, r.rel, r.fact, r.page_id pageId, p.title pageTitle,
              case when r.src = ? then t.id else s.id end otherId, case when r.src = ? then t.name else s.name end otherName, case when r.src = ? then t.type else s.type end otherType
         from relations r join entities s on s.id = r.src join entities t on t.id = r.dst join pages p on p.id = r.page_id
        where r.src = ? or r.dst = ? order by coalesce(p.updated_at, '') desc limit ?`,
    )
    .all(id, id, id, id, id, limit) as Rel[];
}

/** How two entities are connected through a third (A — X — B), each step with its relation. */
function bridges(a: Seed, b: Seed, limit = 6): string[] {
  const rows = db()
    .prepare(
      `with na as (select case when src = ? then dst else src end x, rel from relations where src = ? or dst = ?),
            nb as (select case when src = ? then dst else src end x, rel from relations where src = ? or dst = ?)
       select e.name, min(na.rel) ra, min(nb.rel) rb from na join nb on na.x = nb.x join entities e on e.id = na.x
        where na.x not in (?, ?) group by e.id order by count(*) desc limit ?`,
    )
    .all(a.id, a.id, a.id, b.id, b.id, b.id, a.id, b.id, limit) as { name: string; ra: string; rb: string }[];
  return rows.map((r) => `${a.name} —${r.ra}— ${r.name} —${r.rb}— ${b.name}`);
}

/** The graph's part of an answer: what it knows of the entities the question names, as lines for the prompt — and them, for the answer's list. */
export function graphContext(seeds: Seed[], budget = 7000): { text: string; entities: EntityHit[] } {
  if (!seeds.length) return { text: "", entities: [] };
  const parts: string[] = [];
  const entities: EntityHit[] = [];
  const perSeed = Math.max(10, Math.floor(60 / seeds.length));
  for (const s of seeds) {
    const rels = relationsOf(s.id, perSeed);
    const lines = rels.map((r) => `  - ${r.src} → ${r.rel} → ${r.dst}${r.fact ? `: ${r.fact.replace(/\s+/g, " ").slice(0, 220)}` : ""} (Seite „${r.pageTitle.slice(0, 60)}“)`);
    parts.push(`### ${s.name} (${s.type}, auf ${s.pages} Seiten)${s.aliases.length ? ` — auch: ${s.aliases.slice(0, 8).join(", ")}` : ""}\n${s.summary ? `  ${s.summary}\n` : ""}${lines.join("\n")}`);
    entities.push({ id: s.id, name: s.name, type: s.type, summary: s.summary, aliases: s.aliases, pages: s.pages, related: rels.slice(0, 12).map((r) => ({ name: r.otherName, rel: r.rel, dir: r.src === s.name ? "out" : "in", fact: r.fact })) });
  }
  const links: string[] = [];
  for (let i = 0; i < seeds.length; i++) for (let j = i + 1; j < seeds.length; j++) links.push(...bridges(seeds[i], seeds[j]));
  if (links.length) parts.push(`### Verbindungen zwischen ihnen\n${links.map((l) => `  - ${l}`).join("\n")}`);
  let text = parts.join("\n\n");
  if (text.length > budget) text = `${text.slice(0, budget)}\n  …`;
  return { text, entities };
}

/**
 * The passages of the pages the entities are on: the pages naming most of them first (then the
 * latest), from each the passages naming one of them (by a name or alias) — at most two a page.
 */
export function entityChunks(seeds: Seed[], limit = 12): ChunkHit[] {
  if (!seeds.length) return [];
  const d = db();
  const ids = seeds.map((s) => s.id);
  const pages = d
    .prepare(
      `select ep.page_id id, count(*) n, max(coalesce(p.updated_at, '')) at from entity_pages ep join pages p on p.id = ep.page_id
        where ep.entity_id in (${ids.map(() => "?").join(",")}) group by ep.page_id order by n desc, at desc limit ?`,
    )
    .all(...ids, limit * 2) as { id: string; n: number }[];
  const names = seeds.flatMap((s) => [s.name, ...s.aliases]).filter((n) => n.length >= 3).map((n) => n.toLowerCase());
  const out: ChunkHit[] = [];
  for (const pg of pages) {
    const chunks = d.prepare("select c.id, c.page_id pageId, p.title, p.url, c.heading, c.text from chunks c join pages p on p.id = c.page_id where c.page_id = ? order by c.idx").all(pg.id) as ChunkHit[];
    const naming = chunks.filter((c) => names.some((n) => `${c.title} ${c.heading} ${c.text}`.toLowerCase().includes(n)));
    out.push(...(naming.length ? naming : chunks).slice(0, 2));
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}
