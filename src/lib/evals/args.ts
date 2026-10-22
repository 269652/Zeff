/** The eval CLI's arguments (scripts/eval.mts): `<step|all|build|list> [--account default|<id>|all] [--runs N] [--base ref] [--fixtures dir] [--live] [--dry-run]`. */
export type EvalArgs = {
  /** A step (mail, notes, people, auto-actions), all, build (the golden sets), list. */
  command: string;
  account: string;
  /** "after" runs per case, 1–5 (the "before" runs once). */
  runs: number;
  /** The git ref whose prompt is "before". */
  base: string;
  /** Where the golden sets are (default data/evals). */
  fixtures: string | null;
  /** Cases straight from the snapshot, not the golden set. */
  live: boolean;
  /** Only show the cases and what a run would cost — no AI. */
  dry: boolean;
  /** Tests only: a module whose default export is the AI (no real AI is called then). */
  fake: string | null;
};

const VALUED = new Set(["account", "runs", "base", "fixtures", "fake"]);

export function parseEvalArgs(argv: string[]): EvalArgs {
  const opts: Record<string, string> = {};
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (VALUED.has(name)) opts[name] = argv[++i] ?? "";
      else flags.add(name);
    } else positional.push(a);
  }
  const n = Number(opts.runs ?? "2");
  return {
    command: positional[0] ?? "list",
    account: opts.account || "all",
    runs: Math.max(1, Math.min(5, Number.isFinite(n) && opts.runs !== "" ? Math.trunc(n) : 2)),
    base: opts.base || "HEAD",
    fixtures: opts.fixtures || null,
    live: flags.has("live"),
    dry: flags.has("dry-run") || flags.has("dry"),
    fake: opts.fake || null,
  };
}
