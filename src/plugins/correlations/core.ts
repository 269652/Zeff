import type { T } from "@/lib/i18n/shared";
import type { Series, SeriesInfo } from "@/lib/series/series-point";
import { findSeries } from "@/lib/series/find";
import { addDays } from "@/lib/dates";
import { analyze, comparePair, MAX_Q, MIN_DAYS, MIN_STRENGTH, num, type Finding, type Pair, type Report } from "./engine";
import type { WidgetData, WidgetItem } from "@/plugins/workspace/widget-point";

/**
 * Correlations' pure core: the period, the report and a pair in words, the widget's rows — given the series and a translator, with
 * nothing read from Zeff. The built-in uses it (report.ts, widgets.ts, mcp.ts) and so does its port: scripts/port-correlations.mts
 * bundles this file into the plugin's lambdas (zeff-plugins/plugins/correlations-ext), so both say the same, word for word.
 */

export type Period = { from: string; to: string };
export type TargetQuery = { database?: string; field: string };

export function period(opts: { days?: number; from?: string; to?: string } = {}, today: string): Period {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const to = opts.to && iso.test(opts.to) ? opts.to : today;
  const from = opts.from && iso.test(opts.from) ? opts.from : addDays(to, -Math.max(1, Math.min(3650, opts.days ?? 90)) + 1);
  return from <= to ? { from, to } : { from: to, to: from };
}

/** The days to read for a period: the day before it too (the first day's "yesterday"). */
export const readRange = (p: Period): Period => ({ from: addDays(p.from, -1), to: p.to });

/** The series worth offering as a target: a journal's fields first (a person's own), then the rest; only those with values in the period. */
export function targetChoices(all: Series[]): Series[] {
  return all.filter((s) => s.values.size > 0).sort((a, b) => Number(b.id.startsWith("db:")) - Number(a.id.startsWith("db:")));
}

/** The report of a target among all series, or why there is none. */
export function reportOf(all: Series[], q: TargetQuery, p: Period, t: T, opts: { limit?: number } = {}): { report: Report } | { error: string } {
  const target = findSeries(all, q);
  if (!target) return { error: t("There is no series “{name}”.", { name: q.database ? `${q.database} › ${q.field}` : q.field }) };
  return { report: analyze(target, all, { ...p, t, limit: opts.limit }) };
}

/** What the scale of an ordinal target means ("1 = Hard … 5 = Great"). */
export const scaleText = (s: SeriesInfo): string | null => (s.kind === "ordinal" && s.levels?.length ? s.levels.map((l, i) => `${i + 1} = ${l}`).join(", ") : null);

/** The report as text for an agent: the period, what was tested, the findings with their numbers — or plainly that nothing holds. */
export function reportText(r: Report, t: T): string {
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
export function pairText(x: SeriesInfo, y: SeriesInfo, lag: 0 | 1, pair: Pair, t: T): string {
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

/** The agent's question answered: the target's findings, or one pair (both lags) — as the MCP tool says it. */
export function toolAnswer(all: Series[], q: TargetQuery & { other?: string; limit?: number }, p: Period, t: T): { ok: string } | { fail: string } {
  const res = reportOf(all, q, p, t, { limit: q.limit });
  if ("error" in res) {
    const names = targetChoices(all).map((s) => s.label);
    return { fail: `${res.error} ${names.length ? `Series with values from ${p.from} to ${p.to}: ${names.join("; ")}.` : "No series has values in this period."}` };
  }
  if (q.other) {
    const x = findSeries(all, { field: q.other });
    if (!x) return { fail: `There is no series “${q.other}”. Series: ${targetChoices(all).map((s) => s.label).join("; ")}.` };
    const y = findSeries(all, q)!;
    const inPeriod = (s: Series): Series => ({ ...s, values: new Map([...s.values].filter(([d]) => d >= p.from && d <= p.to)) });
    return { ok: [0, 1].map((lag) => pairText(x, y, lag as 0 | 1, comparePair(lag ? x : inPeriod(x), inPeriod(y), lag as 0 | 1), t)).join("\n") };
  }
  return { ok: reportText(res.report, t) };
}

/** The page that explores a pair (and, without `x`, the target's findings). */
export const exploreHref = (y: string, opts: { x?: string; lag?: 0 | 1; days?: number } = {}): string => {
  const q = new URLSearchParams({ y });
  if (opts.x) q.set("x", opts.x);
  if (opts.x) q.set("lag", String(opts.lag ?? 0));
  if (opts.days) q.set("days", String(opts.days));
  return `/correlations?${q.toString()}`;
};

/** The bars of a finding: the target's mean in its two groups ("> 3 h" and "≤ 3 h", "with" and "without"). */
function bars(f: Finding, t: T): WidgetItem["mini"] {
  const g = f.groups;
  if (!g) return undefined;
  const unit = f.other.unit ? ` ${f.other.unit}` : "";
  const [hi, lo] = g.threshold === null || g.threshold === 0 ? [t("with"), t("without")] : [`> ${num(g.threshold)}${unit}`, `≤ ${num(g.threshold)}${unit}`];
  const day = f.lag ? `${t("day before")}: ` : "";
  return { bars: [{ label: `${day}${hi}`, value: Math.round(g.high.mean * 100) / 100 }, { label: `${day}${lo}`, value: Math.round(g.low.mean * 100) / 100 }] };
}

export function findingItem(r: Report, f: Finding, days: number, t: T): WidgetItem {
  return {
    id: `${f.other.id}:${f.lag}`,
    icon: f.rho > 0 ? "↗" : "↘",
    text: f.other.label,
    detail: f.sentence,
    wrap: true,
    badge: `ρ ${num(f.rho, 2)}`,
    meta: f.lag ? t("day after") : undefined,
    mini: bars(f, t),
    href: exploreHref(r.target.id, { x: f.other.id, lag: f.lag, days }),
  };
}

/** The widget's data for its settings (target, days, limit) from all series of the period. */
export function widgetData(all: Series[], config: { target?: unknown; days?: unknown; limit?: unknown }, today: string, t: T): WidgetData {
  const days = Number(config.days);
  const target = String(config.target ?? "");
  if (!target) return { kind: "list", items: [], empty: t("Pick a field to explain in the widget's settings — a journal's energy, say.") };
  const res = reportOf(all, { field: target }, period({ days }, today), t, { limit: Number(config.limit) });
  if ("error" in res) return { kind: "error", message: res.error };
  const r = res.report;
  return {
    kind: "list",
    title: `${r.target.label} · ${t("{n} days", { n: r.days })} · ${t("{n} comparisons", { n: r.tested })}`,
    items: r.findings.map((f) => findingItem(r, f, days, t)),
    empty: r.insufficient ?? t("No link holds yet — nothing goes with it reliably over these days."),
    footer: { text: t("Explore any pair"), href: exploreHref(r.target.id, { days }) },
  };
}

/** Series as the kernel's series.read sends them (values an object) — as the engine takes them (a Map). */
export const seriesFromWire = (list: (SeriesInfo & { values: Record<string, number> })[]): Series[] => list.map((s) => ({ ...s, values: new Map(Object.entries(s.values)) }));

export { findSeries };
