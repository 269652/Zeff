import type Database from "better-sqlite3";
import { getSqlite } from "@/db";

/**
 * The feedback ledger: one row per decision of yours on something an AI step proposed — a booking suggestion taken
 * over or skipped, a todo of the mail review done or dropped, a name accepted as someone's, a claim rejected, an AI
 * field corrected by hand. Each place keeps its own state as before; the ledger is what they have in common, so the
 * quality page can say which step is useful and which is noise, and repetition can become a rule you confirm.
 *
 * A decision that is a status somewhere (a claim's, a todo event's) carries a `key` naming it ("people-claim:28:rejected"):
 * the live hook and the backfill write the same key, so nothing is counted twice. Recording never throws — a ledger
 * that fails must not break what you did.
 */

export type Verdict = "accepted" | "rejected" | "edited" | "ignored";
export const VERDICTS: Verdict[] = ["accepted", "rejected", "edited", "ignored"];

/** The AI steps the ledger knows by name (others may come; a step is any short id). */
export const STEPS = {
  booking: "booking",
  mailReview: "mail-review",
  noteReview: "note-review",
  documentReview: "document-review",
  lage: "lage",
  workers: "workers",
  autoActions: "auto-actions",
  peopleIdentity: "people-identity",
  peopleClaim: "people-claim",
  peopleLink: "people-link",
  peopleDate: "people-date",
  knowledgeRelation: "knowledge-relation",
  wsAiFilter: "ws-ai-filter",
  wsAiField: "ws-ai-field",
  todoDone: "todo-done",
} as const;

export type Feedback = {
  step: string;
  /** What was judged: "todo:12", "entry:S-5", "people-claim:28" … */
  itemRef: string;
  verdict: Verdict;
  /** When you decided (ISO; default now). */
  at?: string;
  /** What the AI read to propose it: "mail:<key>", "doc:<id>" … */
  sourceRef?: string | null;
  /** Who it came from (a sender's address, lowercase) — for the patterns. */
  sender?: string | null;
  /** Its kind, as the step tells them apart (a mail subject's stem, a claim's kind …) — for the patterns. */
  kind?: string | null;
  /** Anything else worth keeping: the text, the quote, mustDo … */
  detail?: Record<string, unknown>;
  /** The decision's own name, when it is a status somewhere — written once, whoever writes it first. */
  key?: string | null;
};

export type FeedbackRow = {
  id: number;
  at: string;
  step: string;
  itemRef: string;
  verdict: Verdict;
  sourceRef: string | null;
  sender: string | null;
  kind: string | null;
  detail: Record<string, unknown>;
  key: string | null;
};

const ready = new WeakSet<Database.Database>();

/** The ledger's tables (made on first use). */
export function ledgerDb(): Database.Database {
  const d = getSqlite();
  if (ready.has(d)) return d;
  d.exec(`
    create table if not exists ai_feedback (id integer primary key autoincrement, at text not null, step text not null, item_ref text not null, verdict text not null, source_ref text, sender text, kind text, detail text not null default '{}', key text unique);
    create index if not exists ai_feedback_step_at on ai_feedback (step, at);
    create index if not exists ai_feedback_pattern on ai_feedback (step, sender, kind);
    create table if not exists ai_feedback_rules (id integer primary key autoincrement, step text not null, sender text not null, kind text not null, status text not null default 'proposed', evidence text not null default '[]', created_at text not null, decided_at text, unique (step, sender, kind));
  `);
  ready.add(d);
  return d;
}

const clip = (s: string | null | undefined, n: number) => (s == null ? null : String(s).trim().slice(0, n) || null);

/** A decision of yours on something an AI step proposed. Whether it was new (a known key: not again). Never throws. */
export function recordFeedback(f: Feedback): boolean {
  try {
    if (!f.step || !f.itemRef || !VERDICTS.includes(f.verdict)) return false;
    const r = ledgerDb()
      .prepare(`insert or ignore into ai_feedback (at, step, item_ref, verdict, source_ref, sender, kind, detail, key) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        f.at ?? new Date().toISOString(),
        f.step,
        f.itemRef,
        f.verdict,
        clip(f.sourceRef, 300),
        clip(f.sender?.toLowerCase(), 200),
        clip(f.kind, 200),
        JSON.stringify(f.detail ?? {}),
        f.key ?? null,
      );
    return r.changes > 0;
  } catch (err) {
    console.error("[ai-feedback]", err);
    return false;
  }
}

type Raw = { id: number; at: string; step: string; item_ref: string; verdict: Verdict; source_ref: string | null; sender: string | null; kind: string | null; detail: string; key: string | null };

const row = (r: Raw): FeedbackRow => {
  let detail: Record<string, unknown> = {};
  try {
    detail = JSON.parse(r.detail) ?? {};
  } catch {
    // kept as nothing
  }
  return { id: r.id, at: r.at, step: r.step, itemRef: r.item_ref, verdict: r.verdict, sourceRef: r.source_ref, sender: r.sender, kind: r.kind, detail, key: r.key };
};

/** The decisions since a time (ISO; null: all), the newest first — optionally of one step. */
export function listFeedback(opts: { since?: string | null; step?: string; limit?: number } = {}): FeedbackRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.since) {
    where.push("at >= ?");
    args.push(opts.since);
  }
  if (opts.step) {
    where.push("step = ?");
    args.push(opts.step);
  }
  const sql = `select * from ai_feedback ${where.length ? `where ${where.join(" and ")}` : ""} order by at desc, id desc limit ?`;
  return (ledgerDb().prepare(sql).all(...args, opts.limit ?? 50000) as Raw[]).map(row);
}
