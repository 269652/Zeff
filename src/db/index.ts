import { convertLegacyItems } from "./legacy-items";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { accountDbPath, accountDir, currentAccountId } from "./accounts";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

/**
 * A restore waiting (Settings → Backups, data/restore-pending with a ".ready" mark): put in place
 * before the database opens — the database file (its old WAL gone with it) and the data files
 * beside it. The state before was backed up when the restore was staged.
 */
function applyPendingRestore(dbPath: string): void {
  const dir = path.dirname(dbPath);
  const pending = path.join(dir, "restore-pending");
  if (!fs.existsSync(path.join(pending, ".ready"))) return;
  const db = path.join(pending, path.basename(dbPath));
  if (!fs.existsSync(db)) return;
  for (const f of [`${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
  fs.copyFileSync(db, dbPath);
  const walk = (from: string) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, e.name);
      const rel = path.relative(pending, src);
      if (e.isDirectory()) walk(src);
      else if (e.name !== ".ready" && src !== db) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.copyFileSync(src, path.join(dir, rel));
      }
    }
  };
  walk(pending);
  fs.rmSync(pending, { recursive: true, force: true });
  console.log(`[zeff] Backup wiederhergestellt (${path.basename(db)} und Dateien aus ${pending}).`);
}

/**
 * The migrations applied. Several processes may open the same new database at once (`next build`
 * collects the pages with parallel workers; a deploy starts servers next to each other), and with a
 * new migration they all try to apply it: the later ones fail with "already exists" — although the
 * first one has applied it. Drizzle runs a migration in a transaction (a failed one leaves nothing
 * behind), so trying again finds it applied and does nothing.
 */
function migrateOnce(db: Db): void {
  for (let attempt = 0; ; attempt++) {
    try {
      migrate(db, { migrationsFolder: MIGRATIONS_DIR });
      return;
    } catch (e) {
      const cause = (e as { cause?: { message?: string } })?.cause?.message ?? (e as Error)?.message ?? String(e);
      if (attempt >= 5 || !/already exists|duplicate column|database is locked|SQLITE_BUSY/i.test(cause)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150 * (attempt + 1)); // a short pause, then look again
    }
  }
}

function createDb(dbPath: string): { db: Db; sqlite: Database.Database } {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  applyPendingRestore(dbPath);
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // With WAL, NORMAL is safe against corruption (a power cut may lose only the last moments) and
  // makes each write — syncs write thousands — far cheaper than FULL's fsync per commit.
  sqlite.pragma("synchronous = NORMAL");
  // Another process on the same file (a backup, a script) waits a little instead of failing at once.
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("temp_store = MEMORY");
  sqlite.pragma("cache_size = -32000"); // 32 MB of pages
  const db = drizzle(sqlite, { schema });
  // Apply the SQL migrations in ./drizzle on first use so the app is
  // zero-setup: `npm run dev` creates data/zeff.db with the current schema.
  migrateOnce(db);
  // Parallel work kept as "items" by an earlier version: back as entries (see legacy-items.ts).
  try {
    const n = convertLegacyItems(sqlite);
    if (n) console.log(`[zeff] ${n} Positionen unter Gruppeneinträgen sind wieder eigene Einträge.`);
  } catch (e) {
    console.error("[zeff] legacy items:", (e as Error).message);
  }
  return { db, sqlite };
}

// One connection per account, kept across Next.js hot reloads in development.
const globalForDb = globalThis as unknown as { __zeffDbs?: Map<string, { db: Db; sqlite: Database.Database }> };
const open = (globalForDb.__zeffDbs ??= new Map());

/** The database of the account this runs for (the active one, or the one `withAccount` set). */
function connection(): { db: Db; sqlite: Database.Database } {
  const id = currentAccountId();
  let hit = open.get(id);
  if (!hit) {
    hit = createDb(accountDbPath(id));
    open.set(id, hit);
  }
  return hit;
}

export const getDb = (): Db => connection().db;

/** The same, as SQLite itself (for SQL over whole tables: the config export). */
export const getSqlite = (): Database.Database => connection().sqlite;

/** The data folder of the account this runs for (beside its database: work logs, context files). */
export const dataDir = () => accountDir(currentAccountId());

/** An account's connection closed (before its folder is moved away). */
export function closeAccountDb(id: string): void {
  const hit = open.get(id);
  if (!hit) return;
  open.delete(id);
  hit.sqlite.close();
}

export { schema };
