/**
 * What Zeff knows about people, as structure (the People plugin): claims (a fact, a role, a commitment)
 * and links (a person to a ticket, a repo, a topic, another person — typed: reports-to, works-with,
 * on-ticket, owns, decides …). Each carries where it came from, how sure it is and whether you
 * confirmed it; derived by rules (no AI) from what the sources list, and by the AI from new messages
 * (extract.ts). Facts that go stale expire and come back to be checked. Server only.
 */
import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { getPerson, listPeople, namesOf } from "./store";

export const CLAIM_KINDS = ["fact", "role", "owns", "preference", "commitment"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export const LINK_TYPES = ["reports-to", "manages", "works-with", "decides", "owns", "on-ticket", "commented-on", "authored", "active-in", "knows-about"] as const;
export type LinkType = (typeof LINK_TYPES)[number];
export const TARGET_TYPES = ["person", "ticket", "repo", "project", "topic"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];
export type Status = "proposed" | "confirmed" | "rejected";

/** A claim of this kind is a snapshot that ages: it is asked about again after this many days. */
const SHELF_LIFE: Partial<Record<ClaimKind, number>> = { role: 120, owns: 120, commitment: 45 };
/** A rule-derived link not seen again for this long lapses. */
const LINK_LAPSE_DAYS = 90;
/** The AI's claims at this confidence and above show on the person's card (marked) before you confirm them. */
export const SHOW_FROM = 0.8;

export type Claim = {
  id: number;
  personId: number;
  kind: ClaimKind;
  text: string;
  evidence: string;
  /** Where it was read: "mail:<key>", "teams:<key>", "jira:<id>". */
  sourceRef: string;
  confidence: number;
  status: Status;
  /** Commitments: who owes — "theirs" (they promised me) or "mine" (I promised them). */
  direction: "theirs" | "mine" | "";
  due: string;
  doneAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  /** When it should be checked again (null: never). */
  expiresAt: string | null;
};

export type Link = {
  id: number;
  personId: number;
  rel: LinkType;
  targetType: TargetType;
  /** The ticket key, repo, topic — or the other person's id. */
  targetRef: string;
  label: string;
  evidence: string;
  source: "rule" | "ai" | "manual";
  sourceRef: string;
  confidence: number;
  status: Status;
  createdAt: string;
  confirmedAt: string | null;
  seenAt: string;
};

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists people_claims (id integer primary key autoincrement, person_id integer not null references people(id) on delete cascade, kind text not null default 'fact', text text not null, evidence text not null default '', source_ref text not null default '', confidence real not null default 0.7, status text not null default 'proposed', direction text not null default '', due text not null default '', done_at text, created_at text not null, confirmed_at text, expires_at text, unique (person_id, kind, text));
    create index if not exists people_claims_person on people_claims (person_id);
    create table if not exists people_links (id integer primary key autoincrement, person_id integer not null references people(id) on delete cascade, rel text not null, target_type text not null, target_ref text not null, label text not null default '', evidence text not null default '', source text not null default 'ai', source_ref text not null default '', confidence real not null default 0.7, status text not null default 'proposed', created_at text not null, confirmed_at text, seen_at text not null, unique (person_id, rel, target_type, target_ref));
    create index if not exists people_links_target on people_links (target_type, target_ref);
  `);
  return d;
}

const now = () => new Date().toISOString();
const days = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
const changed = () => emitChange("todos");
const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

type CRow = { id: number; person_id: number; kind: string; text: string; evidence: string; source_ref: string; confidence: number; status: string; direction: string; due: string; done_at: string | null; created_at: string; confirmed_at: string | null; expires_at: string | null };
type LRow = { id: number; person_id: number; rel: string; target_type: string; target_ref: string; label: string; evidence: string; source: string; source_ref: string; confidence: number; status: string; created_at: string; confirmed_at: string | null; seen_at: string };

const status = (v: string): Status => (v === "confirmed" || v === "rejected" ? v : "proposed");
const toClaim = (r: CRow): Claim => ({
  id: r.id,
  personId: r.person_id,
  kind: (CLAIM_KINDS as readonly string[]).includes(r.kind) ? (r.kind as ClaimKind) : "fact",
  text: r.text,
  evidence: r.evidence,
  sourceRef: r.source_ref,
  confidence: r.confidence,
  status: status(r.status),
  direction: r.direction === "theirs" || r.direction === "mine" ? r.direction : "",
  due: r.due,
  doneAt: r.done_at,
  createdAt: r.created_at,
  confirmedAt: r.confirmed_at,
  expiresAt: r.expires_at,
});
const toLink = (r: LRow): Link => ({
  id: r.id,
  personId: r.person_id,
  rel: (LINK_TYPES as readonly string[]).includes(r.rel) ? (r.rel as LinkType) : "knows-about",
  targetType: (TARGET_TYPES as readonly string[]).includes(r.target_type) ? (r.target_type as TargetType) : "topic",
  targetRef: r.target_ref,
  label: r.label,
  evidence: r.evidence,
  source: r.source === "rule" || r.source === "manual" ? r.source : "ai",
  sourceRef: r.source_ref,
  confidence: r.confidence,
  status: status(r.status),
  createdAt: r.created_at,
  confirmedAt: r.confirmed_at,
  seenAt: r.seen_at,
});

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export type ClaimInput = { personId: number; kind: ClaimKind; text: string; evidence?: string; sourceRef?: string; confidence?: number; status?: Status; direction?: Claim["direction"]; due?: string };

/** A claim kept — the same (person, kind, text) once, whatever became of it (a rejected one stays rejected). Whether it is new. */
export function addClaim(v: ClaimInput): boolean {
  const text = clip(v.text, 300);
  if (!text || !getPerson(v.personId)) return false;
  const confirmed = v.status === "confirmed";
  const shelf = SHELF_LIFE[v.kind];
  const r = db()
    .prepare("insert or ignore into people_claims (person_id, kind, text, evidence, source_ref, confidence, status, direction, due, created_at, confirmed_at, expires_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(v.personId, v.kind, text, clip(v.evidence, 300), clip(v.sourceRef, 120), Math.max(0, Math.min(1, v.confidence ?? 0.7)), v.status ?? "proposed", v.direction ?? "", clip(v.due, 10), now(), confirmed ? now() : null, shelf ? days(shelf) : null);
  if (r.changes) changed();
  return r.changes > 0;
}

export const claimsOf = (personId: number, opts: { status?: Status[] } = {}): Claim[] => {
  const want = opts.status ?? ["proposed", "confirmed"];
  return (db().prepare(`select * from people_claims where person_id = ? and status in (${want.map(() => "?").join(",")}) order by status = 'confirmed' desc, confidence desc, id desc`).all(personId, ...want) as CRow[]).map(toClaim);
};

/** What a card shows: confirmed claims, and the AI's sure ones not yet confirmed; commitments only while open. */
export const visibleClaims = (personId: number): Claim[] => claimsOf(personId).filter((c) => (c.status === "confirmed" || c.confidence >= SHOW_FROM) && !(c.kind === "commitment" && c.doneAt));

export const proposedClaims = (): (Claim & { personName: string })[] =>
  (db().prepare("select c.*, p.name person_name from people_claims c join people p on p.id = c.person_id where c.status = 'proposed' order by c.confidence desc, c.id desc limit 200").all() as (CRow & { person_name: string })[]).map((r) => ({ ...toClaim(r), personName: r.person_name }));

/** Confirmed claims whose time is up — "still true?" — the oldest first. */
export const staleClaims = (): (Claim & { personName: string })[] =>
  (db().prepare("select c.*, p.name person_name from people_claims c join people p on p.id = c.person_id where c.status = 'confirmed' and c.expires_at is not null and c.expires_at < ? and c.done_at is null order by c.expires_at limit 100").all(now()) as (CRow & { person_name: string })[]).map((r) => ({ ...toClaim(r), personName: r.person_name }));

/** Open commitments of everyone — the ones I owe first, then by due date. */
export const openCommitments = (): (Claim & { personName: string })[] =>
  (db().prepare("select c.*, p.name person_name from people_claims c join people p on p.id = c.person_id where c.kind = 'commitment' and c.done_at is null and c.status != 'rejected' and (c.status = 'confirmed' or c.confidence >= ?) order by c.direction = 'mine' desc, c.due = '', c.due, c.id").all(SHOW_FROM) as (CRow & { person_name: string })[]).map((r) => ({ ...toClaim(r), personName: r.person_name }));

export function reviewClaim(id: number, op: "confirm" | "reject" | "done" | "recheck"): void {
  const d = db();
  const row = d.prepare("select kind from people_claims where id = ?").get(id) as { kind: string } | undefined;
  if (!row) return;
  const shelf = SHELF_LIFE[row.kind as ClaimKind];
  if (op === "confirm") d.prepare("update people_claims set status = 'confirmed', confirmed_at = ?, expires_at = ? where id = ?").run(now(), shelf ? days(shelf) : null, id);
  else if (op === "recheck") d.prepare("update people_claims set confirmed_at = ?, expires_at = ? where id = ?").run(now(), days(shelf ?? 120), id);
  else if (op === "done") d.prepare("update people_claims set done_at = ? where id = ?").run(now(), id);
  else d.prepare("update people_claims set status = 'rejected' where id = ?").run(id);
  changed();
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export type LinkInput = { personId: number; rel: LinkType; targetType: TargetType; targetRef: string; label?: string; evidence?: string; source?: Link["source"]; sourceRef?: string; confidence?: number; status?: Status };

/** A link kept — once per (person, type, target); seen again, it is marked so (a rule-derived one stays alive). Whether it is new. */
export function addLink(v: LinkInput): boolean {
  const ref = clip(v.targetRef, 200);
  if (!ref || !getPerson(v.personId) || (v.targetType === "person" && (!getPerson(Number(ref)) || Number(ref) === v.personId))) return false;
  const d = db();
  const confirmed = v.status === "confirmed";
  const r = d
    .prepare("insert or ignore into people_links (person_id, rel, target_type, target_ref, label, evidence, source, source_ref, confidence, status, created_at, confirmed_at, seen_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(v.personId, v.rel, v.targetType, ref, clip(v.label, 160), clip(v.evidence, 300), v.source ?? "ai", clip(v.sourceRef, 120), Math.max(0, Math.min(1, v.confidence ?? 0.7)), v.status ?? "proposed", now(), confirmed ? now() : null, now());
  if (r.changes) changed();
  else d.prepare("update people_links set seen_at = ? where person_id = ? and rel = ? and target_type = ? and target_ref = ?").run(now(), v.personId, v.rel, v.targetType, ref);
  return r.changes > 0;
}

const live = `status != 'rejected' and (source != 'rule' or seen_at >= ?)`;
const lapse = () => days(-LINK_LAPSE_DAYS);

/** A person's links: confirmed and the sure ones, the surest first. */
export const linksOf = (personId: number): Link[] => (db().prepare(`select * from people_links where person_id = ? and ${live} and (status = 'confirmed' or confidence >= ?) order by status = 'confirmed' desc, confidence desc, seen_at desc`).all(personId, lapse(), SHOW_FROM) as LRow[]).map(toLink);

/** Who is linked to a ticket, repo, project or topic (a topic: its words found in the target). */
export function linksTo(targetType: TargetType, targetRef: string): Link[] {
  const rows = db().prepare(`select * from people_links where target_type = ? and ${live} and (status = 'confirmed' or confidence >= ?)`).all(targetType, lapse(), SHOW_FROM) as LRow[];
  const want = targetRef.trim().toLowerCase();
  return rows.map(toLink).filter((l) => (targetType === "topic" ? l.targetRef.toLowerCase().includes(want) || want.includes(l.targetRef.toLowerCase()) : l.targetRef.toLowerCase() === want));
}

export const proposedLinks = (): (Link & { personName: string })[] =>
  (db().prepare("select l.*, p.name person_name from people_links l join people p on p.id = l.person_id where l.status = 'proposed' and l.source = 'ai' order by l.confidence desc, l.id desc limit 200").all() as (LRow & { person_name: string })[]).map((r) => ({ ...toLink(r), personName: r.person_name }));

export function reviewLink(id: number, op: "confirm" | "reject"): void {
  db().prepare("update people_links set status = ?, confirmed_at = ? where id = ?").run(op === "confirm" ? "confirmed" : "rejected", op === "confirm" ? now() : null, id);
  changed();
}

// ---------------------------------------------------------------------------
// Links from the sources themselves — no AI
// ---------------------------------------------------------------------------

/**
 * Who is on which ticket, who commented, who wrote what in GitLab, where in Teams they write: read from what the
 * syncs already keep, as confirmed links from the "rule" source. Seen again each run, a link stays alive;
 * one not seen for 90 days lapses. How many were new.
 */
export function deriveLinks(): number {
  const d = getSqlite();
  const people = listPeople();
  if (!people.length) return 0;
  const byName = new Map<string, number>();
  const clash = new Set<string>();
  for (const p of people) {
    for (const n of namesOf(p).map((x) => x.toLowerCase())) {
      if (byName.has(n) && byName.get(n) !== p.id) clash.add(n);
      byName.set(n, p.id);
    }
    for (const a of p.accounts) byName.set(a.value.toLowerCase(), p.id);
  }
  for (const n of clash) byName.delete(n);
  let added = 0;
  const link = (name: string | null | undefined, rel: LinkType, targetType: TargetType, ref: string, label: string, evidence: string, sourceRef: string) => {
    const id = byName.get((name ?? "").trim().toLowerCase());
    if (id && addLink({ personId: id, rel, targetType, targetRef: ref, label, evidence, source: "rule", sourceRef, confidence: 0.95, status: "confirmed" })) added++;
  };
  const all = <T>(sql: string): T[] => {
    try {
      return d.prepare(sql).all() as T[];
    } catch {
      return [];
    }
  };
  // The tickets as the briefing lists them: "Name (username)".
  for (const run of all<{ tickets: string }>("select tickets from board_runs where status = 'ok' order by id desc limit 6")) {
    try {
      for (const t of JSON.parse(run.tickets) as { key: string; summary?: string; people?: string[] }[]) {
        for (const p of t.people ?? []) {
          const m = /^(.+?) \(([^()]+)\)$/.exec(p.trim());
          link(m?.[2] ?? p, "on-ticket", "ticket", t.key, t.summary ?? "", `listed on ${t.key}`, `jira:${t.key}`);
          if (m) link(m[1], "on-ticket", "ticket", t.key, t.summary ?? "", `listed on ${t.key}`, `jira:${t.key}`);
        }
      }
    } catch {
      // not readable
    }
  }
  for (const c of all<{ ticket: string; author: string; id: string }>("select ticket, author, max(id) id from jira_comments where author != '' group by ticket, author")) link(c.author, "commented-on", "ticket", c.ticket, "", `commented on ${c.ticket}`, `jira:${c.id}`);
  for (const g of all<{ ref: string; title: string; author: string }>("select ref, title, author from gitlab_items where author is not null")) link(g.author, "authored", "repo", g.ref.replace(/[!#]\d+$/, ""), "", `wrote ${g.ref}: ${g.title}`.slice(0, 200), `gitlab:${g.ref}`);
  for (const t of all<{ sender_name: string; place: string; n: number }>("select sender_name, place, count(*) n from teams_messages where sender_name is not null and place is not null group by sender_name, place having n >= 3")) link(t.sender_name, "active-in", "topic", t.place, "", `${t.n} messages in ${t.place}`, "teams");
  return added;
}

// ---------------------------------------------------------------------------
// Who knows
// ---------------------------------------------------------------------------

export type Expert = { personId: number; name: string; score: number; why: string[] };

/** The ticket keys named in a text. */
export const ticketKeys = (text: string): string[] => [...new Set(text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [])];

/**
 * Who to ask about a text (a note, a todo): people linked to the tickets it names, to topics it mentions, and
 * with confirmed claims that share its words — the surest first. `text`'s own tagged people are left to the caller.
 */
export function whoKnows(text: string, opts: { ticket?: string; limit?: number } = {}): Expert[] {
  const score = new Map<number, Expert>();
  const add = (personId: number, name: string, points: number, why: string) => {
    const e = score.get(personId) ?? { personId, name, score: 0, why: [] };
    e.score += points;
    if (!e.why.includes(why)) e.why.push(why);
    score.set(personId, e);
  };
  const nameOf = (id: number) => getPerson(id)?.name ?? "?";
  for (const key of new Set([...ticketKeys(text), ...(opts.ticket ? [opts.ticket] : [])])) {
    for (const l of linksTo("ticket", key)) add(l.personId, nameOf(l.personId), l.rel === "on-ticket" ? 3 : 2, `${key}: ${l.rel.replace("-", " ")}`);
  }
  const lower = text.toLowerCase();
  const words = [...new Set(lower.match(/[\p{L}\p{N}]{4,}/gu) ?? [])];
  // A topic is in the text as a word of its own (short ones too: "QA"), or one of the text's long words is in it.
  const escaped = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const topicIn = (t: string) => (t.length >= 2 && new RegExp(String.raw`(^|[^\p{L}\p{N}])${escaped(t)}($|[^\p{L}\p{N}])`, "u").test(lower)) || words.some((w) => t.includes(w));
  const rows = db().prepare(`select * from people_links where target_type in ('topic', 'repo', 'project') and ${live} and (status = 'confirmed' or confidence >= ?)`).all(lapse(), SHOW_FROM) as LRow[];
  for (const l of rows.map(toLink)) {
    const t = l.targetRef.toLowerCase();
    if (topicIn(t)) add(l.personId, nameOf(l.personId), 2, `${l.targetRef}`);
  }
  for (const c of db().prepare("select * from people_claims where status != 'rejected' and kind in ('role','owns','fact') and (status = 'confirmed' or confidence >= ?)").all(SHOW_FROM) as CRow[]) {
    const t = c.text.toLowerCase();
    const hit = words.filter((w) => t.includes(w));
    if (hit.length) add(c.person_id, nameOf(c.person_id), Math.min(3, hit.length) * (c.kind === "fact" ? 0.6 : 1), clip(c.text, 80));
  }
  return [...score.values()].sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 5);
}

// ---------------------------------------------------------------------------
// How good the extraction is — from your reviews
// ---------------------------------------------------------------------------

/** Of the AI's proposals you decided: how many you confirmed. */
export function extractionQuality(): { claims: { confirmed: number; rejected: number }; links: { confirmed: number; rejected: number } } {
  const d = db();
  const n = (table: string, st: string, extra = "") => (d.prepare(`select count(*) n from ${table} where status = ? ${extra}`).get(st) as { n: number }).n;
  return { claims: { confirmed: n("people_claims", "confirmed"), rejected: n("people_claims", "rejected") }, links: { confirmed: n("people_links", "confirmed", "and source = 'ai'"), rejected: n("people_links", "rejected", "and source = 'ai'") } };
}

/** What you rejected lately — told to the AI so it doesn't propose it again. */
export function rejectedExamples(limit = 25): { claims: string[]; links: string[] } {
  const d = db();
  return {
    claims: (d.prepare("select p.name, c.text from people_claims c join people p on p.id = c.person_id where c.status = 'rejected' order by c.id desc limit ?").all(limit) as { name: string; text: string }[]).map((r) => `${r.name}: ${r.text}`),
    links: (d.prepare("select p.name, l.rel, l.target_ref from people_links l join people p on p.id = l.person_id where l.status = 'rejected' and l.source = 'ai' order by l.id desc limit ?").all(limit) as { name: string; rel: string; target_ref: string }[]).map((r) => `${r.name} ${r.rel} ${r.target_ref}`),
  };
}
