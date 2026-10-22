import { getSqlite } from "@/db";

/**
 * Full-text search over the documents (the Documents plugin): every word you type found somewhere in a document — its name, the
 * whole text read from it, its summary or its concepts —, case ignored. And a document's whole text and summary, for its detail.
 * Server only.
 */

/** The words of a query (at most eight, each at least two characters). */
const wordsOf = (q: string) =>
  q
    .toLowerCase()
    .split(/[^\p{L}\p{N}@.\-/]+/u)
    .map((w) => w.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter((w) => w.length >= 2)
    .slice(0, 8);

/** The ids of the documents holding every word of `q` (none typed: none). */
export function documentsMatching(q: string): number[] {
  const words = wordsOf(q);
  if (!words.length) return [];
  const hay = "lower(coalesce(name,'') || ' ' || coalesce(text,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(concepts,''))";
  const where = words.map(() => `instr(${hay}, ?) > 0`).join(" and ");
  try {
    return (getSqlite().prepare(`select id from documents where ${where}`).all(...words) as { id: number }[]).map((r) => r.id);
  } catch {
    return [];
  }
}

/** A document's whole text and its summary (null: no such document). */
export function documentText(id: number): { text: string; summary: string } | null {
  try {
    const r = getSqlite().prepare("select text, summary from documents where id = ?").get(id) as { text: string | null; summary: string | null } | undefined;
    return r ? { text: r.text ?? "", summary: r.summary ?? "" } : null;
  } catch {
    return null;
  }
}
