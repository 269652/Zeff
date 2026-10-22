import assert from "node:assert/strict";
import test from "node:test";
import { addDays, benjaminiHochberg, pairUp, pearson, permutationP, rankBiserial, ranks, rng, spearman, splitHalfStable } from "@/plugins/correlations/stats";

/** The statistics of the correlations, on datasets whose answers are known (textbook values, Anscombe's quartet). */

const near = (a: number | null, b: number, eps = 1e-3) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("ranks: average ranks for ties", () => {
  assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
  assert.deepEqual(ranks([3, 1, 2]), [3, 1, 2]);
});

test("Pearson and Spearman on known datasets", () => {
  near(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1);
  near(pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]), -1);
  // y = x² on 1..5: monotonic (Spearman 1), not linear (Pearson 0.981).
  near(pearson([1, 2, 3, 4, 5], [1, 4, 9, 16, 25]), 0.98058);
  near(spearman([1, 2, 3, 4, 5], [1, 4, 9, 16, 25]), 1);
  // Anscombe's quartet, set I: r = 0.816.
  const ax = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
  const ay = [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68];
  near(pearson(ax, ay), 0.8164);
  // Ties: ranks x = 1, 2.5, 2.5, 4.
  near(spearman([1, 2, 2, 3], [1, 2, 3, 4]), 0.9487);
  // No variance: no correlation at all (not 0, not NaN).
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
  assert.equal(spearman([1, 2], [2, 1]), null, "two points say nothing");
});

test("pairing days, today and with yesterday (lag 1): only days both have", () => {
  const x = new Map([["2026-10-01", 1], ["2026-10-02", 2], ["2026-10-04", 4]]);
  const y = new Map([["2026-10-01", 10], ["2026-10-02", 20], ["2026-10-03", 30], ["2026-10-04", 40]]);
  assert.deepEqual(pairUp(x, y, 0), { days: ["2026-10-01", "2026-10-02", "2026-10-04"], xs: [1, 2, 4], ys: [10, 20, 40] });
  // Yesterday's x with today's y: 10-01 → 10-02, 10-02 → 10-03 (10-04's yesterday has no x).
  assert.deepEqual(pairUp(x, y, 1), { days: ["2026-10-02", "2026-10-03"], xs: [1, 2], ys: [20, 30] });
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("a permutation test: a real link is rare under shuffling, noise is not; seeded, so the same every time", () => {
  const r = rng(42);
  const xs = Array.from({ length: 40 }, (_, i) => i);
  const ys = xs.map((x) => x + (r() - 0.5) * 10);
  const p = permutationP(xs, ys, { rounds: 999, seed: 1 });
  assert.ok(p < 0.01, `p = ${p}`);
  assert.equal(permutationP(xs, ys, { rounds: 999, seed: 1 }), p, "deterministic");
  const noise = xs.map(() => r());
  assert.ok(permutationP(xs, noise, { rounds: 999, seed: 1 }) > 0.05);
});

test("rank-biserial: how far one group lies above the other (1: all above, 0: mixed)", () => {
  assert.equal(rankBiserial([5, 6, 7], [1, 2, 3]), 1);
  assert.equal(rankBiserial([1, 2, 3], [5, 6, 7]), -1);
  assert.equal(rankBiserial([1, 2], [1, 2]), 0);
});

test("split-half stability: the link has the same direction in both halves of the period", () => {
  const xs = Array.from({ length: 30 }, (_, i) => i % 10);
  assert.equal(splitHalfStable(xs, xs.map((x) => x * 2)), true);
  // Positive in the first half, reversed in the second.
  assert.equal(splitHalfStable(xs, xs.map((x, i) => (i < 15 ? x : -x))), false);
});

test("Benjamini–Hochberg: many tests, the false discoveries held in check", () => {
  const q = benjaminiHochberg([0.01, 0.04, 0.03, 0.5]);
  near(q[0], 0.04);
  near(q[1], 0.0533);
  near(q[2], 0.0533);
  near(q[3], 0.5);
});
