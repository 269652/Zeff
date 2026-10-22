/**
 * Building the golden sets: every adapter's cases from the database the process has open (a snapshot of an
 * account's), the verdicts of other sources laid over them, each written to <dir>/<account>/<step>.json. A step
 * without cases (nothing of it judged yet) writes no file and leaves an older one as it is (your decisions then);
 * a rebuild with cases replaces it.
 */
import { applyVerdicts, goldenPath, writeGolden, type VerdictSource } from "./golden";
import type { EvalAdapter } from "./harness";

export type BuiltSet = { step: string; file: string | null; cases: number; items: number; applied: number; unplaced: number; error?: string };

export async function buildGoldenSets(o: { adapters: EvalAdapter<never>[]; dir: string; account: string; sources?: VerdictSource[] }): Promise<BuiltSet[]> {
  const out: BuiltSet[] = [];
  for (const a of o.adapters) {
    try {
      let cases = await a.build();
      let applied = 0;
      let unplaced = 0;
      for (const s of o.sources ?? []) {
        const r = applyVerdicts(cases, s.verdicts(a.step), a.step);
        cases = r.cases;
        applied += r.applied;
        unplaced += r.unplaced.length;
      }
      const items = cases.reduce((n, c) => n + Object.keys(c.labels).length, 0);
      if (!cases.length) {
        out.push({ step: a.step, file: null, cases: 0, items: 0, applied, unplaced });
        continue;
      }
      const file = goldenPath(o.dir, o.account, a.step);
      writeGolden(file, { step: a.step, account: o.account, cases, sources: ["rules", ...(o.sources ?? []).map((s) => s.name)] });
      out.push({ step: a.step, file, cases: cases.length, items, applied, unplaced });
    } catch (e) {
      out.push({ step: a.step, file: null, cases: 0, items: 0, applied: 0, unplaced: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
