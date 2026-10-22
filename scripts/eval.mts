/**
 * Before/after of an AI step's prompt on your own decisions: no prompt change may make a run worse.
 *
 *   npm run eval -- <step|all> [--account default|<id>|all] [--runs 2] [--base HEAD] [--live] [--dry-run] [--fixtures dir]
 *   npm run eval -- build [--account …]     the golden sets (data/evals/<account>/<step>.json) from your data
 *   npm run eval -- list                    the steps and their golden sets
 *
 * Steps: mail (Mail-Durchsicht), notes (Notiz-Durchsicht), people (Personen-Extraktion), auto-actions. "before" is
 * the step's instructions at --base (a git ref), "after" the working tree's; both through the step's own prompt
 * builder and the account's AI backend for the step, on the same frozen cases: the golden set if there is one (built
 * by `build`; --live: the cases straight from the data instead). On a copy of the account's database — deleted
 * afterwards, it holds your mail. Exit code 1 when "after" lost an item (must or open) "before" found, in any run,
 * or a run failed. See docs/evals.md.
 *
 * Costs AI calls: per step cases × (1 + runs), each at most the step's budget (printed first; --dry-run only that).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEvalArgs } from "@/lib/evals/args";

const args = parseEvalArgs(process.argv.slice(2));
const ROOT = process.cwd();
const BASE_DB = process.env.ZEFF_EVAL_DB_ROOT ?? path.join(ROOT, "data");
const FIXTURES = path.resolve(args.fixtures ?? path.join(ROOT, "data", "evals"));

/** One account's database file. */
const dbOf = (id: string) => (id === "default" ? path.join(BASE_DB, "zeff.db") : path.join(BASE_DB, "accounts", id, "zeff.db"));
const accounts = (): string[] => {
  try {
    return (JSON.parse(fs.readFileSync(path.join(BASE_DB, "accounts.json"), "utf8")).accounts as { id: string }[]).map((a) => a.id);
  } catch {
    return ["default"];
  }
};

if (args.command === "list") {
  // Nothing is opened: a database path that isn't there.
  process.env.DATABASE_PATH = path.join(os.tmpdir(), "zeff-eval-list-none", "zeff.db");
  const { EVAL_ADAPTERS } = await import("@/lib/evals");
  const { goldenPath, readGolden } = await import("@/lib/evals/golden");
  for (const a of EVAL_ADAPTERS) {
    const sets = accounts().map((id) => [id, readGolden(goldenPath(FIXTURES, id, a.step))] as const).filter(([, g]) => g);
    console.log(`${a.step.padEnd(14)} ${a.title.padEnd(22)} ${sets.length ? sets.map(([id, g]) => `${id}: ${g!.cases.length} Fälle vom ${g!.builtAt.slice(0, 10)}`).join(" · ") : "kein Golden Set (npm run eval -- build)"}`);
  }
  process.exit(0);
}

// All accounts: one process each (each its own database from the first import on).
if (args.account === "all" && !process.env.ZEFF_EVAL_CHILD) {
  let failed = false;
  const rest = process.argv.slice(2).filter((a, i, all) => a !== "--account" && all[i - 1] !== "--account");
  for (const id of accounts().filter((x) => fs.existsSync(dbOf(x)))) {
    const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], ...rest, "--account", id], { stdio: "inherit", env: { ...process.env, ZEFF_EVAL_CHILD: "1" } });
    if (r.status !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

const id = args.account === "all" ? "default" : args.account;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-eval-"));
let exit = 0;
let close = () => {};
try {
  // A consistent copy (the live one is in WAL mode, in use).
  const { default: Database } = await import("better-sqlite3");
  const live = new Database(dbOf(id), { readonly: true, fileMustExist: true });
  await live.backup(path.join(tmp, "zeff.db"));
  live.close();
  process.env.DATABASE_PATH = path.join(tmp, "zeff.db");
  process.env.ZEFF_TEAMS_SYNC = "off";

  const { getSqlite } = await import("@/db");
  close = () => getSqlite().close();
  const { EVAL_ADAPTERS, evalAdapter } = await import("@/lib/evals");
  const { compareInstructions, instructionsIn } = await import("@/lib/evals/harness");
  const { goldenPath, readGolden } = await import("@/lib/evals/golden");

  if (args.command === "build") {
    const { buildGoldenSets } = await import("@/lib/evals/build");
    // (The ai_feedback ledger joins here as a VerdictSource once it exists.)
    for (const r of await buildGoldenSets({ adapters: EVAL_ADAPTERS, dir: FIXTURES, account: id })) {
      if (r.error) exit = 1;
      console.log(`[${id}] ${r.step.padEnd(14)} ${r.error ? `FEHLER: ${r.error}` : r.file ? `${r.cases} Fälle, ${r.items} Items → ${path.relative(ROOT, r.file)}` : "nichts gewertet — kein Golden Set"}`);
    }
  } else {
    const steps = args.command === "all" ? EVAL_ADAPTERS : [evalAdapter(args.command)].filter((a) => !!a);
    if (!steps.length) throw new Error(`Unbekannter Schritt „${args.command}“ — npm run eval -- list`);
    const fake = args.fake ? ((await import(pathToFileURL(path.resolve(args.fake)).href)) as { default: (p: string, s: object, o: { task: string; step: string }) => Promise<unknown> }).default : null;
    const { runAi } = await import("@/lib/ai");
    for (const adapter of steps) {
      const golden = args.live ? null : readGolden<never>(goldenPath(FIXTURES, id, adapter.step));
      const cases = golden?.cases ?? (await adapter.build());
      const items = cases.reduce((n, c) => n + Object.keys(c.labels).length, 0);
      const calls = cases.length * (1 + args.runs);
      // What a call of the step cost you so far (the usage log), for an estimate besides the cap.
      let typical: number | null = null;
      try {
        typical = (getSqlite().prepare("select avg(cost) as c from ai_usage where task = ? and cost is not null").get(adapter.task) as { c: number | null } | undefined)?.c ?? null;
      } catch {
        // no usage log yet
      }
      console.log(
        `[${id}] ${adapter.title}: ${cases.length} Fälle, ${items} Items (${golden ? `Golden Set vom ${golden.builtAt.slice(0, 10)}` : "aus den aktuellen Daten"}) · Prompt vorher: ${args.base} · nachher: Arbeitskopie · ${calls} KI-Aufrufe, ${typical !== null ? `etwa $${(calls * typical).toFixed(2)} (` : ""}höchstens $${(calls * adapter.costUsd).toFixed(2)}${typical !== null ? ")" : ""}`,
      );
      if (args.dry || !cases.length) continue;
      const file = adapter.prompt.file;
      const before = instructionsIn(execFileSync("git", ["show", `${args.base}:${file}`], { encoding: "utf8" }), adapter.prompt.name);
      const after = instructionsIn(fs.readFileSync(path.join(ROOT, file), "utf8"), adapter.prompt.name);
      if (before === after) console.log("  (Prompt unverändert gegenüber der Basis — der Vergleich zeigt nur, wie sehr die KI schwankt.)");
      const ask = fake
        ? fake
        : async (prompt: string, schema: object, o: { task: string }) => {
            const answer = await runAi<unknown>(prompt, schema, { task: o.task as never, timeoutMs: 10 * 60000, maxBudgetUsd: adapter.costUsd });
            if (!answer.output) throw new Error("Die KI hat nichts Lesbares geantwortet.");
            return answer.output;
          };
      const r = await compareInstructions({ adapter, cases, before, after, runs: args.runs, ask, log: (l) => console.log(l) });
      if (r.exit) exit = 1;
    }
  }
} catch (e) {
  exit = 1;
  console.error(`[${id}]`, e instanceof Error ? e.message : e);
} finally {
  try {
    close();
  } catch {
    // not open
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(exit);
