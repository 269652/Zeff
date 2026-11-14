import { translator, type T } from "@/lib/i18n/shared";
import type { Series, SeriesInfo } from "@/lib/series/series-point";
import { addDays, benjaminiHochberg, pairUp, pearson, permutationGroupsP, permutationP, rankBiserial, spearman, splitHalfStable } from "./stats";

/**
 * The findings of a target series (a journal's energy, its mood) against every other series: today's and yesterday's values (lag 0
 * and 1); a measure by Spearman's ρ (with the days above and below its median as two groups), a tag or a tick (0/1) as a group
 * comparison (the target's mean with it and without). Told only what holds — enough days (14), strong enough (|ρ| ≥ 0.3), unlikely
 * by chance (a permutation test, then Benjamini–Hochberg over all the tests made: q ≤ 0.1) and pointing the same way in both halves
 * of the period — ranked by strength × reliability, each in a plain sentence with its n. Numbers only; no AI. Pure.
 */

export const MIN_DAYS = 14;
export const MIN_GROUP = 5;
export const MIN_STRENGTH = 0.3;
export const MAX_Q = 0.1;

export type Group = { mean: number; n: number };
/** The target in two groups of days: `high` the days with the other (a tag), or with more of it than `threshold` (its median). */
export type GroupSplit = { high: Group; low: Group; threshold: number | null };

export type Finding = {
  kind: "correlation" | "groups";
  other: SeriesInfo;
  /** 0: the same day; 1: the other's value of the day before. */
  lag: 0 | 1;
  n: number;
  /** Spearman's ρ (for a tag: the rank-biserial, same scale). */
  rho: number;
  /** Pearson's r (null for a group comparison). */
  r: number | null;
  /** Permutation p-value, and adjusted for the number of tests (Benjamini–Hochberg). */
  p: number;
  q: number;
  strength: number;
  score: number;
  groups: GroupSplit | null;
  sentence: string;
};

export type Report = {
  target: SeriesInfo;
  from: string;
  to: string;
  /** Days the target has a value in the period. */
  days: number;
  /** Comparisons made (series × lags with enough days). */
  tested: number;
  findings: Finding[];
  /** Why nothing could be said at all (too few days), else null. */
  insufficient: string | null;
};

export type Options = { from: string; to: string; minDays?: number; minStrength?: number; maxQ?: number; rounds?: number; limit?: number; t?: T };

const inRange = (s: Series, from: string, to: string): Series => ({ ...s, values: new Map([...s.values].filter(([d]) => d >= from && d <= to)) });
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const hash = (s: string) => [...s].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7);
const info = (s: Series): SeriesInfo => {
  const { values: _values, ...rest } = s;
  return rest;
};

/** The target's values in two groups: a 0/1 series by its value; a measure above its median against the rest (each group ≥ 5 days). */
export function splitGroups(xs: number[], ys: number[], binary: boolean): GroupSplit | null {
  let threshold: number | null = null;
  let high: (x: number) => boolean = (x) => x > 0.5;
  if (!binary) {
    const sorted = [...xs].sort((a, b) => a - b);
    const median = sorted[Math.floor((sorted.length - 1) / 2)];
    threshold = median;
    high = (x) => x > median;
  }
  const a = ys.filter((_, i) => high(xs[i]));
  const b = ys.filter((_, i) => !high(xs[i]));
  if (a.length < MIN_GROUP || b.length < MIN_GROUP) return null;
  return { high: { mean: avg(a), n: a.length }, low: { mean: avg(b), n: b.length }, threshold };
}

export type PairStats = { rho: number; r: number | null; p: number; stable: boolean };
export type Pair = { n: number; points: { day: string; x: number; y: number }[]; stats: PairStats | null; groups: GroupSplit | null };

/** The numbers of one pair (any two series, either lag) — for the explore view: the points, and the statistics once there are 3 pairs. */
export function comparePair(x: Series, y: Series, lag: 0 | 1, rounds = 999): Pair {
  const { days, xs, ys } = pairUp(x.values, y.values, lag);
  const points = days.map((day, i) => ({ day, x: xs[i], y: ys[i] }));
  const groups = splitGroups(xs, ys, x.kind === "binary");
  const binary = x.kind === "binary";
  if (binary && groups) {
    const a = ys.filter((_, i) => xs[i] > 0.5);
    const b = ys.filter((_, i) => xs[i] <= 0.5);
    return { n: days.length, points, groups, stats: { rho: rankBiserial(a, b), r: null, p: permutationGroupsP(a, b, { rounds, seed: hash(x.id + lag) }), stable: splitHalfStable(xs, ys) } };
  }
  const rho = spearman(xs, ys);
  if (rho === null) return { n: days.length, points, groups, stats: null };
  return { n: days.length, points, groups, stats: { rho, r: pearson(xs, ys), p: permutationP(xs, ys, { rounds, seed: hash(x.id + lag) }), stable: splitHalfStable(xs, ys) } };
}

/** A number as the sentences show it: one decimal at most, a real minus sign. */
export function num(n: number, digits = 1): string {
  const f = 10 ** digits;
  const v = Math.round(n * f) / f;
  return `${v < 0 ? "−" : ""}${Math.abs(v)}`;
}

/** The target's mean in words: a 0/1 target as a share of days. */
const level = (target: SeriesInfo, v: number) => (target.kind === "binary" ? `${Math.round(v * 100)} %` : `${num(v)}${target.unit ? ` ${target.unit}` : ""}`);

/** The one sentence of a finding, with its numbers. */
export function sentence(target: SeriesInfo, f: Omit<Finding, "sentence" | "score">, t: T): string {
  const vars = { y: target.label, x: f.other.label, rho: num(f.rho, 2), n: f.n, q: num(f.q, 3) };
  const dir = f.rho > 0 ? t("higher") : t("lower");
  const g = f.groups;
  if (f.kind === "groups" && g) {
    const head = f.lag
      ? t("{y} is {dir} on the day after {x}: {a} vs {b} otherwise", { ...vars, dir, a: level(target, g.high.mean), b: level(target, g.low.mean) })
      : t("{y} is {dir} on days with {x}: {a} vs {b} otherwise", { ...vars, dir, a: level(target, g.high.mean), b: level(target, g.low.mean) });
    return `${head} (${t("{a} vs {b} days", { a: g.high.n, b: g.low.n })}, ${t("rank-biserial {rho}", vars)}, q = ${vars.q}).`;
  }
  const head = f.lag
    ? t("After days with more {x}, {y} tends to be {dir} the next day", { ...vars, dir })
    : t("On days with more {x}, {y} tends to be {dir}", { ...vars, dir });
  const groups =
    g && g.threshold !== null
      ? ` ${
          g.threshold === 0
            ? t("{y} {a} on days with any {x}, {b} on days without ({na} vs {nb} days).", { ...vars, a: level(target, g.high.mean), b: level(target, g.low.mean), na: g.high.n, nb: g.low.n })
            : t("{y} {a} on days with more than {thr} {x}, {b} otherwise ({na} vs {nb} days).", { ...vars, thr: `${num(g.threshold)}${f.other.unit ? ` ${f.other.unit}` : ""}`, a: level(target, g.high.mean), b: level(target, g.low.mean), na: g.high.n, nb: g.low.n })
        }`
      : "";
  return `${head} (ρ = ${vars.rho}, n = ${f.n} ${t("days")}, q = ${vars.q}).${groups}`;
}

/** The findings of `target` against `others` in the period — only those that hold, best first. */
export function analyze(targetAll: Series, othersAll: Series[], opts: Options): Report {
  const t = opts.t ?? translator("en");
  const minDays = opts.minDays ?? MIN_DAYS;
  const target = inRange(targetAll, opts.from, opts.to);
  const base = { target: info(target), from: opts.from, to: opts.to, days: target.values.size };
  if (target.values.size < minDays || new Set(target.values.values()).size < 2) {
    const insufficient =
      target.values.size < minDays
        ? t("{y} has values on only {n} days in this period — at least {min} are needed before anything can be said.", { y: target.label, n: target.values.size, min: minDays })
        : t("{y} has the same value on every day in this period — there is nothing to compare.", { y: target.label });
    return { ...base, tested: 0, findings: [], insufficient };
  }
  type Cand = Omit<Finding, "sentence" | "score" | "q"> & { stable: boolean };
  const cands: Cand[] = [];
  for (const otherAll of othersAll) {
    if (otherAll.id === target.id) continue;
    // The other's values of the day before the period count too (lag 1 of its first day).
    const other = inRange(otherAll, addDays(opts.from, -1), opts.to);
    for (const lag of [0, 1] as const) {
      const { xs, ys } = pairUp(other.values, target.values, lag);
      if (xs.length < minDays) continue;
      const binary = other.kind === "binary";
      const groups = splitGroups(xs, ys, binary);
      if (binary) {
        if (!groups) continue;
        const a = ys.filter((_, i) => xs[i] > 0.5);
        const b = ys.filter((_, i) => xs[i] <= 0.5);
        const rho = rankBiserial(a, b);
        const strong = Math.abs(rho) >= (opts.minStrength ?? MIN_STRENGTH);
        cands.push({ kind: "groups", other: info(other), lag, n: xs.length, rho, r: null, p: strong ? permutationGroupsP(a, b, { rounds: opts.rounds, seed: hash(other.id + lag) }) : 1, strength: Math.abs(rho), groups, stable: strong && splitHalfStable(xs, ys) });
      } else {
        const rho = spearman(xs, ys);
        if (rho === null) continue;
        const strong = Math.abs(rho) >= (opts.minStrength ?? MIN_STRENGTH);
        cands.push({ kind: "correlation", other: info(other), lag, n: xs.length, rho, r: pearson(xs, ys), p: strong ? permutationP(xs, ys, { rounds: opts.rounds, seed: hash(other.id + lag) }) : 1, strength: Math.abs(rho), groups, stable: strong && splitHalfStable(xs, ys) });
      }
    }
  }
  const qs = benjaminiHochberg(cands.map((c) => c.p));
  const best = new Map<string, Finding>();
  cands.forEach((c, i) => {
    const q = qs[i];
    if (c.strength < (opts.minStrength ?? MIN_STRENGTH) || q > (opts.maxQ ?? MAX_Q) || !c.stable) return;
    const { stable: _stable, ...rest } = c;
    const score = c.strength * (1 - q) * Math.min(1, Math.sqrt(c.n / 60));
    const f: Finding = { ...rest, q, score, sentence: sentence(target, { ...rest, q }, t) };
    const had = best.get(c.other.id);
    if (!had || had.score < score) best.set(c.other.id, f);
  });
  const findings = [...best.values()].sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 8);
  return { ...base, tested: cands.length, findings, insufficient: null };
}

