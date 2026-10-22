import { ledgerDb, recordFeedback, type Feedback } from "./ledger";
import { bookingFeedback, claimFeedback, identityFeedback, linkFeedback } from "./sources";
import { ingestTodoEvents } from "./todos";

/**
 * What the ledger can learn from before it was there: the decisions the places kept themselves — your closing of AI-made
 * todos (their history), booking suggestions taken over or skipped, people's claims, links and names decided. Bounded
 * (the last 180 days, at most a few thousand rows each) and idempotent: every row carries the key its live hook writes,
 * so running it again — or after the hook — adds nothing. Not derivable: what was edited before (a booking taken over
 * with changes overwrote the AI's numbers; it counts as accepted), and what left no trace (dropped auto-actions).
 */

const DAYS = 180;
const LIMIT = 5000;

const hasTable = (name: string) => !!ledgerDb().prepare(`select 1 from sqlite_master where type = 'table' and name = ?`).get(name);

/** How many decisions were new, per kind. */
export function backfillFeedback(now = Date.now()): Record<string, number> {
  const since = new Date(now - DAYS * 864e5).toISOString();
  const db = ledgerDb();
  const out: Record<string, number> = { todos: ingestTodoEvents({ since, limit: LIMIT }) };
  const put = (name: string, list: Feedback[]) => {
    out[name] = list.reduce((n, f) => n + (recordFeedback(f) ? 1 : 0), 0);
  };

  if (hasTable("entry_suggestions")) {
    type S = { id: number; status: string; description: string; hours: number; ticket: string | null; reported_by: string | null; updated_at: string };
    const rows = db.prepare(`select id, status, description, hours, ticket, reported_by, updated_at from entry_suggestions where status in ('accepted', 'skipped') and updated_at >= ? order by id limit ?`).all(since, LIMIT) as S[];
    put("booking", rows.map((r) => bookingFeedback(r, r.status === "accepted" ? "accepted" : "rejected", r.updated_at)));
  }
  if (hasTable("people_claims")) {
    type C = { id: number; kind: string; text: string; evidence: string; source_ref: string; confidence: number; person_id: number; status: string; created_at: string; confirmed_at: string | null };
    // Confirmed later than made (one written confirmed — by you — was nobody's proposal); rejected: the AI's always.
    const rows = db.prepare(`select * from people_claims where ((status = 'confirmed' and confirmed_at > created_at) or status = 'rejected') and created_at >= ? order by id limit ?`).all(since, LIMIT) as C[];
    put("people-claim", rows.map((r) => claimFeedback(r, r.status === "confirmed" ? "accepted" : "rejected", r.confirmed_at ?? r.created_at)));
  }
  if (hasTable("people_links")) {
    type L = { id: number; rel: string; target_type: string; target_ref: string; label: string; evidence: string; source_ref: string; status: string; created_at: string; confirmed_at: string | null };
    const rows = db.prepare(`select * from people_links where source = 'ai' and status in ('confirmed', 'rejected') and created_at >= ? order by id limit ?`).all(since, LIMIT) as L[];
    put("people-link", rows.map((r) => linkFeedback(r, r.status === "confirmed" ? "accepted" : "rejected", r.confirmed_at ?? r.created_at)));
  }
  if (hasTable("people_suggestions")) {
    type I = { id: number; kind: string; name: string; evidence: string; confidence: number; status: string; decided_at: string | null; created_at: string };
    const rows = db.prepare(`select * from people_suggestions where status in ('accepted', 'rejected') and coalesce(decided_at, created_at) >= ? order by id limit ?`).all(since, LIMIT) as I[];
    put("people-identity", rows.map((r) => identityFeedback(r, r.status === "accepted" ? "accepted" : "rejected", r.decided_at ?? r.created_at)));
  }
  return out;
}
