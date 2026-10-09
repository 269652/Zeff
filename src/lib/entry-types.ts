import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { BUILTIN_TYPE_KEYS, typeMapOf, type EntryTypeDef } from "./entry-types-shared";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { getTypeRules } from "./type-rules";

const { entryTypes, timeEntries } = schema;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function listEntryTypes(): EntryTypeDef[] {
  return getDb()
    .select()
    .from(entryTypes)
    .orderBy(asc(entryTypes.sort), asc(entryTypes.label))
    .all()
    .map((t) => ({ key: t.key, label: t.label, color: t.color, builtin: BUILTIN_TYPE_KEYS.includes(t.key) }));
}

export function entryTypeMap(): Record<string, EntryTypeDef> {
  return typeMapOf(listEntryTypes());
}

export function isEntryType(key: string): boolean {
  return !!getDb().select({ key: entryTypes.key }).from(entryTypes).where(eq(entryTypes.key, key)).get();
}

/** Throws unless `key` is a configured type. */
export function assertEntryType(key: string): void {
  if (!isEntryType(key)) {
    throw new ValidationError(`Unknown type "${key}". Types: ${listEntryTypes().map((t) => t.key).join(", ")}.`);
  }
}

/** How many entries each type has. */
export function entryTypeUsage(): Record<string, number> {
  const rows = getDb()
    .select({ type: timeEntries.type, n: sql<number>`count(*)` })
    .from(timeEntries)
    .groupBy(timeEntries.type)
    .all();
  return Object.fromEntries(rows.map((r) => [r.type, Number(r.n)]));
}

/** "Weiterbildung & Kurse" → "weiterbildung-kurse" — the stored key of a new type. */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function checkFields(label: string, color: string) {
  if (!label.trim()) throw new ValidationError("Give the type a name.");
  if (label.trim().length > 40) throw new ValidationError("Keep the name under 40 characters.");
  if (!HEX_COLOR.test(color)) throw new ValidationError("Pick a color.");
}

export function createEntryType(input: { label: string; color: string }): EntryTypeDef {
  checkFields(input.label, input.color);
  const key = slugify(input.label);
  if (!key) throw new ValidationError("Use letters or digits in the name.");
  if (isEntryType(key)) throw new ConflictError(`There already is a type "${key}".`);
  const db = getDb();
  const last = db.select({ max: sql<number>`coalesce(max(${entryTypes.sort}), -1)` }).from(entryTypes).get();
  db.insert(entryTypes)
    .values({ key, label: input.label.trim(), color: input.color.toLowerCase(), sort: Number(last?.max ?? -1) + 1 })
    .run();
  return { key, label: input.label.trim(), color: input.color.toLowerCase(), builtin: false };
}

/** Rename / recolor types; returns how many changed. */
export function updateEntryTypes(updates: { key: string; label: string; color: string }[]): number {
  for (const u of updates) checkFields(u.label, u.color);
  const db = getDb();
  let changed = 0;
  db.transaction((tx) => {
    for (const u of updates) {
      changed += tx
        .update(entryTypes)
        .set({ label: u.label.trim(), color: u.color.toLowerCase() })
        .where(eq(entryTypes.key, u.key))
        .run().changes;
    }
  });
  return changed;
}

/** Delete a type nothing uses (built-in types stay). */
export function deleteEntryType(key: string): void {
  const db = getDb();
  const t = db.select().from(entryTypes).where(eq(entryTypes.key, key)).get();
  if (!t) throw new NotFoundError(`Type "${key}" not found.`);
  if (BUILTIN_TYPE_KEYS.includes(key)) throw new ValidationError(`"${t.label}" is built in — rename or recolor it instead.`);
  const used = entryTypeUsage()[key] ?? 0;
  if (used) throw new ConflictError(`${used} ${used === 1 ? "entry is" : "entries are"} typed "${t.label}" — change them first.`);
  if (getTypeRules().some((r) => r.type === key)) {
    throw new ConflictError(`An entry type rule (Schedule) sets "${t.label}" — change that rule first.`);
  }
  db.delete(entryTypes).where(eq(entryTypes.key, key)).run();
}
