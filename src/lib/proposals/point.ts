import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { Feedback } from "@/lib/learning/ledger";

/**
 * Proposals (client-free types and the extension point): one shape for everything Zeff proposes and you accept or dismiss — a
 * name that may be someone's, an organisation behind a mail domain, a block of the day plan, a shadow calendar's appointment.
 * The proposing place calls `propose()` (@/lib/proposals); what an accept or a dismiss DOES is its source's, contributed here
 * from the plugin's `server.ts`. Every decision goes through `decide()`, which runs that handler and writes the learning
 * ledger. The review queue lists the open ones, grouped by source. Server only.
 */

export type ProposalStatus = "open" | "accepted" | "dismissed" | "expired";
export type ProposalVerdict = "accepted" | "dismissed";

export type Proposal<P = Record<string, unknown>> = {
  id: number;
  /** Which source made it ("people-identity", "entities", "calendar-shadow") — its handler's id. */
  source: string;
  /** The source's own kind ("merge", "alias", "day-plan-block" …). */
  kind: string;
  /** What it is about ("person:12", "org:3", "shadow:7:plan:0") — "" when it is about something not there yet. */
  subjectRef: string;
  /** What accepting it does, as the source needs it. */
  payload: P;
  /** Why — one line, as shown. */
  why: string;
  /** How sure (0–1); null: not said. */
  confidence: number | null;
  /** What it was read from ("mail:<key>", "todo:12"). */
  evidenceRefs: string[];
  status: ProposalStatus;
  /** What it was made from — the same source and hash is the same proposal (never made again once dismissed). */
  inputHash: string;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
};

/** What a decision came to: a message to show, the thing it made or changed. */
export type ProposalOutcome = { message?: string; ref?: string } | void;

/** How the review queue shows a proposal. */
export type ProposalEntry = { title: string; detail?: string; href?: string };

export type ProposalSource = {
  /** Unique ("people-identity") — no colon: the review queue's keys are "<id>:<proposal id>". */
  id: string;
  /** Its heading in the review queue (a getter, when translated). */
  label: string;
  /** The learning ledger's step its decisions count for (default: the id). */
  step?: string;
  /** Before its open proposals are listed: bring them up to date (cheap, or done once). */
  prepare?(): void | Promise<void>;
  /** How each is shown in the review queue (in order). Not listed there: `review: false`. */
  entries(list: Proposal[]): ProposalEntry[] | Promise<ProposalEntry[]>;
  review?: boolean;
  /** The buttons' words (default "Right" / "Wrong"). */
  labels?(): { yes: string; no: string };
  /** Accepted: do what it says. Throws when it no longer can (nothing is decided then). */
  apply(p: Proposal): ProposalOutcome | Promise<ProposalOutcome>;
  /** Dismissed: what follows (by default nothing — the proposal is remembered as dismissed). */
  dismiss?(p: Proposal): ProposalOutcome | Promise<ProposalOutcome>;
  /** The ledger row's fields of its own (sender, kind, detail, a key of before) — over the defaults. */
  feedback?(p: Proposal, verdict: ProposalVerdict): Partial<Feedback>;
};

export const proposalSources = extensionPoint<ProposalSource[]>("proposals.sources");
