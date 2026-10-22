import { t } from "@/lib/i18n/server";
import { analyze, comparePair, MAX_Q, MIN_DAYS, MIN_STRENGTH, num, type Pair, type Report } from "./engine";
import { todayLocal } from "./days";
import { allSeries, findSeries } from "./series";
import type { Series, SeriesInfo } from "./series-point";
import { addDays } from "./stats";

/**
 * The correlations as the widget, the page and the agents ask for them: a period (the last `days`, or from–to), a target by name,
 * the report — and the same as plain text for the MCP tool, with every number and the rules it held to. Server only.
 */

export type Period = { from: string; to: string };
export type TargetQuery = { database?: string; field: string };

export function period(opts: { days?: number; from?: string; to?: string } = {}): Period {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const to = opts.to && iso.test(opts.to) ? opts.to : todayLocal();
  const from = opts.from && iso.test(opts.from) ? opts.from : addDays(to, -Math.max(1, Math.min(3650, opts.days ?? 90)) + 1);
  return from <= to ? { from, to } : { from: to, to: from };
}

/** The series of a period — the day before it too (the first day's "yesterday"). */
export const seriesOf = (p: Period): Promise<Series[]> => allSeries({ from: addDays(p.from, -1), to: p.to });

/** The series worth offering as a target: a journal's fields first (a person's own), then the rest; only those with values in the period. */
export function targetChoices(all: Series[]): Series[] {
  return all.filter((s) => s.values.size > 0).sort((a, b) => Number(b.id.startsWith("db:")) - Number(a.id.startsWith("db:")));
}

export async function correlationReport(q: TargetQuery, p: Period, opts: { limit?: number } = {}): Promise<{ report: Report; all: Series[] } | { error: string; all: Series[] }> {
  const all = await seriesOf(p);
  const target = findSeries(all, q);
  if (!target) return { error: t("There is no series “{name}”.", { name: q.database ? `${q.database} › ${q.field}` : q.field }), all };
  return { report: analyze(target, all, { ...p, t, limit: opts.limit }), all };
}

/** What the scale of an ordinal target means ("1 = Hard … 5 = Great"). */
export const scaleText = (s: SeriesInfo): string | null => (s.kind === "ordinal" && s.levels?.length ? s.levels.map((l, i) => `${i + 1} = ${l}`).join(", ") : null);

/** The report as text for an agent: the period, what was tested, the findings with their numbers — or plainly that nothing holds. */
export function reportText(r: Report): string {
  const lines = [
    t("Correlations of “{y}”, {from} to {to}: values on {n} days; {tested} comparisons made (each other series with today's and with yesterday's values).", { y: r.target.label, from: r.from, to: r.to, n: r.days, tested: r.tested }),
  ];
  const scale = scaleText(r.target);
  if (scale) lines.push(t("Scale: {scale}.", { scale }));
  if (r.insufficient) return [...lines, "", r.insufficient].join("\n");
  lines.push(t("Rules: at least {min} days with both values, strength |ρ| ≥ {s}, permutation test adjusted for the number of comparisons (Benjamini–Hochberg q ≤ {q}), and the same direction in both halves of the period.", { min: MIN_DAYS, s: MIN_STRENGTH, q: MAX_Q }), "");
  if (!r.findings.length) lines.push(t("No link holds by these rules — say so rather than guess; patterns you think you see may be chance."));
  else r.findings.forEach((f, i) => lines.push(`${i + 1}. ${f.sentence}`));
  lines.push("", t("These are correlations in your own data, not causes."));
  return lines.join("\n");
}

/** One pair in words, whether it holds or not (the explore view and an agent asking about a pair). */
export function pairText(x: SeriesInfo, y: SeriesInfo, lag: 0 | 1, pair: Pair): string {
  const head = lag ? t("{x} (the day before) and {y}", { x: x.label, y: y.label }) : t("{x} and {y} (same day)", { x: x.label, y: y.label });
  if (!pair.stats) return `${head}: ${t("{n} days with both values — too few to say anything.", { n: pair.n })}`;
  const s = pair.stats;
  const nums = `n = ${pair.n} ${t("days")}, ρ = ${num(s.rho, 2)}${s.r !== null ? `, r = ${num(s.r, 2)}` : ""}, p = ${num(s.p, 3)}`;
  const holds = pair.n >= MIN_DAYS && Math.abs(s.rho) >= MIN_STRENGTH && s.p <= 0.05 && s.stable;
  const verdict = pair.n < MIN_DAYS
    ? t("too few days to say anything (at least {min} are needed)", { min: MIN_DAYS })
    : holds
      ? t("a link that holds (alone — among many comparisons it may still be chance)")
      : Math.abs(s.rho) < MIN_STRENGTH
        ? t("no link worth telling (weak)")
        : s.stable
          ? t("not reliable (could well be chance)")
          : t("not reliable (not the same in both halves of the period)");
  return `${head}: ${nums} — ${verdict}.`;
}

export { comparePair, findSeries };
