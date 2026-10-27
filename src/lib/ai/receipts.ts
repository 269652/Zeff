import { getSqlite } from "@/db";
import { REDACTED } from "@/lib/boundaries/shared";
import { currentAccountId } from "@/db/accounts";

/**
 * What left this PC, provably: every text an AI step sent (plugins/llm/run.ts) — which step, to which AI and model, how much, how
 * many lines of secret sources and databases were left out of it — kept here, to look at (Privacy → What went to the AI) and to
 * export as a month's report. Only on this PC; kept 30 days. Server only.
 */

const KEEP_DAYS = 30;
const MAX_TEXT = 60_000;

export type Receipt = { id: number; at: string; task: string; provider: string; model: string | null; chars: number; redacted: number };

/** Done for these accounts' databases (each its own — two accounts run side by side). */
const ready = new Set<string>();
function db() {
  const d = getSqlite();
  if (ready.has(currentAccountId())) return d;
  d.exec(`
    create table if not exists ai_receipts (id integer primary key autoincrement, at text not null, task text not null, provider text not null, model text, chars integer not null, redacted integer not null default 0, text text not null);
    create index if not exists ai_receipts_at on ai_receipts (at);
  `);
  ready.add(currentAccountId());
  return d;
}

/** How many lines a guard left out: its marks in what went that weren't in what it got. */
export function countRedactions(before: string, after: string): number {
  const n = (s: string) => s.split(REDACTED).length - 1;
  return Math.max(0, n(after) - n(before));
}

/** A text sent to an AI, kept as it went (the first 60.000 characters). Never stops the call. */
export function recordReceipt(r: { task: string; provider: string; model: string | null | undefined; text: string; redacted: number }): void {
  try {
    db().prepare("insert into ai_receipts (at, task, provider, model, chars, redacted, text) values (?, ?, ?, ?, ?, ?, ?)").run(new Date().toISOString(), r.task, r.provider, r.model ?? null, r.text.length, r.redacted, r.text.slice(0, MAX_TEXT));
    if (Math.random() < 0.02) pruneReceipts();
  } catch (e) {
    console.warn("[ai receipts]", e instanceof Error ? e.message : e);
  }
}

/** The receipts of the last days, newest first. */
export function listReceipts(opts: { days?: number; limit?: number; task?: string } = {}): Receipt[] {
  const since = new Date(Date.now() - (opts.days ?? KEEP_DAYS) * 864e5).toISOString();
  return (
    db()
      .prepare("select id, at, task, provider, model, chars, redacted from ai_receipts where at >= ? and (? is null or task = ?) order by at desc, id desc limit ?")
      .all(since, opts.task ?? null, opts.task ?? null, opts.limit ?? 500) as Receipt[]
  ).map((r) => ({ ...r }));
}

/** The text a receipt kept — what went. */
export const receiptText = (id: number): string | null => (db().prepare("select text from ai_receipts where id = ?").get(id) as { text: string } | undefined)?.text ?? null;

/** Per day and per step: how many texts, how many characters, how many secret lines left out — for the overview. */
export function receiptSummary(days = KEEP_DAYS): { task: string; provider: string; calls: number; chars: number; redacted: number }[] {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  return db().prepare("select task, provider, count(*) calls, sum(chars) chars, sum(redacted) redacted from ai_receipts where at >= ? group by task, provider order by calls desc").all(since) as { task: string; provider: string; calls: number; chars: number; redacted: number }[];
}

/** A month's receipts as a report (Markdown): every text that went, with when, which step, which AI. */
export function exportReceipts(month: string): string {
  const rows = db().prepare("select at, task, provider, model, chars, redacted, text from ai_receipts where substr(at, 1, 7) = ? order by at").all(month) as (Receipt & { text: string })[];
  const head = [`# Zeff — what went to the AI, ${month}`, "", `${rows.length} texts · ${rows.reduce((s, r) => s + r.chars, 0)} characters · ${rows.reduce((s, r) => s + r.redacted, 0)} secret lines left out`, ""];
  const body = rows.flatMap((r) => [`## ${r.at.replace("T", " ").slice(0, 19)} · ${r.task} · ${r.provider}${r.model ? ` (${r.model})` : ""}`, "", `${r.chars} characters${r.redacted ? ` · ${r.redacted} secret lines left out` : ""}`, "", "```", r.text.replaceAll("```", "ʼʼʼ"), "```", ""]);
  return [...head, ...body].join("\n");
}

/** Receipts older than 30 days removed. */
export function pruneReceipts(): void {
  db().prepare("delete from ai_receipts where at < ?").run(new Date(Date.now() - KEEP_DAYS * 864e5).toISOString());
}
