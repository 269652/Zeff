import { addDays } from "@/lib/dates";

/**
 * The statistics behind the correlations — plain code, no AI, no library: Pearson and Spearman, a seeded permutation test, the
 * rank-biserial effect of a group comparison, a split-half check that a link points the same way in both halves of the period,
 * and Benjamini–Hochberg for the many tests at once. A day is "YYYY-MM-DD"; a series is a map of days to numbers. Pure.
 */

export type Daily = Map<string, number>;

/** The day `n` days after (before, negative) this one — calendar days, no time zone in the way. */
export { addDays };

/** The ranks of the values (1 = smallest); ties share the average of their ranks. */
export function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Pearson's r — null when there are fewer than three pairs or a side doesn't vary (no correlation to speak of). */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx < 1e-12 || syy < 1e-12) return null;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

/** Spearman's ρ: Pearson on the ranks — monotonic links, robust against outliers and a scale's steps. */
export const spearman = (xs: number[], ys: number[]): number | null => (xs.length < 3 ? null : pearson(ranks(xs), ranks(ys)));

/** A small seeded random generator (mulberry32): the same seed, the same numbers — results don't flicker between reads. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], r: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

/**
 * How often shuffled pairs give a correlation at least as strong (either direction) as the real one — the p-value of the
 * Spearman correlation, without assumptions about the distribution. (k + 1) / (rounds + 1), so never 0.
 */
export function permutationP(xs: number[], ys: number[], opts: { rounds?: number; seed?: number } = {}): number {
  const rounds = opts.rounds ?? 999;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const real = pearson(rx, ry);
  if (real === null) return 1;
  const r = rng(opts.seed ?? 1);
  const perm = [...ry];
  let k = 0;
  for (let i = 0; i < rounds; i++) {
    const v = pearson(rx, shuffle(perm, r));
    if (v !== null && Math.abs(v) >= Math.abs(real) - 1e-12) k++;
  }
  return (k + 1) / (rounds + 1);
}

/** The same for a difference between two groups: how often shuffled group labels give a rank-biserial at least as large. */
export function permutationGroupsP(a: number[], b: number[], opts: { rounds?: number; seed?: number } = {}): number {
  const rounds = opts.rounds ?? 999;
  const real = Math.abs(rankBiserial(a, b));
  const all = [...a, ...b];
  const r = rng(opts.seed ?? 1);
  let k = 0;
  for (let i = 0; i < rounds; i++) {
    shuffle(all, r);
    if (Math.abs(rankBiserial(all.slice(0, a.length), all.slice(a.length))) >= real - 1e-12) k++;
  }
  return (k + 1) / (rounds + 1);
}

/** Rank-biserial correlation of group a against b: +1 every a above every b, −1 every a below, 0 mixed (Mann–Whitney's U, scaled). */
export function rankBiserial(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const r = ranks([...a, ...b]);
  const ra = r.slice(0, a.length).reduce((s, x) => s + x, 0);
  const u = ra - (a.length * (a.length + 1)) / 2;
  return (2 * u) / (a.length * b.length) - 1;
}

/** The pairs of two daily series: x of the day `lag` days before with y of the day — only days both have a value. */
export function pairUp(x: Daily, y: Daily, lag: 0 | 1): { days: string[]; xs: number[]; ys: number[] } {
  const days: string[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const day of [...y.keys()].sort()) {
    const xv = x.get(lag ? addDays(day, -lag) : day);
    if (xv === undefined) continue;
    days.push(day);
    xs.push(xv);
    ys.push(y.get(day)!);
  }
  return { days, xs, ys };
}

/**
 * Whether a link holds over time: the pairs (in the order of their days) split in two halves, the Spearman correlation of each
 * points the same way as the whole. A link of only one stretch (a holiday, one bad month) isn't one to tell.
 */
export function splitHalfStable(xs: number[], ys: number[]): boolean {
  const whole = spearman(xs, ys);
  if (whole === null) return false;
  const h = Math.floor(xs.length / 2);
  const first = spearman(xs.slice(0, h), ys.slice(0, h));
  const second = spearman(xs.slice(h), ys.slice(h));
  return first !== null && second !== null && Math.sign(first) === Math.sign(whole) && Math.sign(second) === Math.sign(whole);
}

/** Benjamini–Hochberg adjusted p-values (q), in the order given: many tests at once without a flood of chance findings. */
export function benjaminiHochberg(ps: number[]): number[] {
  const m = ps.length;
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const q = new Array<number>(m);
  let min = 1;
  for (let k = m - 1; k >= 0; k--) {
    const [p, i] = order[k];
    min = Math.min(min, (p * m) / (k + 1));
    q[i] = min;
  }
  return q;
}
