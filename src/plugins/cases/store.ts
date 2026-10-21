import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import type { Case, CaseSource, CaseStatus, CaseSummary } from "./shared";

/**
 * The cases and what they are made of (the Cases plugin): one row per case number, its sources (refs to
 * mails, documents, todos, appointments) in their own table. Server only.
 */

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists cases (id integer primary key autoincrement, key text not null unique, label text not null, status text not null default 'open', person_id integer, note text not null default '', compiled text, created_at text not null, updated_at text not null, last_at text not null);
    create table if not exists case_sources (case_id integer not null references cases(id) on delete cascade, ref text not null, kind text not null, at text not null, title text not null default '', primary key (case_id, ref));
    create index if not exists case_sources_ref on case_sources (ref);
    create table if not exists case_parties (case_id integer not null references cases(id) on delete cascade, role text not null, person_id integer not null, source text not null default 'rule', primary key (case_id, role));
    create index if not exists case_parties_person on case_parties (person_id);
  `);
  // Your corrections of a case's money (total, open, instalment, due): over what the AI sums up — a column added later.
  if (!(d.prepare("pragma table_info(cases)").all() as { name: string }[]).some((c) => c.name === "overrides")) d.exec("alter table cases add column overrides text");
  return d;
}

/** The cases' database (for parties.ts: its tables made). */
export const casesDb = () => db();

const now = () => new Date().toISOString();
const changed = () => emitChange("todos");

type Row = { id: number; key: string; label: string; status: string; person_id: number | null; note: string; compiled: string | null; overrides?: string | null; created_at: string; updated_at: string; last_at: string };

const toCase = (r: Row): Case => ({
  id: r.id,
  key: r.key,
  label: r.label,
  status: r.status === "closed" || r.status === "ignored" ? r.status : "open",
  personId: r.person_id,
  note: r.note,
  compiled: (() => {
    try {
      // What the AI summed up, your corrections over it.
      return r.compiled ? ({ ...(JSON.parse(r.compiled) as CaseSummary), ...(r.overrides ? (JSON.parse(r.overrides) as Partial<CaseSummary>) : {}) } as CaseSummary) : null;
    } catch {
      return null;
    }
  })(),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastAt: r.last_at,
});

/** The cases (not those set aside), the newest activity first. */
export const listCases = (opts: { all?: boolean } = {}): Case[] => (db().prepare(`select * from cases ${opts.all ? "" : "where status != 'ignored'"} order by last_at desc`).all() as Row[]).map(toCase);

export function getCase(id: number): Case | null {
  const r = db().prepare("select * from cases where id = ?").get(id) as Row | undefined;
  return r ? toCase(r) : null;
}

export function caseByKey(key: string): Case | null {
  const r = db().prepare("select * from cases where key = ?").get(key) as Row | undefined;
  return r ? toCase(r) : null;
}

/** A case for this number — the one there is, or a new one. Whether it is new. */
export function ensureCase(key: string, label: string, at: string): { id: number; created: boolean } {
  const had = caseByKey(key);
  if (had) return { id: had.id, created: false };
  const t = now();
  const r = db().prepare("insert into cases (key, label, created_at, updated_at, last_at) values (?, ?, ?, ?, ?)").run(key, label, t, t, at);
  changed();
  return { id: Number(r.lastInsertRowid), created: true };
}

/** A source added to a case (once). Whether it is new — a new one moves its last activity on, and brings a closed case back. */
export function addSource(caseId: number, s: CaseSource, label?: string): boolean {
  const r = db().prepare("insert or ignore into case_sources (case_id, ref, kind, at, title) values (?, ?, ?, ?, ?)").run(caseId, s.ref, s.kind, s.at, s.title.slice(0, 200));
  if (!r.changes) return false;
  const c = getCase(caseId);
  if (c && s.at > c.lastAt) db().prepare("update cases set last_at = ?, label = coalesce(?, label), updated_at = ? where id = ?").run(s.at, label ?? null, now(), caseId);
  if (c?.status === "closed" && s.at > c.updatedAt) db().prepare("update cases set status = 'open', updated_at = ? where id = ?").run(now(), caseId);
  changed();
  return true;
}

export const sourcesOf = (caseId: number): CaseSource[] =>
  (db().prepare("select ref, kind, at, title from case_sources where case_id = ? order by at desc").all(caseId) as { ref: string; kind: CaseSource["kind"]; at: string; title: string }[]).map((r) => ({ ...r }));

/** The cases a source belongs to (a mail, a todo …). */
export const casesOfRef = (ref: string): Case[] => (db().prepare("select c.* from cases c join case_sources s on s.case_id = c.id where s.ref = ? and c.status != 'ignored'").all(ref) as Row[]).map(toCase);

/** The cases of a person — theirs, or one they are a party of (creditor, collector, payee) — the newest activity first. */
export const casesOfPerson = (personId: number): Case[] =>
  (db().prepare("select * from cases where (person_id = ? or id in (select case_id from case_parties where person_id = ?)) and status != 'ignored' order by last_at desc").all(personId, personId) as Row[]).map(toCase);

export function setCaseStatus(id: number, status: CaseStatus): void {
  db().prepare("update cases set status = ?, updated_at = ? where id = ?").run(status, now(), id);
  changed();
}

export function updateCase(id: number, patch: { personId?: number | null; note?: string; label?: string; compiled?: CaseSummary | null }): void {
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, v: unknown) => (sets.push(`${col} = ?`), args.push(v));
  if (patch.personId !== undefined) set("person_id", patch.personId);
  if (patch.note !== undefined) set("note", patch.note.slice(0, 20000));
  if (patch.label !== undefined && patch.label.trim()) set("label", patch.label.trim().slice(0, 120));
  if (patch.compiled !== undefined) set("compiled", patch.compiled ? JSON.stringify(patch.compiled) : null);
  if (!sets.length) return;
  set("updated_at", now());
  db().prepare(`update cases set ${sets.join(", ")} where id = ?`).run(...args, id);
  changed();
}

export type MoneyOverrides = Partial<Pick<CaseSummary, "total" | "open" | "installment" | "nextDue">>;

/** Your corrections of a case's money: a value set, or (null) taken back — the AI's again. */
export function setOverrides(id: number, patch: { [K in keyof MoneyOverrides]?: MoneyOverrides[K] | null }): void {
  const r = db().prepare("select overrides from cases where id = ?").get(id) as { overrides: string | null } | undefined;
  if (!r) return;
  const cur = (() => {
    try {
      return r.overrides ? (JSON.parse(r.overrides) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  })();
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete cur[k];
    else if (v !== undefined) cur[k] = v;
  }
  db().prepare("update cases set overrides = ?, updated_at = ? where id = ?").run(Object.keys(cur).length ? JSON.stringify(cur) : null, now(), id);
  changed();
}

/** A person merged into another: their cases go along. */
export function movePersonCases(from: number, to: number): void {
  db().prepare("update cases set person_id = ? where person_id = ?").run(to, from);
  db().prepare("update case_parties set person_id = ? where person_id = ?").run(to, from);
}
