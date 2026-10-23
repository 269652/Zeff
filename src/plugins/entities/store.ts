/**
 * The things besides people most correlations need (the Entities plugin): organisations (`org:<id>`), places (`place:<id>`) and
 * projects (`project:<id>` — the time tracking's projects, src/lib/projects.ts, with what else belongs to them). Organisations and
 * places live in `ent_entities`; what each is known by and linked to — its other names, its mail domains, a project's job number,
 * Jira key and board, repos and Workspace databases, the organisation it is for — in `ent_links`, one row per (entity, kind,
 * target). Who works at an organisation or lives at a place is the people graph's (people_links, "works-at" / "located-at").
 * Server only.
 */
import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { updateProject } from "@/lib/projects";
import { foldName, normalizeAddress } from "./normalize";

export const ENTITY_KINDS = ["org", "place", "project"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
/** What an entity is linked to: another name, a mail domain, a job number, a Jira project key or board, a repo, a Workspace database, an organisation. */
export const ENTITY_RELS = ["alias", "domain", "job", "jira", "board", "repo", "db", "org"] as const;
export type EntityRel = (typeof ENTITY_RELS)[number];

export type Entity = {
  ref: string;
  kind: EntityKind;
  id: number;
  name: string;
  aliases: string[];
  /** An organisation's mail domains. */
  domains: string[];
  note: string;
  /** A place's address (as written); a project's job number. */
  address: string;
  updatedAt: string;
};

export type EntityLink = {
  id: number;
  ref: string;
  rel: EntityRel;
  target: string;
  label: string;
  evidence: string;
  /** manual: yours. suggestion: a proposal you accepted. rule: read off the sources. */
  source: "manual" | "suggestion" | "rule";
  createdAt: string;
};

export function entDb() {
  const d = getSqlite();
  d.exec(`
    create table if not exists ent_entities (id integer primary key autoincrement, kind text not null, name text not null, note text not null default '', address text not null default '', created_at text not null, updated_at text not null);
    create index if not exists ent_entities_kind on ent_entities (kind);
    create table if not exists ent_links (id integer primary key autoincrement, ref text not null, rel text not null, target text not null, label text not null default '', evidence text not null default '', source text not null default 'manual', created_at text not null, unique (ref, rel, target));
    create index if not exists ent_links_target on ent_links (rel, target);
  `);
  return d;
}

const now = () => new Date().toISOString();
const changed = () => emitChange("todos");

/** "org:3" → { kind, id } (null: not an entity's ref). */
export function parseRef(ref: string): { kind: EntityKind; id: number } | null {
  const m = /^(org|place|project):(\d+)$/.exec(ref.trim());
  return m ? { kind: m[1] as EntityKind, id: Number(m[2]) } : null;
}

/** A link's target as kept: domains and keys in their one way of writing them. */
function cleanTarget(rel: EntityRel, target: string): string {
  const v = target.trim().slice(0, 200);
  if (rel === "domain") return v.toLowerCase().replace(/^@/, "");
  if (rel === "jira") return v.toUpperCase();
  return v;
}

type LRow = { id: number; ref: string; rel: string; target: string; label: string; evidence: string; source: string; created_at: string };
const toLink = (r: LRow): EntityLink => ({
  id: r.id,
  ref: r.ref,
  rel: (ENTITY_RELS as readonly string[]).includes(r.rel) ? (r.rel as EntityRel) : "alias",
  target: r.target,
  label: r.label,
  evidence: r.evidence,
  source: r.source === "suggestion" || r.source === "rule" ? r.source : "manual",
  createdAt: r.created_at,
});

/** A link kept — once per (entity, kind, target). Whether it is new. */
export function addEntityLink(ref: string, rel: EntityRel, target: string, opts: { label?: string; evidence?: string; source?: EntityLink["source"] } = {}): boolean {
  const t = cleanTarget(rel, target);
  if (!t || !parseRef(ref)) return false;
  const r = entDb()
    .prepare("insert or ignore into ent_links (ref, rel, target, label, evidence, source, created_at) values (?, ?, ?, ?, ?, ?, ?)")
    .run(ref, rel, t, (opts.label ?? "").slice(0, 160), (opts.evidence ?? "").slice(0, 300), opts.source ?? "manual", now());
  if (r.changes) {
    touch(ref);
    changed();
  }
  return r.changes > 0;
}

export function removeEntityLink(ref: string, rel: EntityRel, target: string): void {
  if (entDb().prepare("delete from ent_links where ref = ? and rel = ? and target = ?").run(ref, rel, cleanTarget(rel, target)).changes) {
    touch(ref);
    changed();
  }
}

export const entityLinks = (ref: string): EntityLink[] => (entDb().prepare("select * from ent_links where ref = ? order by rel, id").all(ref) as LRow[]).map(toLink);

/** The entities linked to a target ("domain", "acme.de" → the organisation's links). */
export const linksTargeting = (rel: EntityRel, target: string): EntityLink[] => (entDb().prepare("select * from ent_links where rel = ? and target = ?").all(rel, cleanTarget(rel, target)) as LRow[]).map(toLink);

/** All links of one kind (every domain, every job number …). */
export const linksOfRel = (rel: EntityRel): EntityLink[] => (entDb().prepare("select * from ent_links where rel = ? order by id").all(rel) as LRow[]).map(toLink);

export const addAlias = (ref: string, alias: string): boolean => addEntityLink(ref, "alias", alias);

function touch(ref: string): void {
  const p = parseRef(ref);
  if (p && p.kind !== "project") entDb().prepare("update ent_entities set updated_at = ? where id = ?").run(now(), p.id);
}

type ERow = { id: number; kind: string; name: string; note: string; address: string; updated_at: string };

function withLinks(base: Omit<Entity, "aliases" | "domains">): Entity {
  const links = entityLinks(base.ref);
  return { ...base, aliases: links.filter((l) => l.rel === "alias").map((l) => l.target), domains: links.filter((l) => l.rel === "domain").map((l) => l.target) };
}

const fromRow = (r: ERow): Entity => withLinks({ ref: `${r.kind}:${r.id}`, kind: r.kind as EntityKind, id: r.id, name: r.name, note: r.note, address: r.address, updatedAt: r.updated_at });

type ProjectRow = { id: number; title: string; description: string | null; updated_at: string; number: string | null };
const projectRows = (where = "", ...args: unknown[]): ProjectRow[] =>
  entDb().prepare(`select p.id, p.title, p.description, p.updated_at, j.number from projects p left join jobs j on j.id = p.job_id ${where} order by p.active desc, lower(p.title)`).all(...args) as ProjectRow[];
const fromProject = (p: ProjectRow): Entity => withLinks({ ref: `project:${p.id}`, kind: "project", id: p.id, name: p.title, note: p.description ?? "", address: p.number ?? "", updatedAt: p.updated_at });

export function createEntity(kind: "org" | "place", name: string, opts: { note?: string; address?: string } = {}): number {
  const n = name.trim().slice(0, 200);
  if (!n) throw new Error("A name, please.");
  const r = entDb().prepare("insert into ent_entities (kind, name, note, address, created_at, updated_at) values (?, ?, ?, ?, ?, ?)").run(kind, n, opts.note ?? "", (opts.address ?? "").trim(), now(), now());
  changed();
  return Number(r.lastInsertRowid);
}

/** An entity by its ref (null: none). */
export function getEntity(ref: string): Entity | null {
  const p = parseRef(ref);
  if (!p) return null;
  if (p.kind === "project") {
    try {
      const r = projectRows("where p.id = ?", p.id)[0];
      return r ? fromProject(r) : null;
    } catch {
      return null;
    }
  }
  const r = entDb().prepare("select * from ent_entities where id = ? and kind = ?").get(p.id, p.kind) as ERow | undefined;
  return r ? fromRow(r) : null;
}

/** Every entity of a kind, by name. */
export function listEntities(kind: EntityKind): Entity[] {
  if (kind === "project") {
    try {
      return projectRows().map(fromProject);
    } catch {
      return [];
    }
  }
  return (entDb().prepare("select * from ent_entities where kind = ? order by lower(name)").all(kind) as ERow[]).map(fromRow);
}

export type EntityPatch = { name?: string; note?: string; address?: string; aliases?: string[]; domains?: string[] };

/** Change an entity: its name, note, address (organisations and places), its other names and domains (a list replaces the old one). */
export function updateEntity(ref: string, patch: EntityPatch): void {
  const p = parseRef(ref);
  const cur = getEntity(ref);
  if (!p || !cur) throw new Error("Unknown entity.");
  if (p.kind === "project") {
    if ((patch.name !== undefined && patch.name.trim() !== cur.name) || (patch.note !== undefined && patch.note !== cur.note)) {
      updateProject(p.id, { ...(patch.name !== undefined ? { title: patch.name.trim() } : {}), ...(patch.note !== undefined ? { description: patch.note } : {}) });
    }
  } else {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (patch.name !== undefined && patch.name.trim()) (sets.push("name = ?"), args.push(patch.name.trim().slice(0, 200)));
    if (patch.note !== undefined) (sets.push("note = ?"), args.push(patch.note));
    if (patch.address !== undefined) (sets.push("address = ?"), args.push(patch.address.trim()));
    if (sets.length) entDb().prepare(`update ent_entities set ${sets.join(", ")}, updated_at = ? where id = ?`).run(...args, now(), p.id);
  }
  const replace = (rel: EntityRel, want: string[] | undefined, have: string[]) => {
    if (!want) return;
    const clean = [...new Set(want.map((x) => cleanTarget(rel, x)).filter(Boolean))];
    for (const x of have) if (!clean.includes(x)) removeEntityLink(ref, rel, x);
    for (const x of clean) if (!have.includes(x)) addEntityLink(ref, rel, x);
  };
  replace("alias", patch.aliases, cur.aliases);
  replace("domain", patch.domains, cur.domains);
  changed();
}

/** Two organisations (or places) that are one: the second's names, links and people go to the first, the second goes. */
export function mergeEntities(keepRef: string, dropRef: string): void {
  const keep = parseRef(keepRef);
  const drop = parseRef(dropRef);
  if (!keep || !drop || keepRef === dropRef) return;
  if (keep.kind !== drop.kind || keep.kind === "project") throw new Error("Only organisations or places of one kind can be merged.");
  const k = getEntity(keepRef);
  const x = getEntity(dropRef);
  if (!k || !x) throw new Error("Unknown entity.");
  const d = entDb();
  d.transaction(() => {
    d.prepare("update or ignore ent_links set ref = ? where ref = ?").run(keepRef, dropRef);
    d.prepare("delete from ent_links where ref = ?").run(dropRef);
    // Links that point at the one that goes (a project's organisation).
    d.prepare("update or ignore ent_links set target = ? where rel = ? and target = ?").run(keepRef, keep.kind, dropRef);
    if (foldName(x.name) !== foldName(k.name) && !k.aliases.some((a) => foldName(a) === foldName(x.name))) d.prepare("insert or ignore into ent_links (ref, rel, target, source, created_at) values (?, 'alias', ?, 'suggestion', ?)").run(keepRef, x.name, now());
    if (!k.note && x.note) d.prepare("update ent_entities set note = ? where id = ?").run(x.note, keep.id);
    if (!k.address && x.address) d.prepare("update ent_entities set address = ? where id = ?").run(x.address, keep.id);
    // The people graph's links to it.
    try {
      d.prepare("update or ignore people_links set target_ref = ?, label = ? where target_type = ? and target_ref = ?").run(String(keep.id), k.name, keep.kind, String(drop.id));
      d.prepare("delete from people_links where target_type = ? and target_ref = ?").run(keep.kind, String(drop.id));
    } catch {
      // no people graph
    }
    d.prepare("delete from ent_entities where id = ?").run(drop.id);
    d.prepare("update ent_entities set updated_at = ? where id = ?").run(now(), keep.id);
  })();
  changed();
}

export function deleteEntity(ref: string): void {
  const p = parseRef(ref);
  if (!p || p.kind === "project") return;
  const d = entDb();
  d.prepare("delete from ent_links where ref = ?").run(ref);
  d.prepare("delete from ent_entities where id = ?").run(p.id);
  try {
    d.prepare("delete from people_links where target_type = ? and target_ref = ?").run(p.kind, String(p.id));
  } catch {
    // no people graph
  }
  changed();
}

/** Every way an entity is written, folded (its name, its other names; a place's address too). */
export function formsOf(e: Entity): string[] {
  const forms = [e.name, ...e.aliases].map(foldName);
  if (e.kind === "place" && e.address) forms.push(normalizeAddress(e.address));
  return [...new Set(forms.filter(Boolean))];
}
