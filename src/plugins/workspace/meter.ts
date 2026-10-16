import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What one run of a pipeline costs, counted as it goes: the AI's calls and their cost, the rows the AI judged (an AI filter)
 * and kept. The calls count themselves (noteAi after each) — no call site passes anything along. Server only.
 */
export type RunMeter = { aiCalls: number; costUsd: number; judged: number; kept: number };

export const meter = new AsyncLocalStorage<RunMeter>();
export const newMeter = (): RunMeter => ({ aiCalls: 0, costUsd: 0, judged: 0, kept: 0 });

/** An AI answer counted into the run that's going (none going: nothing). */
export function noteAi(answer: { costUsd?: number | null } | null | undefined): void {
  const m = meter.getStore();
  if (!m) return;
  m.aiCalls++;
  m.costUsd += answer?.costUsd ?? 0;
}

/** Rows the AI filter judged / kept in the run that's going. */
export function noteJudged(judged: number, kept: number): void {
  const m = meter.getStore();
  if (!m) return;
  m.judged += judged;
  m.kept += kept;
}
