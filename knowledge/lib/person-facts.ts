import { db } from "./db";
import { entityDetail, type EntityDetail } from "./graph";
import { storePage } from "./ingest";
import { mergeEntities } from "./normalize";
import { OWN_PREFIX, OWN_SPACE } from "./own";

/**
 * What Zeff confirmed about a person, kept with their entity: one page of your own per person entity
 * ("own:person-<id>"), a line per confirmed fact (by its ref in Zeff, "claim:12") — linked to the entity
 * at once and marked compiled, so compiling neither waits for it nor makes new entities of it. And
 * merging a person kept twice ("U. Wagner", "Wagner") into one, as Zeff's profile asks.
 */

const NOT_FOUND = "not found";

type Person = { id: number; name: string; type: string };
const personEntity = (id: number): Person | undefined => db().prepare("select id, name, type from entities where id = ?").get(id) as Person | undefined;

/** A line of the page: "- text [ref]". */
const LINE = /^- (.*) \[([^\]]+)\]$/;

/**
 * A fact about the entity, as Zeff confirmed it: its line on the person's page added, or replaced (the
 * same ref) — an empty text removes it. The page's id. Throws "not found" for an unknown entity.
 */
export function addPersonFact(entityId: number, v: { ref: string; text: string }): string {
  const e = personEntity(entityId);
  if (!e) throw new Error(NOT_FOUND);
  const ref = v.ref.replace(/[[\]\n]/g, "").trim().slice(0, 80);
  const text = v.text.replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!ref) throw new Error("A fact needs its ref.");
  const id = `${OWN_PREFIX}person-${e.id}`;
  const d = db();
  const cur = d.prepare("select body, version from pages where id = ?").get(id) as { body: string; version: number } | undefined;
  const lines = (cur?.body ?? "").split("\n").filter((l) => LINE.test(l) && LINE.exec(l)![2] !== ref);
  if (text) lines.push(`- ${text} [${ref}]`);
  const version = (cur?.version ?? 0) + 1;
  const now = new Date().toISOString();
  const body = lines.join("\n");
  storePage({ id, space: OWN_SPACE, title: `Bestätigt über ${e.name}`, url: "", version, updatedAt: now, author: "Ich", body: body || "(nichts mehr)" });
  d.prepare("update pages set compiled_version = version, compiled_at = ?, summary = ? where id = ?").run(now, body.slice(0, 500), id);
  d.prepare("insert or ignore into entity_pages (entity_id, page_id) values (?, ?)").run(e.id, id);
  return id;
}

/**
 * One person kept as several entities made one: `drop`'s pages, relations and names go to `keep`, which
 * keeps its name and type (normalize.ts's merge — their keys point to it from now on). `keep` in full after it.
 */
export function mergePersonEntities(keep: number, drop: number[]): EntityDetail {
  const k = personEntity(keep);
  if (!k) throw new Error(NOT_FOUND);
  const others = [...new Set(drop.map(Number))].filter((id) => id !== keep && Number.isInteger(id) && personEntity(id));
  if (!others.length) throw new Error("Nothing to merge.");
  mergeEntities(keep, [keep, ...others], k.name, k.type, "Zeff: ein Profil, mehrere Einträge");
  return entityDetail(keep)!;
}
