/**
 * Before/after of the Mail-Durchsicht's prompt on your real mails: no change may make a run worse.
 *
 *   npm run eval:mail -- [--account default|<id>|all] [--runs 2] [--base HEAD]
 *
 * The mails behind the review's past todos are its test set — behind one you did: it should make a
 * todo (want); behind one you dropped: it shouldn't (drop); behind one still open: unknown (open);
 * must-do mails (mandatory trainings, signatures) always. "before" is the prompt at --base (a git
 * ref, default HEAD), "after" the one in the working tree, both through the same chain (the filter,
 * the marks, the lists of what you dropped and did, the safety net). On a copy of each account's
 * database, without the review's past todos (else those lists would give the answers away). The
 * copy is deleted afterwards — it holds your mail.
 *
 * Costs AI calls (1 + runs per account), on the account's own AI backend for the Mail-Durchsicht.
 * Exit code 1 when "after" lost a mail "before" covered (want/open/must) in any run.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const account = opt("account", "all");
const runs = Math.max(1, Math.min(5, Number(opt("runs", "2")) || 2));
const base = opt("base", "HEAD");
const ROOT = process.cwd();
const BASE_DB = process.env.ZEFF_EVAL_DB_ROOT ?? path.join(ROOT, "data");

/** One account's database file. */
const dbOf = (id: string) => (id === "default" ? path.join(BASE_DB, "zeff.db") : path.join(BASE_DB, "accounts", id, "zeff.db"));

// All accounts: one process each (each its own database from the first import on).
if (account === "all" && !process.env.ZEFF_EVAL_CHILD) {
  let ids = ["default"];
  try {
    ids = (JSON.parse(fs.readFileSync(path.join(BASE_DB, "accounts.json"), "utf8")).accounts as { id: string }[]).map((a) => a.id);
  } catch {
    // just the first one
  }
  let failed = false;
  for (const id of ids.filter((x) => fs.existsSync(dbOf(x)))) {
    const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], "--account", id, "--runs", String(runs), "--base", base], { stdio: "inherit", env: { ...process.env, ZEFF_EVAL_CHILD: "1" } });
    if (r.status !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

const id = account === "all" ? "default" : account;
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
  const { runAi } = await import("@/lib/ai");
  const { droppedByYou, lastGoodRun, listTodos } = await import("@/lib/boards/store");
  const { mailReviewPrompt, mustDo, mustDoLeftOut, notForReview, verdictLines, MAIL_REVIEW_SCHEMA } = await import("@/lib/boards/mail-todos");
  const { isInstalled } = await import("@/plugins/state");

  const instructionsOf = (src: string) => {
    const a = src.indexOf("const INSTRUCTIONS = `") + "const INSTRUCTIONS = `".length;
    return src.slice(a, src.indexOf("`;", a));
  };
  const file = "src/lib/boards/mail-todos.ts";
  const before = instructionsOf(execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" }));
  const after = instructionsOf(fs.readFileSync(path.join(ROOT, file), "utf8"));

  type Mail = { key: string; folder: string; fromName: string | null; fromEmail: string | null; subject: string; preview: string; receivedAt: string };
  const db = getSqlite();
  const rows = db
    .prepare(
      `select t.status, t.refs, (select e.actor from todo_events e where e.todo_id = t.id and e.event in ('done','dismissed') order by e.id desc limit 1) as by
       from todos t where t.source = 'Mail-Durchsicht'`,
    )
    .all() as { status: string; refs: string; by: string | null }[];
  const label = new Map<string, "want" | "drop" | "open">();
  const rank = { want: 3, drop: 2, open: 1 } as const;
  for (const r of rows) {
    const l = r.status === "done" ? "want" : r.status === "dismissed" && r.by === "you" ? "drop" : r.status === "open" ? "open" : null;
    if (!l) continue;
    for (const ref of JSON.parse(r.refs) as string[])
      if (ref.startsWith("mail:") && (!label.has(ref.slice(5)) || rank[l] > rank[label.get(ref.slice(5))!])) label.set(ref.slice(5), l);
  }
  const get = db.prepare("select key, folder, from_name as fromName, from_email as fromEmail, subject, preview, received_at as receivedAt from emails where key = ?");
  const all = [...label.keys()].map((k) => get.get(k) as Mail | undefined).filter((m): m is Mail => !!m).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).slice(-150);
  if (!all.length) {
    console.log(`[${id}] Keine Mails hinter Vorschlägen der Mail-Durchsicht — nichts zu vergleichen.`);
  } else {
    const mails = all.filter((m) => !notForReview(m, isInstalled("gitlab")));
    // As before those todos existed.
    db.prepare("delete from todos where source = 'Mail-Durchsicht'").run();
    const tickets = (lastGoodRun()?.tickets ?? []).map((t) => `- ${t.key}`);
    const open = listTodos({ status: "open" });
    const verdicts = verdictLines(droppedByYou());
    const keyOf = (r: unknown) => String(r).trim().replace(/^\[|\]$/g, "").replace(/^mail:/, "");

    const run = async (instructions: string) => {
      const answer = await runAi<{ todos?: { refs?: string[] }[]; updates?: { refs?: string[] }[] }>(mailReviewPrompt({ instructions, tickets, open, verdicts, mails }), MAIL_REVIEW_SCHEMA, {
        task: "mail-todos",
        timeoutMs: 10 * 60000,
        maxBudgetUsd: 1,
      });
      if (!answer.output) throw new Error("Die KI hat nichts Lesbares geantwortet.");
      const covered = new Set([...(answer.output.todos ?? []), ...(answer.output.updates ?? [])].flatMap((t) => (t.refs ?? []).map(keyOf)));
      for (const left of mustDoLeftOut(mails, covered, open, (k) => mails.find((m) => m.key === k))) for (const m of left.mails) covered.add(m.key);
      return { covered, model: answer.model };
    };

    const count = (covered: Set<string>, l: string) => `${mails.filter((m) => label.get(m.key) === l && covered.has(m.key)).length}/${mails.filter((m) => label.get(m.key) === l).length}`;
    const must = (covered: Set<string>) => `${mails.filter((m) => mustDo(m) && covered.has(m.key)).length}/${mails.filter(mustDo).length}`;
    const line = (name: string, c: Set<string>) => `  ${name.padEnd(10)} erledigte ${count(c, "want").padStart(5)} · offene ${count(c, "open").padStart(5)} · Pflicht ${must(c).padStart(5)} · verworfene ${count(c, "drop").padStart(5)}`;

    console.log(`[${id}] ${mails.length} Mails (${all.length - mails.length} vom Filter aussortiert) · Prompt vorher: ${base} · nachher: Arbeitskopie`);
    const b = await run(before);
    console.log(line("vorher", b.covered), `(${b.model ?? "?"})`);
    const lost = new Map<string, Mail>();
    for (let i = 1; i <= runs; i++) {
      const a = await run(after);
      console.log(line(`nachher ${i}`, a.covered));
      for (const m of mails) if (label.get(m.key) !== "drop" && b.covered.has(m.key) && !a.covered.has(m.key)) lost.set(m.key, m);
    }
    if (lost.size) {
      exit = 1;
      console.log(`  VERLOREN (${lost.size}) — vorher gefunden, nachher nicht:`);
      for (const m of lost.values()) console.log(`    - ${label.get(m.key)}${mustDo(m) ? ", Pflicht" : ""}: ${m.fromName ?? m.fromEmail ?? "?"} „${m.subject.slice(0, 70)}“`);
    } else console.log("  Nichts verloren.");
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
