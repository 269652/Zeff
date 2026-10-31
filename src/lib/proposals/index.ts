import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { recordFeedback, type Feedback } from "@/lib/learning/ledger";
import { proposalSources, type Proposal, type ProposalOutcome, type ProposalSource, type ProposalStatus, type ProposalVerdict } from "./point";

/**
 * The proposals store (server only): one table for everything Zeff proposes and you accept or dismiss. `propose()` puts one in
 * — once per source and input hash: one still open gets the evidence of now, one dismissed is never made again; `decide()`
 * runs the source's handler (./point) and writes the learning ledger, every time. Putting in and expiring tell no page (the
 * proposing place does, once per run); a decision does. Each place keeps what it knows of its own
 * (people, entities, the calendar) — only the proposal, its state and the decision are here.
 */

export type { Proposal, ProposalEntry, ProposalOutcome, ProposalSource, ProposalStatus, ProposalVerdict } from "./point";
export { proposalSources } from "./point";

const ready = new WeakSet<Database.Database>();

/** The proposals table (made on first use, per account). */
export function proposalsDb(): Database.Database {
  const d = getSqlite();
  if (ready.has(d)) return d;
  d.exec(`
    create table if not exists proposals (id integer primary key autoincrement, source text not null, kind text not null default '', subject_ref text not null default '', payload text not null default '{}', why text not null default '', confidence real, evidence_refs text not null default '[]', status text not null default 'open', input_hash text not null, created_at text not null, updated_at text not null, decided_at text, unique (source, input_hash));
    create index if not exists proposals_status on proposals (status, source);
    create index if not exists proposals_subject on proposals (source, subject_ref);
  `);
  ready.add(d);
  return d;
}

const now = () => new Date().toISOString();
const STATUSES: ProposalStatus[] = ["open", "accepted", "dismissed", "expired"];

type Raw = { id: number; source: string; kind: string; subject_ref: string; payload: string; why: string; confidence: number | null; evidence_refs: string; status: string; input_hash: string; created_at: string; updated_at: string; decided_at: string | null };

const parse = <T>(s: string, fallback: T): T => {
  try {
    return (JSON.parse(s) as T) ?? fallback;
  } catch {
    return fallback;
  }
};

const toProposal = (r: Raw): Proposal => ({
  id: r.id,
  source: r.source,
  kind: r.kind,
  subjectRef: r.subject_ref,
  payload: parse<Record<string, unknown>>(r.payload, {}),
  why: r.why,
  confidence: r.confidence,
  evidenceRefs: parse<string[]>(r.evidence_refs, []),
  status: (STATUSES.includes(r.status as ProposalStatus) ? r.status : "open") as ProposalStatus,
  inputHash: r.input_hash,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  decidedAt: r.decided_at,
});

/** A short hash of what a proposal was made from (its parts joined). */
export const inputHashOf = (...parts: unknown[]): string => createHash("sha1").update(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p ?? null))).join("\u0000")).digest("hex").slice(0, 32);

export type ProposalInput<P = Record<string, unknown>> = {
  source: string;
  inputHash: string;
  kind?: string;
  subjectRef?: string;
  payload?: P;
  why?: string;
  confidence?: number | null;
  evidenceRefs?: string[];
  /** One that expired (its occasion went) is opened again when it comes again — by default it stays expired. */
  reopen?: boolean;
};

const clamp = (c: number | null | undefined) => (c == null || !Number.isFinite(c) ? null : Math.max(0, Math.min(1, c)));

/**
 * A proposal put in: new — or the one with its source and hash: still open, it gets what is said now (why, payload, confidence);
 * decided (accepted, dismissed), it stays as it is — never proposed again; expired, opened again only with `reopen`.
 */
export function propose<P = Record<string, unknown>>(p: ProposalInput<P>): { id: number; created: boolean; status: ProposalStatus } {
  const d = proposalsDb();
  const at = now();
  const fields = [p.kind ?? "", p.subjectRef ?? "", JSON.stringify(p.payload ?? {}), (p.why ?? "").slice(0, 500), clamp(p.confidence), JSON.stringify((p.evidenceRefs ?? []).slice(0, 20))];
  const r = d
    .prepare("insert or ignore into proposals (source, kind, subject_ref, payload, why, confidence, evidence_refs, status, input_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)")
    .run(p.source, ...fields, p.inputHash, at, at);
  if (r.changes) return { id: Number(r.lastInsertRowid), created: true, status: "open" };
  const old = d.prepare("select id, status from proposals where source = ? and input_hash = ?").get(p.source, p.inputHash) as { id: number; status: ProposalStatus };
  if (old.status === "open" || (old.status === "expired" && p.reopen)) {
    d.prepare("update proposals set kind = ?, subject_ref = ?, payload = ?, why = ?, confidence = ?, evidence_refs = ?, status = 'open', decided_at = null, updated_at = ? where id = ?").run(...fields, at, old.id);
    return { id: old.id, created: false, status: "open" };
  }
  return { id: old.id, created: false, status: old.status };
}

/**
 * Proposals of before (a place's own table) taken over as they were — status, times — once per source and hash, whatever is
 * there already. How many were new.
 */
export function adoptProposals(rows: (ProposalInput & { status: ProposalStatus; createdAt: string; decidedAt?: string | null })[]): number {
  const d = proposalsDb();
  const put = d.prepare(
    "insert or ignore into proposals (source, kind, subject_ref, payload, why, confidence, evidence_refs, status, input_hash, created_at, updated_at, decided_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  let n = 0;
  d.transaction(() => {
    for (const p of rows) {
      n += put.run(p.source, p.kind ?? "", p.subjectRef ?? "", JSON.stringify(p.payload ?? {}), (p.why ?? "").slice(0, 500), clamp(p.confidence), JSON.stringify(p.evidenceRefs ?? []), p.status, p.inputHash, p.createdAt, p.decidedAt ?? p.createdAt, p.decidedAt ?? null).changes;
    }
  })();
  return n;
}

export function getProposal(id: number): Proposal | null {
  const r = proposalsDb().prepare("select * from proposals where id = ?").get(id) as Raw | undefined;
  return r ? toProposal(r) : null;
}

/** The one of a source made from this hash (whatever became of it). */
export function proposalByHash(source: string, inputHash: string): Proposal | null {
  const r = proposalsDb().prepare("select * from proposals where source = ? and input_hash = ?").get(source, inputHash) as Raw | undefined;
  return r ? toProposal(r) : null;
}

/** A source's open proposals (or all sources'), the surest first — about one subject only, or those whose subject starts so. */
export function openProposals(source?: string, opts: { subjectRef?: string; subjectPrefix?: string } = {}): Proposal[] {
  const where = ["status = 'open'"];
  const args: unknown[] = [];
  if (source) {
    where.push("source = ?");
    args.push(source);
  }
  if (opts.subjectRef !== undefined) {
    where.push("subject_ref = ?");
    args.push(opts.subjectRef);
  }
  if (opts.subjectPrefix) {
    where.push("substr(subject_ref, 1, ?) = ?");
    args.push(opts.subjectPrefix.length, opts.subjectPrefix);
  }
  const sql = `select * from proposals where ${where.join(" and ")} order by coalesce(confidence, 0.5) desc, id`;
  return (proposalsDb().prepare(sql).all(...args) as Raw[]).map(toProposal);
}

/** Open ones whose occasion went (the thing is gone, a run no longer makes them): expired, not decided. How many. */
export function expireProposals(ids: number[]): number {
  if (!ids.length) return 0;
  const d = proposalsDb();
  const at = now();
  const st = d.prepare("update proposals set status = 'expired', decided_at = ?, updated_at = ? where id = ? and status = 'open'");
  let n = 0;
  d.transaction(() => {
    for (const id of ids) n += st.run(at, at, id).changes;
  })();
  return n;
}

/** The registered sources of the installed plugins. */
export async function proposalSourceList(): Promise<(ProposalSource & { plugin: string })[]> {
  await import("@/plugins/contributions");
  return proposalSources.list().flatMap((c) => c.impl.map((s) => ({ ...s, plugin: c.plugin })));
}

const deciding = new Set<number>();

/**
 * Your word on a proposal: its source's handler run (apply on accept, dismiss on dismiss), then its state set and the learning
 * ledger written — always, whichever place the button was in. Throws when it isn't open any more, its source isn't there, or
 * the handler can't (then nothing is decided).
 */
export async function decide(id: number, verdict: ProposalVerdict): Promise<{ proposal: Proposal; message?: string; ref?: string }> {
  if (verdict !== "accepted" && verdict !== "dismissed") throw new Error(t("Unknown action: {action}", { action: String(verdict) }));
  const p = getProposal(Number(id));
  if (!p) throw new Error(t("This proposal isn't there any more."));
  if (p.status !== "open" || deciding.has(p.id)) throw new Error(t("This proposal was decided already."));
  const src = (await proposalSourceList()).find((s) => s.id === p.source);
  if (!src) throw new Error(t("Nothing handles proposals of {source} — is its plugin installed?", { source: p.source }));
  deciding.add(p.id);
  try {
    const out: ProposalOutcome = verdict === "accepted" ? await src.apply(p) : await src.dismiss?.(p);
    const at = now();
    proposalsDb().prepare("update proposals set status = ?, decided_at = ?, updated_at = ? where id = ?").run(verdict, at, at, p.id);
    const base: Feedback = {
      step: src.step ?? src.id,
      itemRef: `proposal:${p.id}`,
      verdict: verdict === "accepted" ? "accepted" : "rejected",
      at,
      sourceRef: p.evidenceRefs[0] ?? null,
      kind: p.kind || null,
      detail: { text: p.why, subjectRef: p.subjectRef, confidence: p.confidence, proposalId: p.id },
      key: `proposal:${p.id}`,
    };
    recordFeedback({ ...base, ...(src.feedback?.(p, verdict) ?? {}) });
    emitChange("todos");
    return { proposal: { ...p, status: verdict, decidedAt: at }, ...(out ?? {}) };
  } finally {
    deciding.delete(p.id);
  }
}
