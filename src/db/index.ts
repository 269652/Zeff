import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const DB_PATH =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "zeff.db");
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

/**
 * A restore waiting (Settings → Backups, data/restore-pending with a ".ready" mark): put in place
 * before the database opens — the database file (its old WAL gone with it) and the data files
 * beside it. The state before was backed up when the restore was staged.
 */
function applyPendingRestore(): void {
  const dir = path.dirname(DB_PATH);
  const pending = path.join(dir, "restore-pending");
  if (!fs.existsSync(path.join(pending, ".ready"))) return;
  const db = path.join(pending, path.basename(DB_PATH));
  if (!fs.existsSync(db)) return;
  for (const f of [`${DB_PATH}-wal`, `${DB_PATH}-shm`]) fs.rmSync(f, { force: true });
  fs.copyFileSync(db, DB_PATH);
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

function createDb(): Db {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  applyPendingRestore();
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  // Apply the SQL migrations in ./drizzle on first use so the app is
  // zero-setup: `npm run dev` creates data/zeff.db with the current schema.
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

// Keep a single connection across Next.js hot reloads in development.
const globalForDb = globalThis as unknown as { __zeffDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__zeffDb) {
    globalForDb.__zeffDb = createDb();
  }
  return globalForDb.__zeffDb;
}

export { schema };
