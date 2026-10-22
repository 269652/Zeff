import assert from "node:assert/strict";
import test from "node:test";
import { analyze, comparePair } from "@/plugins/correlations/engine";
import type { Series, SeriesKind } from "@/plugins/correlations/series-point";
import { addDays, rng } from "@/plugins/correlations/stats";

/**
 * The findings: a target series (a journal's energy) against all others — only what holds (enough days, strong enough, unlikely by
 * chance after the many tests, the same in both halves of the period), ranked, each in one plain sentence with its n.
 */

const START = "2026-06-01";
const days = (n: number) => Array.from({ length: n }, (_, i) => addDays(START, i));
const series = (id: string, label: string, values: number[], kind: SeriesKind = "number", unit?: string): Series => ({
  id,
  label,
  group: "Test",
  kind,
  ...(unit ? { unit } : {}),
  values: new Map(values.map((v, i) => [addDays(START, i), v] as const).filter(([, v]) => !Number.isNaN(v))),
});

/** Noise series that have nothing to do with anything — the guard must not report one of them. */
function noise(count: number, n: number, seed: number): Series[] {
  const r = rng(seed);
  return Array.from({ length: count }, (_, k) => series(`noise:${k}`, `Noise ${k}`, days(n).map(() => Math.round(r() * 10))));
}

test("too few days: nothing is reported as a finding — it says how many there are and how many it needs", () => {
  const meetings = [0, 1, 2, 3, 4, 5, 6, 0, 1, 2];
  const energy = series("j:energy", "Journal › Energy", meetings.map((m) => 5 - m * 0.6));
  const r = analyze(energy, [series("cal:h", "Meeting hours", meetings, "number", "h")], { from: START, to: addDays(START, 9) });
  assert.equal(r.findings.length, 0);
  assert.equal(r.days, 10);
  assert.match(r.insufficient ?? "", /10 days/);
  assert.match(r.insufficient ?? "", /14/);
});

test("a real link is found among noise — energy lower on meeting-heavy days, with ρ, n and the two groups' means; the noise is not", () => {
  const r0 = rng(7);
  const meetings = days(50).map(() => Math.round(r0() * 6 * 2) / 2);
  const energy = series("j:energy", "Journal › Energy", meetings.map((m) => Math.max(1, Math.min(5, Math.round(5 - m * 0.6 + (r0() - 0.5) * 1.2)))));
  const r = analyze(energy, [series("cal:h", "Meeting hours", meetings, "number", "h"), ...noise(30, 50, 3)], { from: START, to: addDays(START, 49) });
  assert.equal(r.insufficient, null);
  assert.ok(r.tested >= 31, `${r.tested} tested`);
  assert.equal(r.findings.length, 1, r.findings.map((f) => f.sentence).join("\n"));
  const f = r.findings[0];
  assert.equal(f.other.id, "cal:h");
  assert.equal(f.lag, 0);
  assert.ok(f.rho < -0.5, `ρ = ${f.rho}`);
  assert.equal(f.n, 50);
  assert.ok(f.q <= 0.1);
  assert.ok(f.groups && f.groups.high.mean < f.groups.low.mean, "fewer energy on the days with more meetings");
  assert.equal(f.groups!.high.n + f.groups!.low.n, 50);
  assert.match(f.sentence, /Journal › Energy/);
  assert.match(f.sentence, /Meeting hours/);
  assert.match(f.sentence, /lower/);
  assert.match(f.sentence, /n = 50/);
  assert.match(f.sentence, /ρ = −0\.\d\d/);
});

test("yesterday → today: a link only with the day before is found as lag 1", () => {
  const r0 = rng(11);
  const sleep = days(45).map(() => Math.round(4 + r0() * 5));
  const energy = series("j:energy", "Energy", sleep.map((_, i) => (i === 0 ? Number.NaN : sleep[i - 1] * 0.5 + r0())));
  const r = analyze(energy, [series("sleep", "Sleep", sleep, "number", "h")], { from: START, to: addDays(START, 44) });
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].lag, 1);
  assert.match(r.findings[0].sentence, /day after|the next day/);
});

test("a tag (0/1) is a group comparison: the target's mean on days with it and without, n of each", () => {
  const r0 = rng(5);
  const sport = days(40).map(() => (r0() < 0.35 ? 1 : 0));
  const energy = series("j:energy", "Energy", sport.map((s) => Math.round((s ? 4 : 2.5) + (r0() - 0.5) * 1.5)));
  const r = analyze(energy, [series("j:tags:sport", "Tags: Sport", sport, "binary")], { from: START, to: addDays(START, 39) });
  assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.equal(f.kind, "groups");
  assert.ok(f.groups!.high.mean > f.groups!.low.mean);
  assert.equal(f.groups!.high.n, sport.filter(Boolean).length);
  assert.match(f.sentence, new RegExp(`${f.groups!.high.n} vs ${f.groups!.low.n} days`));
  assert.match(f.sentence, /Tags: Sport/);
});

test("a link of only one stretch is not told: strong in the first half, reversed in the second", () => {
  const r0 = rng(9);
  const x = days(60).map(() => Math.round(r0() * 10));
  // First half: y follows x closely; second half: y goes clearly against x, but less strongly — overall still "significant".
  const y = x.map((v, i) => (i < 30 ? v * 2 + r0() : 10 - v * 0.6 + r0() * 4));
  const target = series("y", "Y", y);
  const pair = comparePair(series("x", "X", x), target, 0);
  assert.ok(pair.stats && pair.stats.p < 0.05, `the whole period alone looks significant (p = ${pair.stats?.p})`);
  assert.equal(pair.stats!.stable, false);
  assert.equal(analyze(target, [series("x", "X", x)], { from: START, to: addDays(START, 59) }).findings.length, 0);
});

test("comparePair: the numbers of any pair for the explore view — n, ρ, r, p, the groups and the points", () => {
  const x = series("x", "X", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const y = series("y", "Y", [2, 4, 5, 8, 10, 12, 15, 16, 18, 20, 21, 24, 26, 28, 30, 33]);
  const p = comparePair(x, y, 0);
  assert.equal(p.n, 16);
  assert.equal(p.points.length, 16);
  assert.ok(p.stats!.rho > 0.99);
  assert.ok(p.stats!.p < 0.01);
  assert.equal(p.groups!.high.n, 8);
  assert.equal(p.groups!.low.n, 8);
  // Too few: no statistics, only the points.
  const few = comparePair(series("x", "X", [1, 2]), series("y", "Y", [1, 2]), 0);
  assert.equal(few.stats, null);
});
