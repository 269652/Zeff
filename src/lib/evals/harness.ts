/**
 * The eval harness: a before/after of an AI step's prompt on cases with known answers — "a prompt change must not
 * make a run worse". Each step plugs in as an adapter (see adapters/): it builds its cases (the frozen context a run
 * of the step would see, and the items the user already judged), runs its own prompt builder and the AI with given
 * instructions, and says which items the answer covers (a mail a todo was made of, a person a claim was found about,
 * a todo that got actions). The harness runs the instructions at the base ref once ("before") and the working tree's
 * N times ("after") and compares: a must-have or open item "before" covered and any "after" run missed is LOST (exit
 * 1 — recall first, AI answers vary, so one miss is enough); what only "after" found is GAINED; a negative (something
 * the user dropped) newly found is reported as worse precision, never as a failure. Pure: no database, no AI of its
 * own — the AI is the `ask` given in (the real one in scripts/eval.mts, a fake in the tests).
 */

/** How the user judged an item: must (kept, done, confirmed), open (not judged yet — counted like must for losses), negative (dropped, rejected). */
export type Label = "must" | "open" | "negative";

/** One case: the frozen input of one run of the step (a batch), and the items judged in it. */
export type EvalCase<I = unknown> = { id: string; input: I; labels: Record<string, Label>; /** What an item is, for the report ("Anna „Rechnung“"). */ what?: Record<string, string> };

/** The AI: a prompt and a JSON schema in, the parsed answer out. */
export type Ask = (prompt: string, schema: object, opts: { task: string; step: string }) => Promise<unknown>;

/** An AI step as the harness runs it. */
export type EvalAdapter<I = unknown> = {
  /** The name on the command line (npm run eval -- <step>). */
  step: string;
  title: string;
  /** Its LLM task (llm-tasks.ts): the backend and model the account set for the step. */
  task: string;
  /** Where its instructions are: a template literal constant (default INSTRUCTIONS) in this file. */
  prompt: { file: string; name?: string };
  /** The most one AI call may cost (its maxBudgetUsd) — the report's cost cap. */
  costUsd: number;
  /** The cases, from the database the process has open (a snapshot of the account's). */
  build(): Promise<EvalCase<I>[]>;
  /** One run of the step on a case with these instructions: the items its answer covers. */
  run(c: EvalCase<I>, instructions: string, ask: Ask): Promise<Set<string>>;
  /** An item for the report (default: the case's `what`, else the item itself). */
  describe?(item: string, c: EvalCase<I>): string;
};

export type Tally = { hit: number; total: number };
export type Score = { must: Tally; open: Tally; negative: Tally; /** Covered items nobody judged. */ unlabeled: number; /** must-haves covered / must-haves (null: none). */ recall: number | null; /** judged covered items that weren't negatives (null: none covered). */ precision: number | null };

/** How well one answer covers the labels. Open items count neither for recall nor precision (not judged yet). */
export function score(labels: Record<string, Label>, covered: Set<string>): Score {
  const t = (l: Label): Tally => {
    const items = Object.keys(labels).filter((k) => labels[k] === l);
    return { hit: items.filter((k) => covered.has(k)).length, total: items.length };
  };
  const must = t("must");
  const open = t("open");
  const negative = t("negative");
  const unlabeled = [...covered].filter((k) => !(k in labels)).length;
  const judged = must.hit + negative.hit;
  return { must, open, negative, unlabeled, recall: must.total ? must.hit / must.total : null, precision: judged ? must.hit / judged : null };
}

/** Scores of several cases added up. */
function sum(scores: Score[]): Score {
  const add = (k: "must" | "open" | "negative"): Tally => ({ hit: scores.reduce((n, s) => n + s[k].hit, 0), total: scores.reduce((n, s) => n + s[k].total, 0) });
  const must = add("must");
  const negative = add("negative");
  const judged = must.hit + negative.hit;
  return { must, open: add("open"), negative, unlabeled: scores.reduce((n, s) => n + s.unlabeled, 0), recall: must.total ? must.hit / must.total : null, precision: judged ? must.hit / judged : null };
}

/**
 * A step's instructions out of its source text: the template literal `const <name> = \`…\`` (exported or not). One
 * with placeholders (${…}) can't be read without running it — an error, as is none at all.
 */
export function instructionsIn(source: string, name = "INSTRUCTIONS"): string {
  const m = new RegExp(`const ${name} = \``).exec(source);
  if (!m) throw new Error(`${name} nicht gefunden.`);
  const start = m.index + m[0].length;
  let end = start;
  // The closing backtick: the first one not escaped.
  while (end < source.length && !(source[end] === "`" && source[end - 1] !== "\\")) end++;
  const raw = source.slice(start, end);
  if (raw.includes("${")) throw new Error(`${name} hat placeholder (\${…}) — so nicht lesbar.`);
  return raw.replace(/\\([`$\\])/g, "$1");
}

export type Finding = { case: string; item: string; label: Label; what: string };
export type EvalResult = { lost: Finding[]; gained: Finding[]; newNegatives: Finding[]; errors: string[]; before: Score; after: Score[]; calls: number; exit: 0 | 1; lines: string[] };

const pct = (t: Tally) => `${t.hit}/${t.total}`.padStart(7);

/**
 * Before/after: every case once with `before`, `runs` times with `after`. Exit 1 on a lost item or a failed run.
 * `log`: each line as it comes (the CLI prints it), besides `lines` at the end.
 */
export async function compareInstructions<I>(o: { adapter: EvalAdapter<I>; cases: EvalCase<I>[]; before: string; after: string; runs: number; ask: Ask; log?: (line: string) => void }): Promise<EvalResult> {
  const lines: string[] = [];
  const say = (l: string) => {
    lines.push(l);
    o.log?.(l);
  };
  const { adapter, cases } = o;
  const out: EvalResult = { lost: [], gained: [], newNegatives: [], errors: [], before: sum([]), after: [], calls: 0, exit: 0, lines };
  if (!cases.length) {
    say(`  ${adapter.title}: keine Fälle — nichts zu vergleichen.`);
    return out;
  }
  const what = (c: EvalCase<I>, item: string) => adapter.describe?.(item, c) ?? c.what?.[item] ?? item;
  const finding = (c: EvalCase<I>, item: string): Finding => ({ case: c.id, item, label: c.labels[item], what: what(c, item) });
  const ask: Ask = (p, s, x) => {
    out.calls++;
    return o.ask(p, s, x);
  };
  const runOnce = async (c: EvalCase<I>, instructions: string): Promise<Set<string> | null> => {
    try {
      return await adapter.run(c, instructions, ask);
    } catch (e) {
      out.errors.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
  const line = (name: string, s: Score) => `  ${name.padEnd(10)} behalten ${pct(s.must)} · offen ${pct(s.open)} · verworfen ${pct(s.negative)} · ungewertet ${String(s.unlabeled).padStart(3)}`;

  const before = new Map<string, Set<string>>();
  for (const c of cases) before.set(c.id, (await runOnce(c, o.before)) ?? new Set());
  out.before = sum(cases.map((c) => score(c.labels, before.get(c.id)!)));
  say(line("vorher", out.before));
  const lost = new Map<string, Finding>();
  const gained = new Map<string, Finding>();
  const negatives = new Map<string, Finding>();
  for (let i = 1; i <= Math.max(1, o.runs); i++) {
    const scores: Score[] = [];
    for (const c of cases) {
      const a = await runOnce(c, o.after);
      if (!a) continue;
      const b = before.get(c.id)!;
      scores.push(score(c.labels, a));
      for (const [item, label] of Object.entries(c.labels)) {
        const key = `${c.id}\u0000${item}`;
        if (label !== "negative" && b.has(item) && !a.has(item)) lost.set(key, finding(c, item));
        if (label !== "negative" && !b.has(item) && a.has(item)) gained.set(key, finding(c, item));
        if (label === "negative" && !b.has(item) && a.has(item)) negatives.set(key, finding(c, item));
      }
    }
    const s = sum(scores);
    out.after.push(s);
    say(line(`nachher ${i}`, s));
  }
  out.lost = [...lost.values()];
  out.gained = [...gained.values()];
  out.newNegatives = [...negatives.values()];
  if (out.lost.length) {
    say(`  VERLOREN (${out.lost.length}) — vorher gefunden, nachher nicht:`);
    for (const f of out.lost) say(`    - ${f.label}: ${f.what}`);
  } else say("  Nichts verloren.");
  if (out.gained.length) {
    say(`  GEWONNEN (${out.gained.length}) — nur nachher gefunden:`);
    for (const f of out.gained) say(`    + ${f.label}: ${f.what}`);
  }
  if (out.newNegatives.length) {
    say(`  Neu gefunden, aber von dir verworfen (${out.newNegatives.length}) — schlechtere Präzision, kein Fehler:`);
    for (const f of out.newNegatives) say(`    ~ ${f.what}`);
  }
  if (out.errors.length) {
    say(`  FEHLER (${out.errors.length}):`);
    for (const e of out.errors) say(`    ! ${e}`);
  }
  out.exit = out.lost.length || out.errors.length ? 1 : 0;
  return out;
}
