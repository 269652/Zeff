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

function createDb(dbPath: string): { db: Db; sqlite: Database.Database } {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  applyPendingRestore(dbPath);
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  // Apply the SQL migrations in ./drizzle on first use so the app is
  // zero-setup: `npm run dev` creates data/zeff.db with the current schema.
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
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
