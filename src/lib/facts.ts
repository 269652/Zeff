import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emitChange } from "@/lib/events";
import { isInstalled } from "@/plugins/state";
import { mirrorFact, unmirrorFact } from "@/plugins/people/synergy";
import { factRef, type FactView } from "./facts-shared";

export type { FactView } from "./facts-shared";

const { facts } = schema;

const toView = (r: typeof facts.$inferSelect): FactView => ({
  id: r.id,
  ref: factRef(r.id),
  subject: r.subject,
  text: r.text,
  refs: (() => {
    try {
      return JSON.parse(r.refs) as string[];
    } catch {
      return [];
    }
  })(),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** What a fact about someone becomes on their profile (the People plugin): a claim of theirs — never in the way of keeping it. */
function onPeople(fn: () => void) {
  try {
    if (isInstalled("people")) fn();
  } catch (e) {
    console.warn("[facts] people:", e instanceof Error ? e.message : String(e));
  }
}

/**
 * A fact kept — one per subject (case aside): a newer text replaces the old one, its sources added.
 * `fromUser`: you said it (its claim on a profile is confirmed at once).
 */
export function addFact(v: { subject: string; text: string; refs: string[] }, opts: { fromUser?: boolean } = {}): FactView | null {
  const view = keepFact(v);
  if (view) onPeople(() => mirrorFact(view, opts));
  return view;
}

function keepFact(v: { subject: string; text: string; refs: string[] }): FactView | null {
  const subject = v.subject.trim().slice(0, 200);
  const text = v.text.trim().slice(0, 2000);
  if (!subject || !text) return null;
  const db = getDb();
  const now = new Date().toISOString();
  const had = db.select().from(facts).where(sql`lower(${facts.subject}) = ${subject.toLowerCase()}`).get();
  if (had) {
    const refs = [...new Set([...(JSON.parse(had.refs) as string[]), ...v.refs])].slice(-20);
    db.update(facts).set({ text, refs: JSON.stringify(refs), updatedAt: now }).where(eq(facts.id, had.id)).run();
    emitChange("todos");
    return toView(db.select().from(facts).where(eq(facts.id, had.id)).get()!);
  }
  const row = db.insert(facts).values({ subject, text, refs: JSON.stringify([...new Set(v.refs)].slice(0, 20)), createdAt: now, updatedAt: now }).returning().get();
  emitChange("todos");
  return toView(row);
}

/** A fact gone — and its claims on profiles with it. */
export function deleteFact(id: number): void {
  if (!getDb().delete(facts).where(eq(facts.id, id)).run().changes) return;
  onPeople(() => unmirrorFact(id));
  emitChange("todos");
}

/** The facts with these refs ("fact:12"), by ref. */
export function factsByRefs(refs: string[]): Map<string, FactView> {
  const ids = [...new Set(refs.filter((r) => r.startsWith("fact:")).map((r) => Number(r.slice(5))).filter(Number.isInteger))];
  if (!ids.length) return new Map();
  return new Map(getDb().select().from(facts).where(inArray(facts.id, ids)).all().map((r) => [factRef(r.id), toView(r)]));
}

/** All facts, newest first. */
export const listFacts = (limit = 500): FactView[] => getDb().select().from(facts).orderBy(desc(facts.updatedAt)).limit(limit).all().map(toView);
