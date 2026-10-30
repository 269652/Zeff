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
  // (The calendar inbox is a file beside the data, not in the database: the tests' own — else they read this computer's appointments.)
  process.env.ZEFF_CALENDAR_INBOX = path.join(dir, "calendar-inbox.json");
  // No test ever starts a real AI CLI: one that sets none gets a stand-in that fails loudly. A test's own fake (in tests/ or
  // a temp folder) stays; anything else — the real CLI your shell or the launcher set — is replaced too.
  for (const k of AI_CLIS) if (!isTestCli(process.env[k])) process.env[k] = FAIL_CLI;
  // Gone when the test run ends (the database may still be open then: what can't be removed is left).
  process.on("exit", () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // a file still in use
    }
  });
  return dir;
}

/** The repo's root (tests run from it). */
export const ROOT = process.cwd();

/** The AI CLIs' variables, and the stand-in every test gets for them unless it sets its own (put it back instead of deleting one). */
export const AI_CLIS = ["CLAUDE_CLI", "CODEX_CLI", "COPILOT_CLI"] as const;
export const FAIL_CLI = path.join(ROOT, "tests", "fake-cli-fail.mjs");
const isTestCli = (cli: string | undefined) => {
  const p = path.resolve(cli?.trim() || "/").toLowerCase();
  return [path.join(ROOT, "tests"), os.tmpdir()].some((d) => p.startsWith(path.resolve(d).toLowerCase() + path.sep));
};
