import { execFile } from "node:child_process";
import type { PrereqId } from "@/lib/prerequisites-shared";

/**
 * Installing what a PC lacks, by itself (Windows: winget, which every Windows 10/11 has; a Mac: Homebrew).
 * The pure part is the plan — which command installs which program; the rest runs it, one program at a
 * time, and keeps what happened so the page can poll it. The AI CLIs aren't installed here: they need
 * a sign-in of their own, so the page tells how.
 */
export type InstallPlan = { name: string; command: string; args: string[] };

const WINGET_IDS: Partial<Record<PrereqId, string>> = {
  browser: "Google.Chrome",
  git: "Git.Git",
  uv: "astral-sh.uv",
  poppler: "oschwartz10612.Poppler",
};
const BREW_ARGS: Partial<Record<PrereqId, string[]>> = {
  browser: ["install", "--cask", "google-chrome"],
  git: ["install", "git"],
  uv: ["install", "uv"],
  poppler: ["install", "poppler"],
};

/** The command that installs `id` on this system, or null (no package manager, or not something we install). */
export function installPlan(id: PrereqId, platform: string, has: (command: string) => boolean): InstallPlan | null {
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
export function startInstall(id: PrereqId, deps: { plan: InstallPlan | null; found: () => boolean; run?: (p: InstallPlan) => Promise<{ ok: boolean; out: string }> }): InstallState {
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
      installs.set(id, { id, state: found ? "done" : "failed", out: found ? "" : r.out.replace(/\s+/g, " ").slice(-200) || (r.ok ? "Installed, but Zeff didn't find it — restart Zeff." : "Failed."), at });
    });
  return s;
}

/** Waits for the queue (tests). */
export const installsSettled = () => Promise.resolve(g.__zeffInstallQueue).catch(() => undefined);

const defaultRun = (p: InstallPlan): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => execFile(p.command, p.args, { timeout: 20 * 60000, windowsHide: true, maxBuffer: 8_000_000 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}\n${stderr}`.trim().slice(-400) })));
