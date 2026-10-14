import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { integrationMetas } from "@/lib/integrations/meta";

/**
 * The pure part of "what this PC needs": finding a command, and which plugin needs which program.
 * No texts and no database — prerequisites.ts (server) puts the words to it, tests use it with a
 * fake filesystem.
 */

export type PrereqId = "browser" | "git" | "uv" | "claude" | "codex" | "copilot" | "poppler";

/** Zeff's own plugins that need a program (a row is shown when one of them is installed); a mounted integration adds its own (`needs` in its meta). */
export const PREREQ_PLUGINS: Record<PrereqId, string[]> = {
  browser: ["outlook-mail", "outlook-calendar", "teams", "gitlab", "gmail", "whatsapp", "keep", "keep-write", "google-calendar"],
  git: ["work", "gitlab"],
  uv: ["jira"],
  claude: ["claude-cli"],
  codex: ["codex-cli"],
  copilot: ["copilot-cli"],
  poppler: ["documents"],
};

export type FindWhere = {
  platform?: string;
  /** The PATH to search (default: this process's). */
  pathEnv?: string;
  exists?: (file: string) => boolean;
  /** Folders a program may be in although a server started before its installation doesn't have them on its PATH. */
  extraDirs?: string[];
  home?: string;
};

/** Where `name` is — on the PATH (Windows: with .exe / .cmd / .bat / .com), else in `extraDirs`. null: not found. */
export function findCommand(name: string, where: FindWhere = {}): string | null {
  const platform = where.platform ?? process.platform;
  const win = platform === "win32";
  const join = win ? path.win32.join : path.posix.join;
  const exists = where.exists ?? ((f: string) => fs.existsSync(/*turbopackIgnore: true*/ f));
  const dirs = [...(where.pathEnv ?? process.env.PATH ?? process.env.Path ?? "").split(win ? ";" : ":"), ...(where.extraDirs ?? [])].map((d) => d.trim().replace(/^"|"$/g, "")).filter(Boolean);
  const names = win ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, `${name}.com`] : [name];
  for (const d of dirs) for (const n of names) if (exists(join(d, n))) return join(d, n);
  return null;
}

/** The folders uv's installer and the package managers put programs in. */
export function toolDirs(platform: string = process.platform, home: string = os.homedir(), env: Record<string, string | undefined> = process.env): string[] {
  if (platform === "win32") {
    const j = path.win32.join;
    const local = env.LOCALAPPDATA || j(home, "AppData", "Local");
    return [j(home, ".local", "bin"), j(home, ".cargo", "bin"), j(local, "Microsoft", "WinGet", "Links"), j(home, "scoop", "shims"), j(local, "Microsoft", "WindowsApps")];
  }
  const j = path.posix.join;
  return [j(home, ".local", "bin"), j(home, ".cargo", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
}

/** Git: on the PATH, or where Git for Windows puts itself. */
export function findGit(where: FindWhere = {}): string | null {
  const platform = where.platform ?? process.platform;
  const extra = platform === "win32" ? ["C:\\Program Files\\Git\\cmd", "C:\\Program Files (x86)\\Git\\cmd"] : ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"];
  return findCommand("git", { ...where, extraDirs: [...extra, ...(where.extraDirs ?? [])] });
}

/** uv's `uvx` — what starts the Jira MCP server (mcp-atlassian). */
export function findUvx(where: FindWhere = {}): string | null {
  return findCommand("uvx", { ...where, extraDirs: [...toolDirs(where.platform, where.home), ...(where.extraDirs ?? [])] });
}

/** The commands that fix a missing program on a system (shown as they are, not translated). */
export function installCommand(id: "git" | "uv", platform: string = process.platform): string {
  if (id === "git") return platform === "win32" ? "winget install Git.Git" : platform === "darwin" ? "xcode-select --install" : "sudo apt install git";
  return platform === "win32" ? "winget install --id astral-sh.uv" : platform === "darwin" ? "brew install uv" : "curl -LsSf https://astral.sh/uv/install.sh | sh";
}

/** The rows a set of installed plugins needs: the program's row is kept when one of its plugins is installed. */
export function relevantRows<T extends { id: PrereqId }>(rows: T[], installed: ReadonlySet<string>, opts: { jiraCommand?: string | null } = {}): T[] {
  return rows.filter((r) => {
    const plugins = [...PREREQ_PLUGINS[r.id], ...integrationMetas().filter((m) => m.needs?.includes(r.id)).map((m) => m.id)];
    if (!plugins.some((p) => installed.has(p))) return false;
    // Jira pointed at another command (JIRA_MCP_COMMAND): uv isn't what it needs.
    if (r.id === "uv" && opts.jiraCommand && !/^uvx?(\.exe)?$/i.test(path.basename(opts.jiraCommand.trim()))) return false;
    return true;
  });
}

/**
 * `uvx` / `uv` as a bare command name → where it really is, also in the folders uv's installer uses (a Zeff
 * started before uv was installed doesn't have them on its PATH). Anything else — a path, another program — as it is.
 */
export function resolveBareCommand(command: string, where: FindWhere = {}): string {
  const name = command.trim();
  if (!/^uvx?(\.exe)?$/i.test(name)) return command;
  const base = name.replace(/\.exe$/i, "").toLowerCase();
  return (base === "uvx" ? findUvx(where) : findCommand("uv", { ...where, extraDirs: [...toolDirs(where.platform, where.home), ...(where.extraDirs ?? [])] })) ?? command;
}
