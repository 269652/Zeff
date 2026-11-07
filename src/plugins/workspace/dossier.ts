import { createHash } from "node:crypto";
import { dataDir, getSqlite } from "@/db";
import { runAi } from "@/lib/ai";
import { promptText } from "@/lib/prompts";
import { wordsOf } from "@/lib/rag";
import { docText } from "./doc";
import { cellText } from "./model";
import { WORKSPACE_DIGEST, WORKSPACE_DOSSIER, WORKSPACE_SOURCES_ASK } from "./prompts";
import { getDatabase, getPage, rawRows } from "./store";

/**
 * A database as a body of knowledge (<ask>, <dossier> in a view, the tools of the chat and of agents): its rows are the sources. Each
 * is boiled down to a digest once, kept by a hash of its text, so only what changed costs anything; the digests are compiled into the
 * database's dossier. A question is answered from the rows that fit, naming them. The AI runs closed here — no tools, the sources are
 * data — so what a source says can't make it do anything. Server only.
 */

/** A text this short is its own digest: no AI for it. */
const SHORT = 1500;
const MAX_SOURCE = 20000;
/** Digests one run makes at most: a big collection comes in over several runs, and what is done stays done. */
export const MAX_DIGESTS = 25;
const MAX_ASK_ROWS = 12;
const MAX_ASK_TEXT = 30000;
const MAX_DOSSIER_INPUT = 60000;

export type Ask = (prompt: string, schema: object, budgetUsd: number) => Promise<Record<string, unknown>>;

const askAi: Ask = async (prompt, schema, budgetUsd) => (await runAi<Record<string, unknown>>(prompt, schema, { task: "workspace-dossier", timeoutMs: 4 * 60000, maxBudgetUsd: budgetUsd })).output ?? {};

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists ws_digests (row_id integer primary key, db_id integer not null, hash text not null, digest text not null);
    create index if not exists ws_digests_db on ws_digests (db_id);
    create table if not exists ws_dossiers (db_id integer primary key, markdown text not null default '', hash text not null default '', focus text not null default '', compiled_at text);
  `);
  return d;
}

const hashOf = (s: string) => createHash("sha1").update(s).digest("hex");

export type Source = { id: number; title: string; text: string };

/** The rows as text: their fields, then what their pages say. */
export function sourcesOf(dbId: number): Source[] {
  const d = getDatabase(dbId);
  if (!d) throw new Error("The database is gone.");
  return rawRows(dbId).map((r) => {
    const fields = d.schema.properties.flatMap((p) => {
      const v = cellText(p, r.cells[p.id]);
      return v ? [`${p.name}: ${v}`] : [];
    });
    return { id: r.id, title: r.title || "Untitled", text: [...fields, docText(getPage(r.id)?.content)].filter((x) => x.trim()).join("\n").slice(0, MAX_SOURCE) };
  });
}

// ---------------------------------------------------------------------------
// The dossier
// ---------------------------------------------------------------------------

export type Dossier = { markdown: string; focus: string; compiledAt: string | null; rows: number; /** Rows whose digest is missing or old. */ pending: number; /** The dossier doesn't hold what the digests say yet. */ stale: boolean };

type Stored = { row_id: number; hash: string; digest: string };
const digests = (dbId: number) => new Map((db().prepare("select row_id, hash, digest from ws_digests where db_id = ?").all(dbId) as Stored[]).map((x) => [x.row_id, x]));
const stored = (dbId: number) => db().prepare("select markdown, hash, focus, compiled_at from ws_dossiers where db_id = ?").get(dbId) as { markdown: string; hash: string; focus: string; compiled_at: string | null } | undefined;
const hashOfDigests = (sources: Source[], kept: Map<number, Stored>, focus: string) => hashOf([focus, ...sources.map((s) => `${s.id}:${kept.get(s.id)?.hash ?? ""}`)].join("\n"));

export function dossierOf(dbId: number): Dossier {
  const sources = sourcesOf(dbId);
  const kept = digests(dbId);
  const d = stored(dbId);
  const pending = sources.filter((s) => kept.get(s.id)?.hash !== hashOf(s.text)).length;
  return { markdown: d?.markdown ?? "", focus: d?.focus ?? "", compiledAt: d?.compiled_at ?? null, rows: sources.length, pending, stale: pending > 0 || (d?.hash ?? "") !== hashOfDigests(sources, kept, d?.focus ?? "") };
}

const textOf = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The digests that are missing, then — when any of them changed — the dossier. What it did; `left`: digests for the next run. */
export async function compileDatabase(dbId: number, opts: { focus?: string; ask?: Ask; onProgress?: (done: number, of: number) => void } = {}): Promise<{ digested: number; left: number; compiled: boolean }> {
  const ask = opts.ask ?? askAi;
  const sources = sourcesOf(dbId);
  const d = db();
  const here = new Set(sources.map((s) => s.id));
  for (const x of digests(dbId).keys()) if (!here.has(x)) d.prepare("delete from ws_digests where row_id = ?").run(x);
  const focus = (opts.focus ?? stored(dbId)?.focus ?? "").trim().slice(0, 500);
  const kept = digests(dbId);
  const todo = sources.filter((s) => s.text.trim() && kept.get(s.id)?.hash !== hashOf(s.text));
  const now = todo.slice(0, MAX_DIGESTS);
  let done = 0;
  for (const s of now) {
    opts.onProgress?.(done, now.length);
    const digest = s.text.length <= SHORT ? s.text : textOf((await ask(`${promptText("workspace-digest", WORKSPACE_DIGEST)}\n\n# Quelle: ${s.title}\n${s.text}`, { type: "object", required: ["digest"], properties: { digest: { type: "string" } } }, 0.1)).digest);
    if (!digest) throw new Error(`No digest came for “${s.title}”.`);
    d.prepare("insert into ws_digests (row_id, db_id, hash, digest) values (?, ?, ?, ?) on conflict (row_id) do update set hash = excluded.hash, digest = excluded.digest").run(s.id, dbId, hashOf(s.text), digest);
    done++;
  }
  const left = todo.length - now.length;
  const after = digests(dbId);
  const usable = sources.filter((s) => after.has(s.id));
  const hash = hashOfDigests(sources, after, focus);
  // Not with some still missing: it would be redone next time anyway.
  if (left > 0 || !usable.length || stored(dbId)?.hash === hash) return { digested: done, left, compiled: false };
  opts.onProgress?.(done, now.length);
  const input = usable.map((s) => `## [${s.id}] ${s.title}\n${after.get(s.id)!.digest}`).join("\n\n").slice(0, MAX_DOSSIER_INPUT);
  const title = getDatabase(dbId)?.page.title ?? "";
  const markdown = textOf((await ask(`${promptText("workspace-dossier", WORKSPACE_DOSSIER)}${focus ? `\n\n# Worauf es ankommt\n${focus}` : ""}\n\n# Sammlung: ${title}\n\n${input}`, { type: "object", required: ["markdown"], properties: { markdown: { type: "string" } } }, 0.5)).markdown);
  if (!markdown) throw new Error("No dossier came.");
  d.prepare("insert into ws_dossiers (db_id, markdown, hash, focus, compiled_at) values (?, ?, ?, ?, ?) on conflict (db_id) do update set markdown = excluded.markdown, hash = excluded.hash, focus = excluded.focus, compiled_at = excluded.compiled_at").run(dbId, markdown, hash, focus, new Date().toISOString());
  return { digested: done, left, compiled: true };
}

// A run in the background: it takes minutes, the page asks how far it is. In this server's memory.
export type DossierJob = { running: boolean; done: number; of: number; error?: string; left?: number };
const g = globalThis as { __zeffDossierJobs?: Map<string, DossierJob> };
const jobs = () => (g.__zeffDossierJobs ??= new Map());
const jobKey = (dbId: number) => `${dataDir()}:${dbId}`;

export const dossierJob = (dbId: number): DossierJob | null => jobs().get(jobKey(dbId)) ?? null;

export function startDossier(dbId: number, focus?: string): void {
  const key = jobKey(dbId);
  if (jobs().get(key)?.running) return;
  const job: DossierJob = { running: true, done: 0, of: 0 };
  jobs().set(key, job);
  void compileDatabase(dbId, { focus, onProgress: (done, of) => Object.assign(job, { done, of }) }).then(
    (r) => Object.assign(job, { running: false, left: r.left }),
    (e: unknown) => Object.assign(job, { running: false, error: e instanceof Error ? e.message : String(e) }),
  );
}

// ---------------------------------------------------------------------------
// A question
// ---------------------------------------------------------------------------

export type DatabaseAnswer = { answer: string; sources: { n: number; id: number; title: string }[] };

/** The rows that fit the question, best first: any of its words, by their beginnings. */
function rowsFor(dbId: number, question: string, sources: Source[]): Source[] {
  // A small collection is read whole: a question across it (where do they differ?) finds its words in only some of them.
  if (sources.length <= MAX_ASK_ROWS) return sources;
  const words = wordsOf(question).map((w) => w.replace(/["*]/g, "")).filter(Boolean);
  let ids: number[] = [];
  if (words.length) {
    try {
      ids = (db().prepare("select p.id from ws_fts join ws_pages p on p.id = ws_fts.rowid where ws_fts match ? and p.db_id = ? and p.archived_at is null order by rank limit ?").all(words.map((w) => `"${w}"*`).join(" OR "), dbId, MAX_ASK_ROWS) as { id: number }[]).map((x) => x.id);
    } catch {
      ids = [];
    }
  }
  const byId = new Map(sources.map((s) => [s.id, s]));
  const found = ids.flatMap((id) => byId.get(id) ?? []);
  return found;
}

export async function askDatabase(dbId: number, question: string, ask: Ask = askAi): Promise<DatabaseAnswer> {
  const q = question.trim().slice(0, 1000);
  if (q.length < 3) throw new Error("Ask a question.");
  const sources = sourcesOf(dbId).filter((s) => s.text.trim() || s.title);
  const rows = rowsFor(dbId, q, sources);
  const dossier = stored(dbId)?.markdown ?? "";
  if (!rows.length && !dossier) return { answer: "", sources: [] };
  const each = Math.floor(MAX_ASK_TEXT / Math.max(rows.length, 1));
  const material = rows.map((s, i) => `## Quelle [${i + 1}]: ${s.title}\n${s.text.slice(0, each)}`).join("\n\n");
  const r = await ask(
    [promptText("workspace-sources-ask", WORKSPACE_SOURCES_ASK), `# Frage\n${q}`, ...(dossier ? [`# Überblick über die Sammlung (keine Quelle zum Zitieren)\n${dossier.slice(0, 8000)}`] : []), `# Quellen\n${material}`].join("\n\n"),
    { type: "object", required: ["answer", "sources"], properties: { answer: { type: "string" }, sources: { type: "array", items: { type: "integer" } } } },
    0.3,
  );
  const answer = textOf(r.answer);
  const cited = new Set([...(Array.isArray(r.sources) ? r.sources.map(Number) : []), ...[...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))]);
  return { answer, sources: rows.flatMap((s, i) => (cited.has(i + 1) ? [{ n: i + 1, id: s.id, title: s.title }] : [])) };
}
