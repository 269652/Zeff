import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * A throwaway Zeff data folder for a test file: its own database (migrated on first use), its own
 * accounts.json — never the real data/. Call before anything imports "@/db" (import it dynamically).
 */
export function setupTempData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-test-"));
  process.env.DATABASE_PATH = path.join(dir, "zeff.db");
  process.env.ZEFF_TEAMS_SYNC = "off";
  return dir;
}

/** The repo's root (tests run from it). */
export const ROOT = process.cwd();
