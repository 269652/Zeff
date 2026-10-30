import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { attributeSpec, normalizeValue, sameValue, shelfLife } from "./normalize";
import { localDay } from "@/lib/dates";
import { trimSlice } from "@/lib/text";

/**
 * Trust in facts (server only): every value Zeff keeps about someone or something — a person's IBAN or address,
 * a birthday a fact names, a project's prod address — as versions of one thing, (subject, attribute):
 * "person:12" + "iban", "repo:3" + "prod-url". Each version has its value, where it was read (a ref, a quote, a
 * link), when it was first seen, last seen and last confirmed, how sure the reader was, until when it holds
 * (its attribute's shelf life) and its status: current, disputed (it contradicts the current one and waits for
 * you), superseded (a newer one holds) or rejected (you said it's wrong).
 *
 * The writers (the facts, the People plugin's details, the Knowledge plugin's project systems) record what they
 * read here and keep their own store; a value that contradicts the current one isn't written over it — it waits
 * in the review queue ("IBAN of Wagner changed: old … → new …"), and your answer goes back to the writer
 * (see apply.ts). What you said yourself replaces at once.
 */

export type VersionStatus = "current" | "disputed" | "superseded" | "rejected";

export type FactVersion = {
  id: number;
  /** What it is about: "person:12", "repo:3", "subject:<a fact's subject>". */
  subject: string;
  /** How the subject is called, for the review queue ("Wagner"). */
  subjectLabel: string;
  attribute: string;
  value: string;
  norm: string;
  /** Who recorded it ("facts", "details", "repo") — told what you decided. */
  writer: string;
  /** The writer's own record of it, where it has one ("fact:12"). */
  target: string;
  /** What the writer needs to write it later (a disputed one isn't written yet). */
  payload: Record<string, unknown>;
  /** Where it was read first ("mail:<key>", "doc:7"; "you": you said it). */
  sourceRef: string;
  /** Every source it was read in, the first first. */
  sources: string[];
  quote: string;
  link: string;
  confidence: number;
  status: VersionStatus;
  firstSeen: string;
  seenAt: string;
  confirmedAt: string;
  /** When it is asked about again (null: never). */
  expiresAt: string | null;
  decidedAt: string | null;
  byUser: boolean;
};

export type FactInput = {
  subject: string;
  subjectLabel?: string;
  attribute: string;
  value: string;
  writer: string;
  target?: string;
  payload?: Record<string, unknown>;
  sourceRef?: string;
  quote?: string;
  link?: string;
  confidence?: number;
  /** You said it: it holds at once (what it contradicts is superseded). */
  byUser?: boolean;
};

/** What became of a value recorded: new, the same as a known one, or — known before — what you decided about it. */
export type RecordOutcome = "added" | "same" | "disputed" | "superseded" | "rejected";

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists fact_versions (id integer primary key autoincrement, subject text not null, subject_label text not null default '', attribute text not null, value text not null, norm text not null, writer text not null default '', target text not null default '', payload text not null default '{}', source_ref text not null default '', sources text not null default '[]', quote text not null default '', link text not null default '', confidence real not null default 0.7, status text not null default 'current', first_seen text not null, seen_at text not null, confirmed_at text not null, expires_at text, decided_at text, by_user integer not null default 0, unique (subject, attribute, norm));
    create index if not exists fact_versions_subject on fact_versions (subject, attribute);
    create table if not exists review_batches (kind text not null, item text not null, day text not null, primary key (kind, item));
  `);
  return d;
}

type Row = { id: number; subject: string; subject_label: string; attribute: string; value: string; norm: string; writer: string; target: string; payload: string; source_ref: string; sources: string; quote: string; link: string; confidence: number; status: string; first_seen: string; seen_at: string; confirmed_at: string; expires_at: string | null; decided_at: string | null; by_user: number };

const parse = <T>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};
const STATUSES: VersionStatus[] = ["current", "disputed", "superseded", "rejected"];
const toVersion = (r: Row): FactVersion => ({
  id: r.id,
  subject: r.subject,
  subjectLabel: r.subject_label,
  attribute: r.attribute,
  value: r.value,
  norm: r.norm,
  writer: r.writer,
  target: r.target,
  payload: parse(r.payload, {}),
  sourceRef: r.source_ref,
  sources: parse(r.sources, []),
  quote: r.quote,
  link: r.link,
  confidence: r.confidence,
  status: STATUSES.includes(r.status as VersionStatus) ? (r.status as VersionStatus) : "current",
  firstSeen: r.first_seen,
  seenAt: r.seen_at,
  confirmedAt: r.confirmed_at,
  expiresAt: r.expires_at,
  decidedAt: r.decided_at,
  byUser: !!r.by_user,
});

const expiry = (attribute: string, from: Date) => {
  const days = shelfLife(attribute);
  return days == null ? null : new Date(from.getTime() + days * 864e5).toISOString();
};

/** Every version of (subject, attribute) — or of the subject — the current first, then the newest. */
export function versionsOf(subject: string, attribute?: string): FactVersion[] {
  const rows = attribute
    ? db().prepare("select * from fact_versions where subject = ? and attribute = ? order by status = 'current' desc, id desc").all(subject, attribute)
    : db().prepare("select * from fact_versions where subject = ? order by attribute, status = 'current' desc, id desc").all(subject);
  return (rows as Row[]).map(toVersion);
}

/** The values that hold for a subject (of one attribute): current only, the oldest first. */
export function currentFacts(subject: string, attribute?: string): FactVersion[] {
  return versionsOf(subject, attribute)
    .filter((v) => v.status === "current")
    .sort((a, b) => a.id - b.id);
}

export const getVersion = (id: number): FactVersion | null => {
  const r = db().prepare("select * from fact_versions where id = ?").get(id) as Row | undefined;
  return r ? toVersion(r) : null;
};

/** The version of (subject, attribute) that says what `value` says, if any. */
export function versionFor(subject: string, attribute: string, value: string): FactVersion | null {
  return versionsOf(subject, attribute).find((v) => sameValue(attribute, v.value, value)) ?? null;
}

/**
 * A value read (or said by you) recorded: seen again, it counts as confirmed when it comes from a source not
 * seen before; new and contradicting the current value of a one-value attribute, it is disputed — the current
 * one holds until you decide (you said it: it holds at once). What became of it, its version and what holds now.
 */
export function recordFact(v: FactInput, now = new Date()): { outcome: RecordOutcome; version: FactVersion; current: FactVersion[] } {
  const d = db();
  const at = now.toISOString();
  const value = trimSlice(v.value, 500);
  const source = trimSlice(v.sourceRef, 160) || (v.byUser ? "you" : "");
  const all = versionsOf(v.subject, v.attribute);
  const match = all.find((x) => sameValue(v.attribute, x.value, value));
  if (match) {
    const fresh = !!source && !match.sources.includes(source);
    const sources = fresh ? [...match.sources, source].slice(-10) : match.sources;
    const confirmed = fresh || v.byUser;
    // (A text's latest wording kept: "16. Oktober" for "16.10."; an IBAN, an address keep theirs.)
    const kind = attributeSpec(v.attribute).kind;
    d.prepare("update fact_versions set value = ?, seen_at = ?, sources = ?, confirmed_at = ?, expires_at = ?, subject_label = coalesce(nullif(?, ''), subject_label) where id = ?").run(
      kind === "text" || kind === "date" ? value : match.value,
      at,
      JSON.stringify(sources),
      confirmed ? at : match.confirmedAt,
      confirmed ? expiry(v.attribute, now) : match.expiresAt,
      trimSlice(v.subjectLabel, 120),
      match.id,
    );
    if (v.byUser && match.status !== "current") {
      decideVersion(match.id, "new", now);
      return { outcome: "added", version: getVersion(match.id)!, current: currentFacts(v.subject, v.attribute) };
    }
    const outcome: RecordOutcome = match.status === "current" ? "same" : match.status;
    return { outcome, version: getVersion(match.id)!, current: currentFacts(v.subject, v.attribute) };
  }
  const current = all.filter((x) => x.status === "current");
  const disputed = attributeSpec(v.attribute).single && current.length > 0 && !v.byUser;
  const r = d
    .prepare(
      "insert into fact_versions (subject, subject_label, attribute, value, norm, writer, target, payload, source_ref, sources, quote, link, confidence, status, first_seen, seen_at, confirmed_at, expires_at, by_user) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      v.subject,
      trimSlice(v.subjectLabel, 120),
      v.attribute,
      value,
      normalizeValue(v.attribute, value),
      v.writer,
      trimSlice(v.target, 120),
      JSON.stringify(v.payload ?? {}),
      source,
      JSON.stringify(source ? [source] : []),
      trimSlice(v.quote, 300),
      trimSlice(v.link, 300),
      Math.max(0, Math.min(1, v.confidence ?? (v.byUser ? 1 : 0.7))),
      disputed ? "disputed" : "current",
      at,
      at,
      at,
      expiry(v.attribute, now),
      v.byUser ? 1 : 0,
    );
  const id = Number(r.lastInsertRowid);
  // Yours, of a one-value attribute: what held before is superseded.
  if (v.byUser && attributeSpec(v.attribute).single && current.length) supersede(current, at);
  if (disputed) emitChange("todos");
  return { outcome: disputed ? "disputed" : "added", version: getVersion(id)!, current: currentFacts(v.subject, v.attribute) };
}

function supersede(versions: FactVersion[], at: string): void {
  const up = db().prepare("update fact_versions set status = 'superseded', decided_at = ? where id = ?");
  for (const x of versions) up.run(at, x.id);
  notify(versions.map((x) => ({ ...x, status: "superseded" as const })), "new");
}

/** Versions whose status changed, for their writers (apply.ts registers them). */
export type TrustChange = FactVersion;
type Writer = (changes: TrustChange[], decision: Decision) => void;
const writers = ((globalThis as unknown as { __zeffTrustWriters?: Map<string, Writer> }).__zeffTrustWriters ??= new Map());

/** A writer told what became of the versions it recorded (taken, superseded, rejected): it updates its own store. */
export function onTrustDecision(writer: string, fn: Writer): void {
  writers.set(writer, fn);
}

function notify(changes: TrustChange[], decision: Decision): void {
  const by = new Map<string, TrustChange[]>();
  for (const c of changes) by.set(c.writer, [...(by.get(c.writer) ?? []), c]);
  for (const [w, list] of by) {
    try {
      writers.get(w)?.(list, decision);
    } catch (e) {
      console.warn("[trust]", w, e instanceof Error ? e.message : String(e));
    }
  }
}

/**
 * Your word on a version: for a disputed one "new" (it holds, the current ones are superseded), "old" (it is
 * rejected), "both" (it holds beside them); for a current one past its time "still" (confirmed again) or
 * "outdated" (superseded, nothing instead). The versions that changed (their writers are told).
 */
export type Decision = "new" | "old" | "both" | "still" | "outdated";

export function decideVersion(id: number, decision: Decision, now = new Date()): FactVersion[] {
  const v = getVersion(id);
  if (!v) return [];
  const d = db();
  const at = now.toISOString();
  const set = (x: FactVersion, status: VersionStatus) => {
    d.prepare("update fact_versions set status = ?, decided_at = ?, confirmed_at = case when ? = 'current' then ? else confirmed_at end, expires_at = case when ? = 'current' then ? else expires_at end where id = ?").run(
      status,
      at,
      status,
      at,
      status,
      expiry(x.attribute, now),
      x.id,
    );
    return { ...getVersion(x.id)! };
  };
  const changed: FactVersion[] = [];
  if (decision === "still") {
    d.prepare("update fact_versions set confirmed_at = ?, expires_at = ?, decided_at = ? where id = ?").run(at, expiry(v.attribute, now), at, id);
    emitChange("todos");
    return [getVersion(id)!];
  }
  if (decision === "outdated") changed.push(set(v, "superseded"));
  else if (decision === "old") changed.push(set(v, "rejected"));
  else {
    if (decision === "new") for (const x of currentFacts(v.subject, v.attribute)) if (x.id !== v.id) changed.push(set(x, "superseded"));
    changed.push(set(v, "current"));
  }
  notify(changed, decision);
  emitChange("todos");
  return changed;
}

/** The disputed versions waiting for your word, the oldest first — each with what holds now. */
export function disputes(limit = 100): { version: FactVersion; current: FactVersion[] }[] {
  return (db().prepare("select * from fact_versions where status = 'disputed' order by id limit ?").all(limit) as Row[]).map((r) => {
    const version = toVersion(r);
    return { version, current: currentFacts(version.subject, version.attribute) };
  });
}

/** What happened to a subject's values, for a tooltip: each version with its status, value, source and dates. */
export function historyOf(subject: string, attribute: string): FactVersion[] {
  return versionsOf(subject, attribute).sort((a, b) => b.id - a.id);
}

/** How many new items a day "still true?" brings at most. */
export const STALE_PER_DAY = 5;

/**
 * A few of many a day: `items` (the candidates now) as the queue shows them — those shown before and still
 * there, then new ones while today's count is under `cap` (an item answered today still counts). What was
 * shown before and is no longer a candidate is forgotten from tomorrow on.
 */
export function dailyBatch<T>(kind: string, items: T[], idOf: (t: T) => string, opts: { cap?: number; now?: Date } = {}): T[] {
  const cap = opts.cap ?? STALE_PER_DAY;
  const day = localDay(opts.now ?? new Date());
  const d = db();
  const ids = new Set(items.map(idOf));
  const asked = d.prepare("select item, day from review_batches where kind = ?").all(kind) as { item: string; day: string }[];
  const gone = d.prepare("delete from review_batches where kind = ? and item = ?");
  for (const a of asked) if (a.day < day && !ids.has(a.item)) gone.run(kind, a.item);
  const known = new Set(asked.map((a) => a.item));
  const shown = items.filter((x) => known.has(idOf(x)));
  const today = asked.filter((a) => a.day === day).length;
  const room = Math.max(0, Math.min(cap - shown.length, cap - today));
  const fresh = items.filter((x) => !known.has(idOf(x))).slice(0, room);
  const add = d.prepare("insert or ignore into review_batches (kind, item, day) values (?, ?, ?)");
  for (const x of fresh) add.run(kind, idOf(x), day);
  return [...shown, ...fresh];
}

/** Current values past their time ("still true?") — the longest unconfirmed first, a few a day (dailyBatch). */
export function staleBatch(opts: { cap?: number; now?: Date } = {}): FactVersion[] {
  const now = (opts.now ?? new Date()).toISOString();
  const stale = (db().prepare("select * from fact_versions where status = 'current' and expires_at is not null and expires_at < ? order by expires_at, id limit 500").all(now) as Row[]).map(toVersion);
  return dailyBatch("trust-stale", stale, (v) => String(v.id), opts);
}

/** Where the writer keeps a version ("fact:12") — once it is written. */
export function setTarget(id: number, target: string): void {
  db().prepare("update fact_versions set target = ? where id = ?").run(target.slice(0, 120), id);
}

/** A version's status set without telling its writer (it did it itself: you removed a detail). */
export function setStatus(id: number, status: VersionStatus): void {
  db().prepare("update fact_versions set status = ?, decided_at = ? where id = ?").run(status, new Date().toISOString(), id);
}

