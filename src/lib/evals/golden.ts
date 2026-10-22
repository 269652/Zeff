/**
 * Golden sets: an eval's cases frozen into a local file (data/evals/<account>/<step>.json — under data/, git-ignored:
 * they hold your mail, notes and people). Built from a snapshot of the account's database by `npm run eval -- build`:
 * each adapter derives its labels from what you decided (a todo you did or dropped, a claim you confirmed or
 * rejected, actions you took); other sources of verdicts — the ai_feedback ledger, once it exists — come in as a
 * VerdictSource and override the derived labels of the items they name. Frozen, so a before/after compares the same
 * input every time, however the live data moved on.
 */
import fs from "node:fs";
import path from "node:path";
import type { EvalCase, Label } from "./harness";

export type GoldenFile<I = unknown> = { version: 1; step: string; account: string; builtAt: string; cases: EvalCase<I>[]; /** What went into the labels (adapter rules, verdict sources). */ sources?: string[] };

/** Where an account's golden set for a step lives. */
export const goldenPath = (dir: string, account: string, step: string) => path.join(dir, account, `${step}.json`);

export function writeGolden<I>(file: string, g: { step: string; account: string; cases: EvalCase<I>[]; sources?: string[] }): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out: GoldenFile<I> = { version: 1, step: g.step, account: g.account, builtAt: new Date().toISOString(), cases: g.cases, ...(g.sources ? { sources: g.sources } : {}) };
  fs.writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
}

/** A golden set (null: none built, or not one this version reads). */
export function readGolden<I = unknown>(file: string): GoldenFile<I> | null {
  try {
    const g = JSON.parse(fs.readFileSync(file, "utf8")) as GoldenFile<I>;
    return g?.version === 1 && Array.isArray(g.cases) ? g : null;
  } catch {
    return null;
  }
}

const RANK: Record<Label, number> = { must: 3, negative: 2, open: 1 };

/** Two verdicts on one item: kept beats dropped beats not judged (one todo of a mail done, another dropped: the mail mattered). */
export const mergeLabel = (a: Label | undefined, b: Label): Label => (!a || RANK[b] > RANK[a] ? b : a);

/** A verdict on an item of a step, from another record of your decisions than the step's own tables. */
export type Verdict = { step: string; item: string; label: Label };

/**
 * Where verdicts come from besides an adapter's own rules. The ai_feedback ledger (intel-learn) plugs in here: a
 * source whose `verdicts(step)` reads its rows for the step (accepted → must, rejected → negative) with the items
 * named as the adapters name them (mail:<key> → the mail's key; `<personId>@<sourceRef>`; `todo:<id>` …).
 */
export type VerdictSource = { name: string; verdicts(step: string): Verdict[] };

/**
 * Verdicts laid over a step's cases: an item a case has (any label) takes the verdict — the explicit one wins over
 * the derived. Items no case has can't be placed (their input isn't frozen): counted, not invented.
 */
export function applyVerdicts<I>(cases: EvalCase<I>[], verdicts: Verdict[], step: string): { cases: EvalCase<I>[]; applied: number; unplaced: string[] } {
  const out = cases.map((c) => ({ ...c, labels: { ...c.labels } }));
  let applied = 0;
  const unplaced: string[] = [];
  for (const v of verdicts.filter((x) => x.step === step)) {
    const hits = out.filter((c) => v.item in c.labels);
    if (!hits.length) unplaced.push(v.item);
    for (const c of hits) {
      c.labels[v.item] = v.label;
      applied++;
    }
  }
  return { cases: out, applied, unplaced };
}
