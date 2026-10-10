import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

const { prefs } = schema;

/** A preference (JSON) — the fallback when it isn't set or can't be read. */
export function getPref<T>(key: string, fallback: T): T {
  const r = getDb().select({ value: prefs.value }).from(prefs).where(eq(prefs.key, key)).get();
  if (!r) return fallback;
  try {
    return JSON.parse(r.value) as T;
  } catch {
    return fallback;
  }
}

export function setPref(key: string, value: unknown): void {
  const json = JSON.stringify(value);
  getDb().insert(prefs).values({ key, value: json }).onConflictDoUpdate({ target: prefs.key, set: { value: json } }).run();
}
