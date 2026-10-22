/**
 * The feedback ledger (ai_feedback, lib/learning) as a source of verdicts for the golden sets: your recorded decisions on
 * what a step proposed, named as the eval's adapters name their items. Today that is the auto-actions — the one step whose
 * golden set has no other record of a "no": an action you ran is a must (the todo should get it again), an action you took
 * off is a negative — one of them (`todo:<id>:<type>`), or all of them (the todo too: it shouldn't have got any). Several
 * decisions on one item: kept beats dropped (recall first, as mergeLabel).
 *
 * The other steps' ledger rows say what their adapters read already from the same tables (a review's todo done or dropped,
 * a claim confirmed or rejected) — and laid over them as verdicts they would override the adapters' merges (a mail with one
 * todo done and one dropped is a must, the ledger's single "rejected" would make it a negative), so they don't come in here.
 */
import { listFeedback, type FeedbackRow } from "@/lib/learning/ledger";
import type { Label } from "./harness";
import { mergeLabel, type Verdict, type VerdictSource } from "./golden";

const LABEL: Partial<Record<FeedbackRow["verdict"], Label>> = { accepted: "must", edited: "must", rejected: "negative" };

/** The items of one ledger row of the auto-actions, with their label. */
function autoActionItems(r: FeedbackRow): [string, Label][] {
  const label = LABEL[r.verdict];
  if (!label || !/^todo:\d+$/.test(r.itemRef)) return [];
  const ops = Array.isArray(r.detail.ops) ? (r.detail.ops as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const each = ops.map((type): [string, Label] => [`${r.itemRef}:${type}`, label]);
  return r.detail.one === true ? each : [[r.itemRef, label], ...each];
}

/** Which ledger step feeds which eval step, and how a row names its items. */
const STEPS: Record<string, { ledger: string; items: (r: FeedbackRow) => [string, Label][] }> = {
  "auto-actions": { ledger: "auto-actions", items: autoActionItems },
};

/** The ledger's verdicts for the golden sets (read from the database the process has open — the snapshot of a build). */
export function ledgerVerdicts(): VerdictSource {
  return {
    name: "ai_feedback",
    verdicts(step: string): Verdict[] {
      const map = STEPS[step];
      if (!map) return [];
      const labels = new Map<string, Label>();
      for (const r of listFeedback({ step: map.ledger })) for (const [item, label] of map.items(r)) labels.set(item, mergeLabel(labels.get(item), label));
      return [...labels].map(([item, label]) => ({ step, item, label }));
    },
  };
}

/** The todos whose proposed actions you took off all at once (their proposal is gone from the todo; the ledger keeps it). */
export function droppedAutoActions(): { id: number; ops: string[] }[] {
  const out = new Map<number, Set<string>>();
  for (const r of listFeedback({ step: "auto-actions" })) {
    if (r.verdict !== "rejected" || r.detail.one === true || !/^todo:\d+$/.test(r.itemRef)) continue;
    const id = Number(r.itemRef.slice(5));
    const ops = Array.isArray(r.detail.ops) ? (r.detail.ops as unknown[]).filter((x): x is string => typeof x === "string") : [];
    out.set(id, new Set([...(out.get(id) ?? []), ...ops]));
  }
  return [...out].map(([id, ops]) => ({ id, ops: [...ops] }));
}
