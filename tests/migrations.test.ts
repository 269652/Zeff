import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ROOT, setupTempData } from "./helpers";

setupTempData();

test("a new database gets every migration", async () => {
  const { getDb, schema } = await import("@/db");
  const db = getDb();
  assert.equal(db.select().from(schema.jobs).all().length >= 0, true);
  // The newest tables and columns are there.
  db.select({ due: schema.todos.due, knowledge: schema.todos.knowledge }).from(schema.todos).all();
  db.select().from(schema.prefs).all();
});

/**
 * The real databases (every account's) — a consistent copy of each (SQLite's backup, the
 * original only read) migrated to the current schema: a migration that would fail on real data
 * fails here, before a deploy.
 */
test("the migrations apply to copies of the real databases", async () => {
  const data = path.join(ROOT, "data");
  const live = [path.join(data, "zeff.db")];
  const accounts = path.join(data, "accounts");
  if (fs.existsSync(accounts)) for (const a of fs.readdirSync(accounts)) if (fs.existsSync(path.join(accounts, a, "zeff.db"))) live.push(path.join(accounts, a, "zeff.db"));
  const found = live.filter((f) => fs.existsSync(f));
  if (!found.length) return; // a fresh checkout: nothing to try them on
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-migrate-"));
  for (const [i, f] of found.entries()) {
    const copy = path.join(dir, `copy-${i}.db`);
    const src = new Database(f, { readonly: true, fileMustExist: true });
    await src.backup(copy);
    src.close();
    const sqlite = new Database(copy);
    try {
      migrate(drizzle(sqlite), { migrationsFolder: path.join(ROOT, "drizzle") });
      const n = sqlite.prepare("select count(*) n from time_entries").get() as { n: number };
      assert.ok(n.n >= 0);
    } finally {
      sqlite.close();
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
