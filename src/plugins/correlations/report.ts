import { t } from "@/lib/i18n/server";
import { todayLocal } from "@/lib/series/days";
import { allSeries, findSeries } from "@/lib/series/series";
import type { Series, SeriesInfo } from "@/lib/series/series-point";
import { comparePair, type Pair, type Report } from "./engine";
import * as core from "./core";

/**
 * The correlations as the widget, the page and the agents ask for them — the built-in's side of core.ts (the pure part, shared word for
 * word with the port): the series read here, the user's language and today filled in. Server only.
 */

export type Period = core.Period;
export type TargetQuery = core.TargetQuery;

export const period = (opts: { days?: number; from?: string; to?: string } = {}): Period => core.period(opts, todayLocal());

/** The series of a period — the day before it too (the first day's "yesterday"). */
export const seriesOf = (p: Period): Promise<Series[]> => allSeries(core.readRange(p));

export const targetChoices = core.targetChoices;
export const scaleText = core.scaleText;

export async function correlationReport(q: TargetQuery, p: Period, opts: { limit?: number } = {}): Promise<{ report: Report; all: Series[] } | { error: string; all: Series[] }> {
  const all = await seriesOf(p);
  const r = core.reportOf(all, q, p, t, opts);
  return "error" in r ? { error: r.error, all } : { report: r.report, all };
}

export const reportText = (r: Report): string => core.reportText(r, t);
export const pairText = (x: SeriesInfo, y: SeriesInfo, lag: 0 | 1, pair: Pair): string => core.pairText(x, y, lag, pair, t);

export { comparePair, findSeries };
