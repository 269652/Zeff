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

function createDb(): Db {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
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
