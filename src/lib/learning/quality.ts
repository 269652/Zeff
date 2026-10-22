import { listFeedback, type FeedbackRow, type Verdict } from "./ledger";

/**
 * How useful each AI step is, from your decisions in the ledger — counted, no AI: per step the acceptance over the last
 * 7, 30 and 90 days, how many decisions, the trend (the last 30 days against the 30 before), and the patterns you
 * reject most (the same sender, the same kind). Read by the quality page, the MCP tool `ai_quality` and the API.
 */

export const WINDOWS = [7, 30, 90] as const;
/** Below this many judged decisions a rate says nothing yet. */
export const MIN_FOR_RATE = 3;

export type Counts = Record<Verdict, number> & { total: number };
export type StepWindow = Counts & { days: number; /** accepted ÷ (accepted + rejected + edited); null below MIN_FOR_RATE. */ rate: number | null };
export type StepQuality = {
  step: string;
  windows: StepWindow[];
  /** The rate of the last 30 days minus the 30 before (−1…1); null when either has too few. */
  trend: number | null;
  /** All decisions ever, and the latest. */
  total: number;
  last: string | null;
};
export type Pattern = { step: string; sender: string | null; kind: string | null; rejected: number; accepted: number; last: string; examples: { itemRef: string; at: string; text: string }[] };
export type QualityReport = { at: string; steps: StepQuality[]; patterns: Pattern[] };

const DAY = 864e5;

export function counts(rows: FeedbackRow[]): Counts {
  const c: Counts = { total: rows.length, accepted: 0, rejected: 0, edited: 0, ignored: 0 };
  for (const r of rows) c[r.verdict]++;
  return c;
}

/** Accepted of what you judged (ignored isn't judged) — null below MIN_FOR_RATE. */
export function rateOf(c: Counts): number | null {
  const judged = c.accepted + c.rejected + c.edited;
  return judged >= MIN_FOR_RATE ? c.accepted / judged : null;
}

const textOf = (r: FeedbackRow) => String(r.detail.text ?? r.detail.title ?? r.detail.subject ?? r.itemRef).slice(0, 200);

/** The report at `now`: every step that has decisions, the busiest first; the most rejected patterns of the last 90 days. */
export function qualityReport(now = Date.now(), opts: { step?: string } = {}): QualityReport {
  const since = (days: number) => new Date(now - days * DAY).toISOString();
  const all = listFeedback({ step: opts.step }).filter((r) => r.at <= new Date(now).toISOString());
  const bySteps = new Map<string, FeedbackRow[]>();
  for (const r of all) bySteps.set(r.step, [...(bySteps.get(r.step) ?? []), r]);
  const steps: StepQuality[] = [...bySteps.entries()].map(([step, rows]) => {
    const windows = WINDOWS.map((days) => {
      const c = counts(rows.filter((r) => r.at >= since(days)));
      return { days, ...c, rate: rateOf(c) };
    });
    const recent = rateOf(counts(rows.filter((r) => r.at >= since(30))));
    const before = rateOf(counts(rows.filter((r) => r.at >= since(60) && r.at < since(30))));
    return { step, windows, trend: recent !== null && before !== null ? recent - before : null, total: rows.length, last: rows[0]?.at ?? null };
  });
  steps.sort((a, b) => b.windows[2].total - a.windows[2].total || b.total - a.total || a.step.localeCompare(b.step));
  return { at: new Date(now).toISOString(), steps, patterns: patterns(all.filter((r) => r.at >= since(90))) };
}

/** The same sender and kind of one step, rejected twice or more — the most rejected first. */
export function patterns(rows: FeedbackRow[], min = 2, limit = 20): Pattern[] {
  const groups = new Map<string, FeedbackRow[]>();
  for (const r of rows) {
    if (!r.sender && !r.kind) continue;
    const k = `${r.step}\u0000${r.sender ?? ""}\u0000${r.kind ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: Pattern[] = [];
  for (const list of groups.values()) {
    const rejected = list.filter((r) => r.verdict === "rejected");
    if (rejected.length < min) continue;
    out.push({
      step: list[0].step,
      sender: list[0].sender,
      kind: list[0].kind,
      rejected: rejected.length,
      accepted: list.filter((r) => r.verdict === "accepted").length,
      last: rejected[0].at,
      examples: rejected.slice(0, 5).map((r) => ({ itemRef: r.itemRef, at: r.at, text: textOf(r) })),
    });
  }
  return out.sort((a, b) => b.rejected - a.rejected || b.last.localeCompare(a.last)).slice(0, limit);
}
