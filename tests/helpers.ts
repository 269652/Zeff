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
  // (Agents' session logs, read by the todo clocks: the tests' own — not this computer's Claude Code, Copilot, VS Code.)
  process.env.ZEFF_CLAUDE_PROJECTS = path.join(dir, "claude-projects");
  process.env.ZEFF_COPILOT_SESSIONS = path.join(dir, "copilot-sessions");
  process.env.ZEFF_VSCODE_STORAGE = path.join(dir, "vscode-storage");
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
