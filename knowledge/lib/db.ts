import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * The knowledge server's database (knowledge/data/knowledge.db): the pages as read from
 * Confluence, cut into chunks for full-text search (FTS5), and what Copilot made of them — a
 * summary per page, the entities (systems, components, people, terms …) and their relations,
 * each with the page it comes from.
 */

/** The app's folder: started from Zeff's root (`next start knowledge`) or from knowledge/ itself. */
export const APP_DIR = (() => {
  if (process.env.KNOWLEDGE_DIR) return path.resolve(process.env.KNOWLEDGE_DIR);
  const cwd = process.cwd();
  return fs.existsSync(path.join(cwd, "knowledge", "next.config.ts")) ? path.join(cwd, "knowledge") : cwd;
})();
/**
 * Its data: knowledge/data for Zeff's first account; another account's knowledge server (the
 * launcher runs one per account with the Knowledge plugin) gets KNOWLEDGE_DATA_DIR — its own.
 */
export const DATA_DIR = process.env.KNOWLEDGE_DATA_DIR ? path.resolve(/*turbopackIgnore: true*/ process.env.KNOWLEDGE_DATA_DIR) : path.join(APP_DIR, "data");
/** The Zeff account this knowledge server belongs to (KNOWLEDGE_ACCOUNT; without: the first, "default"). */
export const ACCOUNT = process.env.KNOWLEDGE_ACCOUNT || "default";
export const ACCOUNT_NAME = process.env.KNOWLEDGE_ACCOUNT_NAME || "";
/** Another account's: starts empty — no Confluence of the first account's .env by default. */
export const FIRST_ACCOUNT = ACCOUNT === "default";
/** Zeff's folder (its .env — where the Confluence settings are). */
export const ZEFF_DIR = path.dirname(APP_DIR);

const SCHEMA = `
create table if not exists settings (key text primary key, value text not null);
create table if not exists pages (
  id text primary key,
  space text not null default '',
  title text not null,
  url text not null default '',
  version integer not null default 0,
  updated_at text,
  author text,
  body text not null default '',
  fetched_at text not null,
  compiled_version integer,
  compiled_at text,
  summary text,
  -- What it's about, in other words (German and English, synonyms): Copilot's, for the search.
  concepts text not null default ''
);
create table if not exists chunks (
  id integer primary key,
  page_id text not null references pages(id) on delete cascade,
  idx integer not null,
  heading text not null default '',
  text text not null
);
create index if not exists chunks_page on chunks(page_id);
create virtual table if not exists chunks_fts using fts5(title, heading, text, concepts, chunk_id unindexed, page_id unindexed, tokenize = 'unicode61 remove_diacritics 2');
create table if not exists entities (
  id integer primary key,
  key text not null unique,
  name text not null,
  type text not null default 'term',
  aliases text not null default '[]',
  summary text not null default '',
  updated_at text not null
);
create virtual table if not exists entities_fts using fts5(name, aliases, summary, entity_id unindexed, tokenize = 'unicode61 remove_diacritics 2');
create table if not exists entity_pages (
  entity_id integer not null references entities(id) on delete cascade,
  page_id text not null references pages(id) on delete cascade,
  primary key (entity_id, page_id)
);
create table if not exists relations (
  id integer primary key,
  src integer not null references entities(id) on delete cascade,
  dst integer not null references entities(id) on delete cascade,
  rel text not null,
  fact text not null default '',
  page_id text not null references pages(id) on delete cascade,
  unique (src, dst, rel, page_id)
);
create index if not exists relations_src on relations(src);
-- What the pages say about the owner (compile.ts → profile.ts): a figure for a period — the net income of a month from a
-- bank statement or a payslip — with the page it is from (gone with it).
create table if not exists profile_facts (
  id integer primary key,
  key text not null,
  period text not null,
  amount real not null,
  text text not null default '',
  page_id text not null references pages(id) on delete cascade,
  at text not null,
  unique (key, period, page_id)
);
create index if not exists profile_facts_key on profile_facts(key, period);
create index if not exists relations_dst on relations(dst);
-- Normalizing (normalize.ts): entities found to be one merged — the keys of those merged away
-- (and their aliases) point to the one that stays, so compiling finds it again instead of making
-- them anew; what was merged; and what the AI proposed, waiting for you.
create table if not exists entity_keys (
  key text primary key,
  entity_id integer not null references entities(id) on delete cascade,
  created_at text not null
);
create index if not exists entity_keys_entity on entity_keys(entity_id);
create table if not exists entity_merges (
  id integer primary key,
  into_id integer not null,
  into_name text not null,
  from_name text not null,
  from_type text not null,
  reason text not null default '',
  at text not null
);
create table if not exists entity_merge_proposals (
  id integer primary key,
  run_id integer,
  keep_id integer not null,
  ids text not null,
  name text not null,
  type text not null,
  reason text not null default '',
  status text not null default 'pending',
  created_at text not null
);
create table if not exists runs (
  id integer primary key,
  kind text not null,
  started_at text not null,
  finished_at text,
  ok integer,
  message text
);
`;

const state = globalThis as unknown as { __knowledgeDb?: Database.Database };

export function db(): Database.Database {
  if (state.__knowledgeDb) return state.__knowledgeDb;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const d = new Database(path.join(DATA_DIR, "knowledge.db"));
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(SCHEMA);
  // Runs a restart cut off: over, not running.
  d.prepare("update runs set finished_at = ?, ok = 0, message = coalesce(message, 'stopped (server restarted)') where finished_at is null").run(new Date().toISOString());
  return (state.__knowledgeDb = d);
}

export type Settings = {
  /** Spaces to read (keys, comma-separated); empty: every space the token can see. */
  spaces: string;
  /** At most this many pages per space. */
  maxPages: number;
  /** The AI backend (an installed plugin) and its model, for compiling pages and for answers. */
  compileBackend: "copilot" | "claude";
  compileModel: string;
  askBackend: "copilot" | "claude";
  askModel: string;
  /** A folder of exported pages (JSON / Markdown / HTML) to read instead of (or besides) Confluence. */
  importDir: string;
  /** Whose knowledge it is (a name): "Ich", "Verfasser", "Autor" … in it mean them — for normalizing. */
  owner: string;
  /** What it reads from Zeff (ids from Zeff's catalog, comma-separated); empty: everything Zeff exports by default. */
  zeffInclude: string;
};

const DEFAULTS: Settings = { spaces: "", maxPages: 2000, compileBackend: "copilot", compileModel: "claude-haiku-5.5", askBackend: "copilot", askModel: "claude-sonnet-5.5", importDir: "", owner: "", zeffInclude: "" };
const backend = (v: string | undefined, d: "copilot" | "claude") => (v === "copilot" || v === "claude" ? v : d);

export function getSettings(): Settings {
  const rows = db().prepare("select key, value from settings").all() as { key: string; value: string }[];
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    spaces: v.spaces ?? DEFAULTS.spaces,
    maxPages: Number(v.maxPages) > 0 ? Number(v.maxPages) : DEFAULTS.maxPages,
    compileBackend: backend(v.compileBackend, DEFAULTS.compileBackend),
    compileModel: v.compileModel ?? DEFAULTS.compileModel,
    askBackend: backend(v.askBackend, DEFAULTS.askBackend),
    askModel: v.askModel ?? DEFAULTS.askModel,
    importDir: v.importDir ?? DEFAULTS.importDir,
    owner: v.owner ?? DEFAULTS.owner,
    zeffInclude: v.zeffInclude ?? DEFAULTS.zeffInclude,
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const st = db().prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value");
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) st.run(k, String(v));
  return getSettings();
}

/** A run (sync, compile) begun — its id; finished with `endRun`. */
export function startRun(kind: string): number {
  return Number(db().prepare("insert into runs (kind, started_at) values (?, ?)").run(kind, new Date().toISOString()).lastInsertRowid);
}
export function endRun(id: number, ok: boolean, message: string): void {
  db().prepare("update runs set finished_at = ?, ok = ?, message = ? where id = ?").run(new Date().toISOString(), ok ? 1 : 0, message.slice(0, 2000), id);
}
export function lastRuns(limit = 10): { id: number; kind: string; started_at: string; finished_at: string | null; ok: number | null; message: string | null }[] {
  return db().prepare("select * from runs order by id desc limit ?").all(limit) as never;
}

export function counts(): { pages: number; compiled: number; chunks: number; entities: number; relations: number; spaces: number } {
  const one = (sql: string) => (db().prepare(sql).get() as { n: number }).n;
  return {
    pages: one("select count(*) n from pages"),
    compiled: one("select count(*) n from pages where compiled_version = version"),
    chunks: one("select count(*) n from chunks"),
    entities: one("select count(*) n from entities"),
    relations: one("select count(*) n from relations"),
    spaces: one("select count(distinct space) n from pages"),
  };
}
