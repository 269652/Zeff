import assert from "node:assert/strict";
import test from "node:test";
import { compareInstructions, instructionsIn, score, type Ask, type EvalAdapter, type EvalCase } from "@/lib/evals/harness";
import { applyVerdicts, mergeLabel, readGolden, writeGolden } from "@/lib/evals/golden";
import { parseEvalArgs } from "@/lib/evals/args";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * A toy step: the prompt lists the case's items; the fake AI "finds" the items the prompt lists, except those the
 * instructions tell it to skip ("ohne b") — so a prompt change that drops an item is a lost item, deterministically.
 */
type Toy = { items: string[] };
const toy: EvalAdapter<Toy> = {
  step: "toy",
  title: "Toy",
  task: "general",
  prompt: { file: "toy.ts" },
  costUsd: 0.1,
  async build() {
    return [];
  },
  async run(c, instructions, ask) {
    const out = (await ask(`${instructions}\n${c.input.items.map((i) => `[${i}]`).join("\n")}`, {}, { task: "general", step: "toy" })) as { found?: string[] };
    return new Set(out.found ?? []);
  },
  describe: (item) => `Item ${item}`,
};
const fake: Ask = async (prompt) => {
  const skip = [...prompt.matchAll(/ohne (\w+)/g)].map((m) => m[1]);
  return { found: [...prompt.matchAll(/\[(\w+)\]/g)].map((m) => m[1]).filter((i) => !skip.includes(i)) };
};
const cases: EvalCase<Toy>[] = [{ id: "c1", input: { items: ["a", "b", "c", "d"] }, labels: { a: "must", b: "must", c: "open", d: "negative" } }];

test("score: recall over the must-haves, precision over what was judged; unlabeled findings are only counted", () => {
  assert.deepEqual(score({}, new Set()), { must: { hit: 0, total: 0 }, open: { hit: 0, total: 0 }, negative: { hit: 0, total: 0 }, unlabeled: 0, recall: null, precision: null });
  const s = score({ a: "must", b: "must", c: "open", d: "negative" }, new Set(["a", "c", "d", "x"]));
  assert.deepEqual(s.must, { hit: 1, total: 2 });
  assert.deepEqual(s.open, { hit: 1, total: 1 });
  assert.deepEqual(s.negative, { hit: 1, total: 1 });
  assert.equal(s.unlabeled, 1);
  assert.equal(s.recall, 0.5);
  // judged findings: a (must), d (negative) — open ones are not judged yet.
  assert.equal(s.precision, 0.5);
  // only negatives, none found: precision unknown (nothing judged was found), recall unknown (no must-haves)
  const n = score({ d: "negative" }, new Set());
  assert.equal(n.recall, null);
  assert.equal(n.precision, null);
  assert.equal(score({ a: "must" }, new Set(["a"])).recall, 1);
});

test("instructionsIn: the step's instructions out of its source (exported or not); a template with placeholders or none at all is an error", () => {
  assert.equal(instructionsIn("const x = 1;\nexport const INSTRUCTIONS = `Hallo\nWelt`;\nfoo();"), "Hallo\nWelt");
  assert.equal(instructionsIn("const INSTRUCTIONS = `A`;"), "A");
  assert.equal(instructionsIn("export const OTHER = `B`;", "OTHER"), "B");
  assert.throws(() => instructionsIn("const nothing = 1;"), /INSTRUCTIONS/);
  assert.throws(() => instructionsIn("const INSTRUCTIONS = `a ${b} c`;"), /placeholder/);
});

test("compare: a must-have the old prompt found and the new one doesn't is LOST — exit 1", async () => {
  const r = await compareInstructions({ adapter: toy, cases, before: "Finde alles.", after: "Finde alles ohne b.", runs: 2, ask: fake });
  assert.equal(r.exit, 1);
  assert.deepEqual(r.lost.map((f) => [f.case, f.item, f.label]), [["c1", "b", "must"]]);
  assert.equal(r.lost[0].what, "Item b");
  assert.deepEqual(r.gained, []);
  assert.equal(r.before.recall, 1);
  assert.equal(r.after.length, 2);
  assert.equal(r.after[0].recall, 0.5);
  assert.match(r.lines.join("\n"), /VERLOREN \(1\)/);
  assert.equal(r.calls, 3, "one before, two after");
});

test("compare: what only the new prompt finds is reported as gained — no loss, exit 0", async () => {
  const r = await compareInstructions({ adapter: toy, cases, before: "Finde alles ohne b ohne c.", after: "Finde alles.", runs: 1, ask: fake });
  assert.equal(r.exit, 0);
  assert.deepEqual(r.lost, []);
  assert.deepEqual(r.gained.map((f) => f.item).sort(), ["b", "c"]);
  assert.match(r.lines.join("\n"), /Nichts verloren/);
  assert.match(r.lines.join("\n"), /GEWONNEN \(2\)/);
});

test("compare: an item lost in only one of several runs counts (recall first); an open one too", async () => {
  let call = 0;
  const flaky: Ask = async (prompt, schema, o) => {
    call++;
    // the before run and the first after run find everything; the second after run misses c
    return fake(call === 3 ? `${prompt}\nohne c` : prompt, schema, o);
  };
  const r = await compareInstructions({ adapter: toy, cases, before: "x", after: "x", runs: 2, ask: flaky });
  assert.equal(r.exit, 1);
  assert.deepEqual(r.lost.map((f) => [f.item, f.label]), [["c", "open"]]);
});

test("compare: a negative newly found is reported (precision), but is not a loss", async () => {
  const r = await compareInstructions({ adapter: toy, cases, before: "ohne d", after: "alles", runs: 1, ask: fake });
  assert.equal(r.exit, 0);
  assert.deepEqual(r.newNegatives.map((f) => f.item), ["d"]);
  assert.match(r.lines.join("\n"), /verworfen/i);
});

test("compare: a run that fails fails the eval (no silent pass)", async () => {
  const broken: Ask = async () => {
    throw new Error("kaputt");
  };
  const r = await compareInstructions({ adapter: toy, cases, before: "a", after: "b", runs: 1, ask: broken });
  assert.equal(r.exit, 1);
  assert.match(r.errors.join("\n"), /kaputt/);
});

test("compare: no cases — nothing to compare, exit 0, no AI call", async () => {
  let calls = 0;
  const r = await compareInstructions({ adapter: toy, cases: [], before: "a", after: "b", runs: 2, ask: async () => (calls++, {}) });
  assert.equal(r.exit, 0);
  assert.equal(calls, 0);
  assert.match(r.lines.join("\n"), /nichts zu vergleichen/);
});

test("golden: labels merge must > negative > open; verdicts of another source (the ai_feedback ledger later) override the derived ones", () => {
  assert.equal(mergeLabel("open", "must"), "must");
  assert.equal(mergeLabel("negative", "open"), "negative");
  assert.equal(mergeLabel("must", "negative"), "must");
  assert.equal(mergeLabel(undefined, "open"), "open");
  const r = applyVerdicts(
    [{ id: "c1", input: {}, labels: { a: "open", b: "must" } }],
    [
      { step: "toy", item: "a", label: "negative" },
      { step: "toy", item: "zzz", label: "must" },
      { step: "other", item: "b", label: "negative" },
    ],
    "toy",
  );
  assert.deepEqual(r.cases[0].labels, { a: "negative", b: "must" });
  assert.equal(r.applied, 1);
  assert.deepEqual(r.unplaced, ["zzz"]);
});

test("golden: written and read back as a versioned file; a missing one is null", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-golden-"));
  try {
    const file = path.join(dir, "default", "toy.json");
    assert.equal(readGolden(file), null);
    writeGolden(file, { step: "toy", account: "default", cases });
    const back = readGolden<Toy>(file)!;
    assert.equal(back.step, "toy");
    assert.equal(back.version, 1);
    assert.ok(back.builtAt);
    assert.deepEqual(back.cases, cases);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("args: step, account, runs (1–5), base, fixtures, live, dry run", () => {
  assert.deepEqual(parseEvalArgs(["mail"]), { command: "mail", account: "all", runs: 2, base: "HEAD", live: false, dry: false, fake: null, fixtures: null });
  const a = parseEvalArgs(["people", "--account", "x", "--runs", "9", "--base", "master~1", "--live", "--dry-run", "--fixtures", "d"]);
  assert.equal(a.command, "people");
  assert.equal(a.account, "x");
  assert.equal(a.runs, 5);
  assert.equal(a.base, "master~1");
  assert.equal(a.live, true);
  assert.equal(a.dry, true);
  assert.equal(a.fixtures, "d");
  assert.equal(parseEvalArgs([]).command, "list");
  assert.equal(parseEvalArgs(["--runs", "0", "build"]).runs, 1);
  assert.equal(parseEvalArgs(["--runs", "0", "build"]).command, "build");
});
