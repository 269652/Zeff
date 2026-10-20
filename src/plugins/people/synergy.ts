/**
 * Zeff's facts (the mail review's "Obergerichtsvollzieherin Nathanael Abwesenheit: nicht im Dienst bis …")
 * on the profiles they are about: a fact whose subject or text names a profile (a name, an alias, a part
 * of the name no one else has, an address of theirs) is mirrored as a claim of that person — kind "fact",
 * from "fact:<id>", to confirm (yours: confirmed). What the profile knows already, in other words, isn't
 * added again; a fact changed changes its claim, a fact gone takes its claim along (one you confirmed
 * stays, unless the fact is deleted). Server only.
 */
import { getDb, schema } from "@/db";
import { similarText, wordOverlap } from "@/lib/boards/similar";
import { claimsFrom, claimsOf, addClaim, deleteClaim, setClaimText, type Claim } from "./graph";
import { claimReviewed, flushSoon } from "./knowledge-sync";
import { buildPeopleIndex, mentionMatcher, splitMentions } from "./mentions";
import type { Person } from "./shared";
import { listPeople } from "./store";

type Fact = { id: number; subject: string; text: string };

/** The mail review's facts show on the card (marked) before you confirm them. */
const CONFIDENCE = 0.85;
const ref = (id: number) => `fact:${id}`;
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const DATE = /\b\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?/g;
/**
 * Two claims that say the same: the same words, or mostly (similar.ts — as todos are compared), or a
 * date in common and a good part of the words ("Urlaub bis 29.10.2026 …" / "Nicht im Dienst bis 29.10.2026 …").
 */
function same(a: string, b: string): boolean {
  if (norm(a) === norm(b) || similarText(a, b)) return true;
  const dates = new Set(a.match(DATE) ?? []);
  return (b.match(DATE) ?? []).some((d) => dates.has(d)) && wordOverlap(a, b) >= 0.3;
}

/** A fact as a claim: its text — with its subject in front when the text doesn't say it ("Nadines Geburtstag: 16.10."). */
const claimText = (f: Pick<Fact, "subject" | "text">) => {
  const text = f.text.trim();
  const subject = f.subject.trim();
  return !subject || norm(text).includes(norm(subject)) ? text : `${subject}: ${text}`;
};

type Matcher = { match: ReturnType<typeof mentionMatcher>; people: Person[] };
const matcher = (): Matcher => {
  const people = listPeople();
  return { people, match: mentionMatcher(buildPeopleIndex(people.map((p) => ({ ...p, aliases: [...p.aliases, ...p.accounts.map((a) => a.value)] })))) };
};

/** The profiles a fact is about: named in its subject or text, or one of their addresses in it. */
export function peopleOfFact(f: Pick<Fact, "subject" | "text">, m: Matcher = matcher()): number[] {
  const all = `${f.subject}\n${f.text}`;
  const lower = all.toLowerCase();
  const ids = new Set(splitMentions(all, m.match).flatMap((x) => (x.person ? [x.person.id] : [])));
  for (const p of m.people) if (p.emails.some((e) => e.includes("@") && lower.includes(e.toLowerCase()))) ids.add(p.id);
  return [...ids];
}

/** A fact on the profiles it is about (see above). `fromUser`: you said it — confirmed. How many claims changed. */
export function mirrorFact(f: Fact, opts: { fromUser?: boolean } = {}, m: Matcher = matcher()): number {
  if (!f.text.trim()) return 0;
  const text = claimText(f);
  const mirrored = claimsFrom(ref(f.id));
  const about = new Set(peopleOfFact(f, m));
  let changed = 0;
  for (const personId of about) {
    const mine = mirrored.find((c) => c.personId === personId);
    if (mine) {
      if (mine.text !== text.slice(0, 300) && setClaimText(mine.id, text, f.subject)) {
        changed++;
        // Already in the knowledge: there too.
        if (mine.status === "confirmed" && claimReviewed(mine.id)) flushSoon();
      }
      continue;
    }
    const known = claimsOf(personId, { status: ["proposed", "confirmed", "rejected"] });
    if (known.some((c: Claim) => same(c.text, text) || same(c.text, f.text))) continue;
    if (addClaim({ personId, kind: "fact", text, evidence: f.subject, sourceRef: ref(f.id), confidence: CONFIDENCE, status: opts.fromUser ? "confirmed" : "proposed" })) changed++;
  }
  // Those it no longer names: their claim goes — unless you confirmed it.
  for (const c of mirrored) {
    if (about.has(c.personId) || c.status === "confirmed") continue;
    deleteClaim(c.id);
    changed++;
  }
  return changed;
}

/** A fact deleted: its claims go (out of the knowledge too, when they were sent). */
export function unmirrorFact(id: number): number {
  const mirrored = claimsFrom(ref(id));
  for (const c of mirrored) {
    deleteClaim(c.id);
    if (claimReviewed(c.id)) flushSoon();
  }
  return mirrored.length;
}

/**
 * The sync pass: every fact mirrored (those written before, or by others than addFact), the claims of
 * facts gone removed. How many claims changed.
 */
export function syncFactClaims(): number {
  const facts = getDb().select({ id: schema.facts.id, subject: schema.facts.subject, text: schema.facts.text }).from(schema.facts).all();
  const m = matcher();
  let changed = 0;
  for (const f of facts) changed += mirrorFact(f, {}, m);
  const alive = new Set(facts.map((f) => ref(f.id)));
  for (const c of claimsFrom("fact:", { prefix: true })) {
    if (alive.has(c.sourceRef)) continue;
    changed += unmirrorFact(Number(c.sourceRef.slice(5)));
  }
  return changed;
}
