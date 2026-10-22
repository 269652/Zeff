/**
 * Your word on an open loop (the loops plugin) — each in the feedback ledger (lib/learning, step "open-loops"), so the quality page
 * can say how much of what the AI and the rules call a loop is one:
 * - close: kept (a promise: ticked off in the People plugin as well) — accepted;
 * - dismiss: not a loop (a promise: rejected in the People plugin as well) — rejected;
 * - confirm: a promise the AI read is real — accepted;
 * - reopen: not kept after all — a closing by rule or the AI taken back (rejected, "close:rule" / "close:ai"), and not made again;
 * - accept-close / reject-close: a proposal to close it (a reply about it, or the AI's reading) — accepted / rejected ("close:rule" /
 *   "close:ai");
 * - later: off the Today page for a few days (no verdict).
 * Server only.
 */
import { emitChange } from "@/lib/events";
import { recordFeedback } from "@/lib/learning/ledger";
import { loopFeedback } from "@/lib/learning/sources";
import { reviewClaim } from "@/plugins/people/graph";
import { closeClaim } from "./close";
import { findLoop } from "./query";
import { SNOOZE_DAYS, type Loop } from "./shared";
import { putState, snapshotOf, stateOf } from "./state";

export const LOOP_OPS = ["close", "dismiss", "confirm", "reopen", "accept-close", "reject-close", "later"] as const;
export type LoopOp = (typeof LOOP_OPS)[number];

const claimId = (ref: string): number | null => {
  const m = /^claim:(\d+)$/.exec(ref);
  return m ? Number(m[1]) : null;
};

export function decideLoop(ref: string, op: LoopOp, now = new Date()): { ok: true; loop: Loop | null } | { ok: false; error: string } {
  if (!(LOOP_OPS as readonly string[]).includes(op)) return { ok: false, error: `unknown op ${op}` };
  const loop = findLoop(ref, now);
  if (!loop) return { ok: false, error: "no such loop" };
  const id = claimId(ref);
  const at = now.toISOString();
  const st = stateOf(ref);
  switch (op) {
    case "close": {
      if (loop.state === "closed") break;
      // A promise: ticked off where it lives (the People plugin records it in the ledger then).
      if (id) reviewClaim(id, "done");
      else recordFeedback(loopFeedback(loop, "accepted", "close"));
      putState(ref, { state: "closed", closedBy: "you", closeRef: "", closeQuote: "", closedAt: at, proposal: null, snapshot: snapshotOf(loop) });
      break;
    }
    case "dismiss": {
      recordFeedback(loopFeedback(loop, "rejected", "dismiss"));
      if (id) reviewClaim(id, "reject");
      putState(ref, { state: "dismissed", closedAt: at, proposal: null, snapshot: snapshotOf(loop) });
      break;
    }
    case "confirm": {
      if (!id || loop.confirmed) break;
      reviewClaim(id, "confirm");
      recordFeedback(loopFeedback(loop, "accepted", "confirm"));
      break;
    }
    case "reopen": {
      if (loop.state === "open") break;
      // A closing by rule or the AI that was wrong: in the ledger, and its message never closes it again.
      if (st?.closedBy === "rule" || st?.closedBy === "ai") {
        recordFeedback(loopFeedback(loop, "rejected", "reopen", `close:${st.closedBy}`, { closeQuote: st.closeQuote, closeRef: st.closeRef }));
      }
      if (id) reviewClaim(id, "reopen");
      const rejected = [...(st?.rejected ?? []), ...(st?.closeRef ? [st.closeRef] : [])];
      putState(ref, { state: "open", closedBy: null, closeRef: "", closeQuote: "", closedAt: null, rejected });
      break;
    }
    case "accept-close": {
      const p = st?.proposal;
      if (!p) return { ok: false, error: "no proposal" };
      recordFeedback(loopFeedback(loop, "accepted", "accept-close", `close:${p.by}`, { closeQuote: p.quote, closeRef: p.ref }));
      if (id) closeClaim(id, p.by, p.ref, p.quote, p.href);
      else putState(ref, { state: "closed", closedBy: p.by, closeRef: p.ref, closeQuote: p.quote, closedAt: at, proposal: null, snapshot: snapshotOf(loop) });
      break;
    }
    case "reject-close": {
      const p = st?.proposal;
      if (!p) return { ok: false, error: "no proposal" };
      recordFeedback(loopFeedback(loop, "rejected", "reject-close", `close:${p.by}`, { closeQuote: p.quote, closeRef: p.ref }));
      putState(ref, { proposal: null, rejected: [...(st?.rejected ?? []), p.ref] });
      break;
    }
    case "later": {
      putState(ref, { snoozeUntil: new Date(now.getTime() + SNOOZE_DAYS * 864e5).toISOString(), snapshot: st?.snapshot && Object.keys(st.snapshot).length ? st.snapshot : snapshotOf(loop) });
      break;
    }
  }
  emitChange("todos");
  return { ok: true, loop: findLoop(ref, now) };
}
