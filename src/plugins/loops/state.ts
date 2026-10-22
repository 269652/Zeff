/**
 * What became of each open loop (the loops plugin): closed (by its source, the AI or you) with what closed it, dismissed (not a
 * loop), a proposal to close it (by rule or the AI), the closings you took back (not proposed or made again), "later" for the Today page. The
 * loops themselves stay where they are — the People plugin's commitment claims, the messages the rules read; this is their state
 * by ref. Server only.
 */
import type Database from "better-sqlite3";
import { getSqlite } from "@/db";
import type { ClosedBy, Loop, LoopState } from "./shared";

export type StateRow = {
  ref: string;
  state: LoopState;
  closedBy: ClosedBy | null;
  closeRef: string;
  closeQuote: string;
  closedAt: string | null;
  proposal: { ref: string; quote: string; href: string; at: string; by: "rule" | "ai" } | null;
  /** Closings (their refs) you took back or rejected: never made or proposed again. */
  rejected: string[];
  snoozeUntil: string | null;
  /** The loop as it was when decided (a rule's loop is gone from the source once answered). */
  snapshot: Partial<Loop>;
  updatedAt: string;
};

const ready = new WeakSet<Database.Database>();

function db(): Database.Database {
  const d = getSqlite();
  if (ready.has(d)) return d;
  d.exec(`create table if not exists loops_state (ref text primary key, state text not null default 'open', closed_by text, close_ref text not null default '', close_quote text not null default '', closed_at text, proposal_ref text, proposal_quote text, proposal_href text, proposal_at text, proposal_by text, rejected text not null default '[]', snooze_until text, snapshot text not null default '{}', updated_at text not null)`);
  ready.add(d);
  return d;
}

type Raw = { ref: string; state: string; closed_by: string | null; close_ref: string; close_quote: string; closed_at: string | null; proposal_ref: string | null; proposal_quote: string | null; proposal_href: string | null; proposal_at: string | null; proposal_by: string | null; rejected: string; snooze_until: string | null; snapshot: string; updated_at: string };

const parse = <T>(s: string, fallback: T): T => {
  try {
    return (JSON.parse(s) as T) ?? fallback;
  } catch {
    return fallback;
  }
};

const toRow = (r: Raw): StateRow => ({
  ref: r.ref,
  state: r.state === "closed" || r.state === "dismissed" ? r.state : "open",
  closedBy: r.closed_by === "rule" || r.closed_by === "ai" || r.closed_by === "you" ? r.closed_by : null,
  closeRef: r.close_ref,
  closeQuote: r.close_quote,
  closedAt: r.closed_at,
  proposal: r.proposal_ref ? { ref: r.proposal_ref, quote: r.proposal_quote ?? "", href: r.proposal_href ?? "", at: r.proposal_at ?? "", by: r.proposal_by === "rule" ? "rule" : "ai" } : null,
  rejected: parse<string[]>(r.rejected, []),
  snoozeUntil: r.snooze_until,
  snapshot: parse<Partial<Loop>>(r.snapshot, {}),
  updatedAt: r.updated_at,
});

/** Every loop's state, by ref. */
export function allStates(): Map<string, StateRow> {
  return new Map((db().prepare("select * from loops_state").all() as Raw[]).map((r) => [r.ref, toRow(r)]));
}

export function stateOf(ref: string): StateRow | null {
  const r = db().prepare("select * from loops_state where ref = ?").get(ref) as Raw | undefined;
  return r ? toRow(r) : null;
}

/** A loop's state changed (only the fields given). */
export function putState(ref: string, v: Partial<Omit<StateRow, "ref" | "updatedAt">>): void {
  const had = stateOf(ref);
  const next: StateRow = { ref, state: "open", closedBy: null, closeRef: "", closeQuote: "", closedAt: null, proposal: null, rejected: [], snoozeUntil: null, snapshot: {}, ...had, ...v, updatedAt: new Date().toISOString() };
  db()
    .prepare(
      `insert into loops_state (ref, state, closed_by, close_ref, close_quote, closed_at, proposal_ref, proposal_quote, proposal_href, proposal_at, proposal_by, rejected, snooze_until, snapshot, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(ref) do update set state = excluded.state, closed_by = excluded.closed_by, close_ref = excluded.close_ref, close_quote = excluded.close_quote, closed_at = excluded.closed_at, proposal_ref = excluded.proposal_ref, proposal_quote = excluded.proposal_quote, proposal_href = excluded.proposal_href, proposal_at = excluded.proposal_at, proposal_by = excluded.proposal_by, rejected = excluded.rejected, snooze_until = excluded.snooze_until, snapshot = excluded.snapshot, updated_at = excluded.updated_at`,
    )
    .run(next.ref, next.state, next.closedBy, next.closeRef.slice(0, 300), next.closeQuote.slice(0, 400), next.closedAt, next.proposal?.ref ?? null, next.proposal?.quote.slice(0, 400) ?? null, next.proposal?.href ?? null, next.proposal?.at ?? null, next.proposal?.by ?? null, JSON.stringify(next.rejected.slice(-50)), next.snoozeUntil, JSON.stringify(next.snapshot), next.updatedAt);
}

/** The snapshot of a loop kept with its state: what the lists need once its source no longer shows it. */
export const snapshotOf = (l: Loop): Partial<Loop> => ({ ref: l.ref, kind: l.kind, direction: l.direction, origin: l.origin, personId: l.personId, who: l.who, text: l.text, quote: l.quote, at: l.at, due: l.due, sourceRef: l.sourceRef, source: l.source, href: l.href });
