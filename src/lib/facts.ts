import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emitChange } from "@/lib/events";
import { isInstalled } from "@/plugins/state";
import { mirrorFact, peopleOfFact, unmirrorFact } from "@/plugins/people/synergy";
import { getPerson } from "@/plugins/people/store";
import { factRef, type FactView } from "./facts-shared";
import { attributeOfSubject } from "./trust/normalize";
import { onTrustDecision, recordFact, setTarget, versionsOf } from "./trust/store";

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
 * A fact kept — one per subject (case aside): a newer text that says the same (another wording, the same
 * day) replaces the old one, its sources added. A text that contradicts what the fact says (another day,
 * another IBAN) isn't written over it: it waits in the review queue (trust in facts, @/lib/trust) and is
 * written once you take it. `fromUser`: you said it (it holds at once; its claim on a profile is confirmed).
 */
export function addFact(v: { subject: string; text: string; refs: string[] }, opts: { fromUser?: boolean } = {}): FactView | null {
  const view = keepFact(v, opts);
  if (view) onPeople(() => mirrorFact(view, opts));
  return view;
}

/**
 * What a fact is about, for trust: one profile it names and the kind its subject says ("Lotte Brandt
 * Geburtstag" → person:12 + birthday) — else its own subject.
 */
function identityOf(subject: string, text: string): { subject: string; label: string; attribute: string } {
  const attribute = attributeOfSubject(subject);
  let person: { id: number; name: string } | null = null;
  if (attribute !== "text")
    onPeople(() => {
      const ids = peopleOfFact({ subject, text });
      if (ids.length === 1) person = { id: ids[0], name: getPerson(ids[0])?.name ?? "" };
    });
  const p = person as { id: number; name: string } | null;
  return p ? { subject: `person:${p.id}`, label: p.name, attribute } : { subject: `subject:${subject.toLowerCase()}`, label: subject, attribute };
}

const rowOf = (id: number) => getDb().select().from(facts).where(eq(facts.id, id)).get();
const rowBySubject = (subject: string) => getDb().select().from(facts).where(sql`lower(${facts.subject}) = ${subject.toLowerCase()}`).get();
const idOfRef = (ref: string) => (ref.startsWith("fact:") ? Number(ref.slice(5)) : 0);

function keepFact(v: { subject: string; text: string; refs: string[] }, opts: { fromUser?: boolean } = {}): FactView | null {
  const subject = v.subject.trim().slice(0, 200);
  const text = v.text.trim().slice(0, 2000);
  if (!subject || !text) return null;
  const had = rowBySubject(subject);
  const who = identityOf(subject, text);
  const record = (value: string, refs: string[], target: string, byUser?: boolean) =>
    recordFact({ subject: who.subject, subjectLabel: who.label, attribute: who.attribute, value, writer: "facts", target, payload: { subject, text: value, refs }, sourceRef: refs[0] ?? "", quote: value, byUser });
  // Kept before trust knew it: what it says holds until now.
  if (had && !versionsOf(who.subject, who.attribute).length) record(had.text, JSON.parse(had.refs) as string[], factRef(had.id));
  const r = record(text, v.refs, had ? factRef(had.id) : "", opts.fromUser);
  if (r.outcome === "disputed" || r.outcome === "rejected" || r.outcome === "superseded") {
    // Not written: what holds stays (the fact this subject has, or the one that says it).
    const holds = had ?? r.current.map((c) => rowOf(idOfRef(c.target))).find(Boolean);
    return holds ? toView(holds) : null;
  }
  const row = writeFact(subject, text, v.refs, had);
  setTarget(r.version.id, factRef(row.id));
  return toView(row);
}

/** The fact written (its row, or a new one): the text, its sources added. */
function writeFact(subject: string, text: string, refs: string[], had?: typeof facts.$inferSelect): typeof facts.$inferSelect {
  const db = getDb();
  const now = new Date().toISOString();
  emitChange("todos");
  if (had) {
    const all = [...new Set([...(JSON.parse(had.refs) as string[]), ...refs])].slice(-20);
    db.update(facts).set({ text, refs: JSON.stringify(all), updatedAt: now }).where(eq(facts.id, had.id)).run();
    return rowOf(had.id)!;
  }
  return db.insert(facts).values({ subject, text, refs: JSON.stringify([...new Set(refs)].slice(0, 20)), createdAt: now, updatedAt: now }).returning().get();
}

/**
 * Your word on a fact that changed (the review queue): taken, the new text goes into the fact it
 * contradicted; both valid, it is added to it (or kept as a fact of its own subject); outdated, the fact
 * goes. What you kept out was never written.
 */
onTrustDecision("facts", (changes, decision) => {
  const superseded = changes.filter((c) => c.status === "superseded");
  if (decision === "outdated") {
    for (const c of superseded) if (idOfRef(c.target)) deleteFact(idOfRef(c.target));
    return;
  }
  for (const c of changes.filter((x) => x.status === "current")) {
    const p = c.payload as { subject?: string; text?: string; refs?: string[] };
    const subject = String(p.subject ?? c.subjectLabel);
    const text = String(p.text ?? c.value);
    const refs = Array.isArray(p.refs) ? p.refs.map(String) : [];
    const into = decision === "new" ? superseded.map((x) => rowOf(idOfRef(x.target))).find(Boolean) : undefined;
    const own = rowBySubject(subject);
    let row: typeof facts.$inferSelect;
    if (into) row = writeFact(into.subject, text, refs, into);
    else if (decision === "both" && own) row = writeFact(own.subject, `${own.text}\n${text}`, refs, own);
    else row = writeFact(subject, text, refs, own);
    setTarget(c.id, factRef(row.id));
    const view = toView(row);
    onPeople(() => mirrorFact(view));
    // The other facts it replaces (a second subject that said the old): gone.
    if (decision === "new") for (const x of superseded) if (idOfRef(x.target) && idOfRef(x.target) !== row.id) deleteFact(idOfRef(x.target));
  }
});

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
