import { execFile } from "node:child_process";
import type { PrereqId } from "@/lib/prerequisites-shared";

/**
 * Installing what a PC lacks, by itself (Windows: winget, which every Windows 10/11 has; a Mac: Homebrew).
 * The pure part is the plan — which command installs which program; the rest runs it, one program at a
 * time, and keeps what happened so the page can poll it. No Node is needed for any of it: Claude and uv
 * come from their own installers (a PowerShell / shell script, no admin), Copilot from winget / Homebrew.
 * The AI CLIs still need a sign-in of their own afterwards (the page says so). Codex needs npm: Zeff downloads the portable Node (with npm) into its own folder for it (node-tools.ts).
 */
/** `custom`: not a command but Zeff's own routine (Codex: the portable Node + npm). */
export type InstallPlan = { name: string; command: string; args: string[]; custom?: "codex" };

const WINGET_IDS: Partial<Record<PrereqId, string>> = {
  browser: "Google.Chrome",
  git: "Git.Git",
  uv: "astral-sh.uv",
  poppler: "oschwartz10612.Poppler",
  copilot: "GitHub.Copilot",
};
/** The vendors' own installers, for programs without a (reliable) package: no admin, no package manager. */
const SCRIPTS: Partial<Record<PrereqId, { win: string; unix: string }>> = {
  claude: { win: "irm https://claude.ai/install.ps1 | iex", unix: "curl -fsSL https://claude.ai/install.sh | bash" },
  uv: { win: "irm https://astral.sh/uv/install.ps1 | iex", unix: "curl -LsSf https://astral.sh/uv/install.sh | sh" },
};

const BREW_ARGS: Partial<Record<PrereqId, string[]>> = {
  browser: ["install", "--cask", "google-chrome"],
  git: ["install", "git"],
  uv: ["install", "uv"],
  poppler: ["install", "poppler"],
  copilot: ["install", "copilot-cli"],
};

/** The command that installs `id` on this system, or null (no package manager, or not something we install). */
export function installPlan(id: PrereqId, platform: string, has: (command: string) => boolean): InstallPlan | null {
  if (id === "codex") return { name: "Node + npm", command: "", args: [], custom: "codex" };
  const script = SCRIPTS[id];
  if (script && platform === "win32" && has("powershell")) return { name: "PowerShell", command: "powershell", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script.win] };
  if (script && (platform === "darwin" || platform === "linux") && has("sh")) return { name: "sh", command: "sh", args: ["-c", script.unix] };
  if (platform === "win32") {
    const wid = WINGET_IDS[id];
    if (!wid || !has("winget")) return null;
    return { name: "winget", command: "winget", args: ["install", "--id", wid, "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements"] };
  }
  if (platform === "darwin") {
    const args = BREW_ARGS[id];
    return args && has("brew") ? { name: "Homebrew", command: "brew", args } : null;
  }
  return null;
}

export type InstallState = { id: PrereqId; state: "running" | "done" | "failed"; out: string; at: string };

const g = globalThis as { __zeffInstalls?: Map<PrereqId, InstallState>; __zeffInstallQueue?: Promise<unknown> };
const installs = (g.__zeffInstalls ??= new Map());

export const installStates = (): InstallState[] => [...installs.values()];

/**
 * Installs `id` in the background (queued behind any running install — winget allows one at a time).
 * `found` is asked afterwards: installed means the program is there now. Returns at once.
 */
export function startInstall(id: PrereqId, deps: { plan: InstallPlan | null; found: () => boolean; /** Once it is installed (the AI CLIs: their sign-in starts). */ after?: () => void; run?: (p: InstallPlan) => Promise<{ ok: boolean; out: string }> }): InstallState {
  const running = installs.get(id);
  if (running?.state === "running") return running;
  const at = new Date().toISOString();
  if (!deps.plan) {
    const s: InstallState = { id, state: "failed", out: "No package manager on this PC that Zeff can use.", at };
    installs.set(id, s);
    return s;
  }
  const plan = deps.plan;
  const s: InstallState = { id, state: "running", out: "", at };
  installs.set(id, s);
  const run = deps.run ?? defaultRun;
  g.__zeffInstallQueue = Promise.resolve(g.__zeffInstallQueue)
    .catch(() => undefined)
    .then(async () => {
      const r = await run(plan);
      const found = deps.found();
      if (found) try { deps.after?.(); } catch { /* the install stands */ }
      installs.set(id, { id, state: found ? "done" : "failed", out: found ? "" : r.out.replace(/\s+/g, " ").slice(-200) || (r.ok ? "Installed, but Zeff didn't find it — restart Zeff." : "Failed."), at });
    });
  return s;
}

/** Waits for the queue (tests). */
export const installsSettled = () => Promise.resolve(g.__zeffInstallQueue).catch(() => undefined);

const defaultRun = async (p: InstallPlan): Promise<{ ok: boolean; out: string }> => {
  if (p.custom === "codex") return (await import("./node-tools")).installCodex();
  return runCommand(p);
};
const runCommand = (p: InstallPlan): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => execFile(p.command, p.args, { timeout: 20 * 60000, windowsHide: true, maxBuffer: 8_000_000 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}\n${stderr}`.trim().slice(-400) })));
