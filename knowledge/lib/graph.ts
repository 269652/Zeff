import { db } from "./db";

/**
 * The knowledge as a graph: every entity a node (its type, how many pages name it, how many
 * relations it has), every pair of related entities an edge (its most common relation, how many
 * relations join them). And one entity, one page, in full — for the graph's side panel and the
 * page view.
 */

export type GraphNode = { id: number; name: string; type: string; pages: number; degree: number };
export type GraphLink = { s: number; t: number; rel: string; n: number };
export type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

export function graphData(): GraphData {
  const d = db();
  const links = (
    d
      .prepare(
        `with pair as (select min(src, dst) s, max(src, dst) t, rel, count(*) c from relations where src <> dst group by 1, 2, 3)
         select s, t, rel, n from (select s, t, rel, sum(c) over (partition by s, t) n, row_number() over (partition by s, t order by c desc, rel) k from pair)
         where k = 1`,
      )
      .all() as GraphLink[]
  ).map((l) => ({ s: l.s, t: l.t, rel: l.rel, n: l.n }));
  const degree = new Map<number, number>();
  for (const l of links) {
    degree.set(l.s, (degree.get(l.s) ?? 0) + 1);
    degree.set(l.t, (degree.get(l.t) ?? 0) + 1);
  }
  const nodes = (d.prepare("select e.id, e.name, e.type, (select count(*) from entity_pages ep where ep.entity_id = e.id) pages from entities e").all() as Omit<GraphNode, "degree">[]).map((n) => ({
    ...n,
    degree: degree.get(n.id) ?? 0,
  }));
  return { nodes, links };
}

export type EntityRelation = { other: { id: number; name: string; type: string }; rel: string; fact: string; dir: "out" | "in"; pageId: string; pageTitle: string };
export type EntityDetail = {
  id: number;
  name: string;
  type: string;
  summary: string;
  aliases: string[];
  relations: EntityRelation[];
  pages: { id: string; title: string; space: string; url: string; summary: string | null }[];
};

/** An entity in full: what it is, every relation (with the entity on the other end and the page it comes from), the pages that name it. */
export function entityDetail(id: number): EntityDetail | null {
  const d = db();
  const e = d.prepare("select id, name, type, summary, aliases from entities where id = ?").get(id) as { id: number; name: string; type: string; summary: string; aliases: string } | undefined;
  if (!e) return null;
  type R = { oid: number; oname: string; otype: string; rel: string; fact: string; dir: "out" | "in"; page_id: string; page_title: string };
  const rows = d
    .prepare(
      `select o.id oid, o.name oname, o.type otype, r.rel, r.fact, 'out' dir, r.page_id, p.title page_title
         from relations r join entities o on o.id = r.dst join pages p on p.id = r.page_id where r.src = ?
       union all
       select o.id, o.name, o.type, r.rel, r.fact, 'in', r.page_id, p.title
         from relations r join entities o on o.id = r.src join pages p on p.id = r.page_id where r.dst = ?
       limit 400`,
    )
    .all(id, id) as R[];
  const pages = d
    .prepare("select p.id, p.title, p.space, p.url, p.summary from entity_pages ep join pages p on p.id = ep.page_id where ep.entity_id = ? order by p.updated_at desc limit 100")
    .all(id) as EntityDetail["pages"];
  let aliases: string[] = [];
  try {
    aliases = JSON.parse(e.aliases) as string[];
  } catch {
    // none
  }
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    summary: e.summary,
    aliases,
    relations: rows.map((r) => ({ other: { id: r.oid, name: r.oname, type: r.otype }, rel: r.rel, fact: r.fact, dir: r.dir, pageId: r.page_id, pageTitle: r.page_title })),
    pages,
  };
}

export type PageDetail = {
  id: string;
  title: string;
  space: string;
  url: string;
  updatedAt: string | null;
  author: string | null;
  body: string;
  summary: string | null;
  compiled: boolean;
  entities: { id: number; name: string; type: string }[];
  relations: { src: { id: number; name: string }; dst: { id: number; name: string }; rel: string; fact: string }[];
};

/** A page in full: its text, what compiling made of it — its summary, the entities it names, the relations it states. */
export function pageDetail(id: string): PageDetail | null {
  const d = db();
  const p = d.prepare("select id, title, space, url, updated_at, author, body, summary, version, compiled_version from pages where id = ?").get(id) as
    | { id: string; title: string; space: string; url: string; updated_at: string | null; author: string | null; body: string; summary: string | null; version: number; compiled_version: number | null }
    | undefined;
  if (!p) return null;
  const entities = d.prepare("select e.id, e.name, e.type from entity_pages ep join entities e on e.id = ep.entity_id where ep.page_id = ? order by e.name").all(id) as PageDetail["entities"];
  type R = { sid: number; sname: string; did: number; dname: string; rel: string; fact: string };
  const relations = (
    d
      .prepare("select s.id sid, s.name sname, t.id did, t.name dname, r.rel, r.fact from relations r join entities s on s.id = r.src join entities t on t.id = r.dst where r.page_id = ?")
      .all(id) as R[]
  ).map((r) => ({ src: { id: r.sid, name: r.sname }, dst: { id: r.did, name: r.dname }, rel: r.rel, fact: r.fact }));
  return { id: p.id, title: p.title, space: p.space, url: p.url, updatedAt: p.updated_at, author: p.author, body: p.body, summary: p.summary, compiled: p.compiled_version === p.version, entities, relations };
}
