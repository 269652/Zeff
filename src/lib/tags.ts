import { asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Tag } from "@/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { dedupeTags, normalizeTagName, type TagLite } from "./tags-shared";

const { tags, entryTags } = schema;

export type TagWithCount = Tag & { entryCount: number };

export function listTags(): Tag[] {
  return getDb().select().from(tags).orderBy(asc(tags.name)).all();
}

export function listTagsWithCounts(): TagWithCount[] {
  const rows = getDb()
    .select({ tag: tags, entryCount: sql<number>`count(${entryTags.entryId})` })
    .from(tags)
    .leftJoin(entryTags, eq(entryTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(asc(tags.name))
    .all();
  return rows.map((r) => ({ ...r.tag, entryCount: Number(r.entryCount) }));
}

export function getTagByName(name: string): Tag | undefined {
  const n = normalizeTagName(name);
  return getDb()
    .select()
    .from(tags)
    .where(sql`lower(${tags.name}) = lower(${n})`)
    .get();
}

export function createTag(name: string, color?: string | null): Tag {
  const n = normalizeTagName(name);
  if (!n) throw new ValidationError("Tag name is required.");
  if (getTagByName(n)) throw new ConflictError(`Tag "${n}" already exists.`);
  return getDb().insert(tags).values({ name: n, color: color || null }).returning().get();
}

/** Return existing tags (by case-insensitive name) or create them; preserves order. */
export function getOrCreateTags(names: string[]): Tag[] {
  const db = getDb();
  const result: Tag[] = [];
  for (const raw of dedupeTags(names.map(normalizeTagName).filter(Boolean))) {
    const existing = getTagByName(raw);
    result.push(existing ?? db.insert(tags).values({ name: raw }).returning().get());
  }
  return result;
}

export function renameTag(id: number, name: string, color?: string | null): Tag {
  const n = normalizeTagName(name);
  if (!n) throw new ValidationError("Tag name is required.");
  const db = getDb();
  const existing = db.select().from(tags).where(eq(tags.id, id)).get();
  if (!existing) throw new NotFoundError(`Tag #${id} not found.`);
  const clash = getTagByName(n);
  if (clash && clash.id !== id) throw new ConflictError(`Tag "${n}" already exists.`);
  return db
    .update(tags)
    .set({ name: n, color: color === undefined ? existing.color : color || null })
    .where(eq(tags.id, id))
    .returning()
    .get();
}

export function deleteTag(id: number): void {
  getDb().delete(tags).where(eq(tags.id, id)).run(); // entry_tags rows cascade
}

// ---------------------------------------------------------------------------
// Entry <-> tag associations
// ---------------------------------------------------------------------------

/** Replace an entry's tags with exactly `tagIds`. */
export function setEntryTags(entryId: number, tagIds: number[]): void {
  const db = getDb();
  db.delete(entryTags).where(eq(entryTags.entryId, entryId)).run();
  const unique = [...new Set(tagIds)];
  if (unique.length) {
    db.insert(entryTags)
      .values(unique.map((tagId) => ({ entryId, tagId })))
      .run();
  }
}

/** Tags for many entries at once, as a map from entryId to its tags. */
export function getTagsForEntries(entryIds: number[]): Map<number, TagLite[]> {
  const map = new Map<number, TagLite[]>();
  if (entryIds.length === 0) return map;
  const rows = getDb()
    .select({
      entryId: entryTags.entryId,
      id: tags.id,
      name: tags.name,
      color: tags.color,
    })
    .from(entryTags)
    .innerJoin(tags, eq(tags.id, entryTags.tagId))
    .where(inArray(entryTags.entryId, entryIds))
    .orderBy(asc(tags.name))
    .all();
  for (const r of rows) {
    const list = map.get(r.entryId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.entryId, list);
  }
  return map;
}
