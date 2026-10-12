import { t } from "@/lib/i18n/server";
import { findGit, installCommand } from "@/lib/prerequisites-shared";

/**
 * Git is the one program Zeff doesn't bring (the Work tab's worktrees and the repos need it).
 * Without it, git's spawn fails with "spawn git ENOENT" — these turn that into a message that says
 * what to do. Server only.
 */

const cache = globalThis as { __zeffGit?: { at: number; path: string | null } };

/** Where git is (null: not installed) — looked up on the PATH and Git for Windows' folder, remembered for a few seconds. */
export function gitPath(): string | null {
  const hit = cache.__zeffGit;
  if (hit && Date.now() - hit.at < (hit.path ? 60000 : 5000)) return hit.path;
  cache.__zeffGit = { at: Date.now(), path: findGit() };
  return cache.__zeffGit.path;
}

export const gitAvailable = (): boolean => gitPath() !== null;

/** "Git isn't installed …": what for, and the command that installs it. */
export const gitMissingMessage = (): string => t("Git isn't installed on this PC (or not on the PATH) — the Work tab and the repos need it. Install it ({command}), then restart Zeff.", { command: installCommand("git") });

/** A failure of a spawned git, worded for the user: not installed → gitMissingMessage(); else `message` (default: the error's own). */
export function gitFailure(err: unknown, message?: string): Error {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "ENOENT" && /\bgit\b/i.test(e.message ?? "git")) return new Error(gitMissingMessage());
  if (message !== undefined) return new Error(message);
  return err instanceof Error ? err : new Error(String(err));
}
