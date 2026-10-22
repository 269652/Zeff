import { STEPS, type Feedback, type Verdict } from "./ledger";

/**
 * How each place's decision becomes a ledger row — one function per kind, used by the live hook in the place itself AND by
 * the backfill, so both write the same key (and the same pattern fields) and nothing is counted twice.
 */

type ClaimRow = { id: number; kind: string; text: string; evidence?: string | null; source_ref?: string | null; confidence?: number | null; person_id?: number };
type LinkRow = { id: number; rel: string; target_type: string; target_ref: string; label?: string | null; evidence?: string | null; source_ref?: string | null };
type IdentityRow = { id: number; kind: string; name: string; evidence?: string | null; confidence?: number | null };
type SuggestionRow = { id: number; description: string; hours: number; ticket: string | null; reported_by: string | null };

/** A claim the AI read about someone, confirmed or rejected. */
export const claimFeedback = (r: ClaimRow, verdict: Verdict, at?: string): Feedback => ({
  step: STEPS.peopleClaim,
  itemRef: `people-claim:${r.id}`,
  verdict,
  at,
  sourceRef: r.source_ref || null,
  // Where it was read ("msg:wa", "fact", "mail") — the pattern of a source the AI misreads.
  sender: r.source_ref ? r.source_ref.split(":").slice(0, 2).join(":") : null,
  kind: r.kind,
  detail: { text: r.text, evidence: r.evidence ?? "", confidence: r.confidence ?? null, personId: r.person_id ?? null },
  key: `people-claim:${r.id}:${verdict}`,
});

/** A link the AI made (who is connected to what), confirmed or rejected. */
export const linkFeedback = (r: LinkRow, verdict: Verdict, at?: string): Feedback => ({
  step: STEPS.peopleLink,
  itemRef: `people-link:${r.id}`,
  verdict,
  at,
  sourceRef: r.source_ref || null,
  kind: `${r.rel}:${r.target_type}`,
  detail: { text: `${r.rel} ${r.target_type}:${r.target_ref}${r.label ? ` (${r.label})` : ""}`, evidence: r.evidence ?? "" },
  key: `people-link:${r.id}:${verdict}`,
});

/** A name that may be someone's (an alias, a merge, a new person), accepted or rejected. */
export const identityFeedback = (r: IdentityRow, verdict: Verdict, at?: string): Feedback => ({
  step: STEPS.peopleIdentity,
  itemRef: `people-identity:${r.id}`,
  verdict,
  at,
  kind: r.kind,
  detail: { text: r.name, evidence: r.evidence ?? "", confidence: r.confidence ?? null },
  key: `people-identity:${r.id}`,
});

/** A booking suggestion (S-<id>) taken over as it was, with your changes, or skipped. */
export const bookingFeedback = (r: SuggestionRow, verdict: Verdict, at?: string, detail: Record<string, unknown> = {}): Feedback => ({
  step: STEPS.booking,
  itemRef: `entry:S-${r.id}`,
  verdict,
  at,
  sourceRef: r.ticket ? `ticket:${r.ticket}` : null,
  // Who suggested it (an agent's name) — the pattern of an agent whose suggestions you skip.
  sender: r.reported_by,
  detail: { text: r.description, hours: r.hours, ...detail },
  key: `booking:${r.id}`,
});

type TodoLike = { id: number; text: string; ops: { type: string }[]; autoOpsWhy?: string | null; workerDone?: { by: string; note: string | null } | null };

/**
 * The actions the auto-actions proposed on a todo: run (accepted) or taken off (rejected) — all, or one of them (`one`:
 * the verdict is on that action only, not on the todo getting actions at all — the evals tell them apart).
 */
export const autoActionsFeedback = (todo: TodoLike, verdict: Verdict, op?: { type: string }): Feedback => ({
  step: STEPS.autoActions,
  itemRef: `todo:${todo.id}`,
  verdict,
  kind: (op ? [op] : todo.ops).map((o) => o.type).join("+") || null,
  detail: { text: todo.text, why: todo.autoOpsWhy ?? "", ops: (op ? [op] : todo.ops).map((o) => o.type), ...(op ? { one: true } : {}) },
});

/** A worker's, an agent's or a review's "done" on a todo: confirmed by you, or not. */
export const workerDoneFeedback = (todo: TodoLike, verdict: Verdict): Feedback => ({
  step: STEPS.todoDone,
  itemRef: `todo:${todo.id}`,
  verdict,
  // Who said so ("Mail-Durchsicht", an agent's name) — the pattern of a step that calls things done too early.
  sender: todo.workerDone?.by ?? null,
  detail: { text: todo.text, note: todo.workerDone?.note ?? "" },
});
