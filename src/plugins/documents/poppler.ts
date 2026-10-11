/**
 * Poppler's pdftoppm — what the Claude CLI's Read tool needs to read a scanned or complex PDF.
 * Found where it is (the PATH, the package managers' folders — a fresh install isn't on this
 * server's PATH yet); when it isn't there and the plugin may (Documents → Settings, on by default),
 * installed by the package manager of the machine — winget (or scoop) on Windows, Homebrew on a Mac —
 * once: a failed try isn't repeated for a day, unless you click "Read again". Server only.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { documentSettings } from "./settings";

const EXE = process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm";
const DAY = 864e5;

/** The folders pdftoppm may be in: the PATH's, and where package managers put things (not on the PATH of a server started before). */
function candidateDirs(): string[] {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const home = os.homedir();
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    dirs.push(path.join(local, "Microsoft", "WinGet", "Links"), path.join(home, "scoop", "shims"), path.join(home, "scoop", "apps", "poppler", "current", "Library", "bin"), path.join(home, "scoop", "apps", "poppler", "current", "bin"));
    // winget's portable package: Packages\oschwartz10612.Poppler_<source>\poppler-<version>\Library\bin
    const packages = path.join(local, "Microsoft", "WinGet", "Packages");
    try {
      for (const d of fs.readdirSync(/*turbopackIgnore: true*/ packages).filter((x) => /^oschwartz10612\.Poppler/i.test(x))) {
        const base = path.join(packages, d);
        for (const v of fs.readdirSync(/*turbopackIgnore: true*/ base).filter((x) => /^poppler/i.test(x))) dirs.push(path.join(base, v, "Library", "bin"));
      }
    } catch {
      // no winget packages
    }
  } else dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin");
  return dirs;
}

/** The folder with pdftoppm in it (null: not installed). */
export function findPoppler(): string | null {
  return candidateDirs().find((d) => fs.existsSync(/*turbopackIgnore: true*/ path.join(d, EXE))) ?? null;
}

export type Installer = { name: string; command: string; args: string[] };

/** The commands that install it on this machine, in the order to try — those whose package manager is there. */
export function installers(platform: NodeJS.Platform, has: (command: string) => boolean): Installer[] {
  if (platform === "win32") {
    return [
      ...(has("winget") ? [{ name: "winget", command: "winget", args: ["install", "--id", "oschwartz10612.Poppler", "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements"] }] : []),
      ...(has("scoop") ? [{ name: "scoop", command: "scoop", args: ["install", "poppler"] }] : []),
    ];
  }
  if (platform === "darwin") return has("brew") ? [{ name: "Homebrew", command: "brew", args: ["install", "poppler"] }] : [];
  return []; // Linux: a system package (root) — told, not done
}

/** What to do by hand, for the message. */
export const manualInstall = () => (process.platform === "win32" ? "winget install oschwartz10612.Poppler" : process.platform === "darwin" ? "brew install poppler" : "sudo apt install poppler-utils");

/** Whether a command is on the PATH (or, on Windows, where winget lives). */
function hasCommand(command: string): boolean {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat"] : [""];
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  if (process.platform === "win32") dirs.push(path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WindowsApps"), path.join(os.homedir(), "scoop", "shims"));
  return dirs.some((d) => exts.some((e) => fs.existsSync(/*turbopackIgnore: true*/ path.join(d, command + e))));
}

const run = (i: Installer): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    // .cmd shims (scoop) need a shell; the others don't.
    execFile(i.command, i.args, { timeout: 20 * 60000, windowsHide: true, maxBuffer: 8_000_000, shell: process.platform === "win32" && i.name === "scoop" }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}\n${stderr}`.trim().slice(-400) }));
  });

const state = globalThis as { __zeffPopplerInstall?: Promise<string | null> };

/** How the last install failed, and when (ISO) — a failed try isn't repeated for a day. */
const lastFailure = () => getPref<{ at: string; reason: string } | null>("documents:poppler-failure", null);
/** Click "Read again": the next scanned PDF tries again. */
export const forgetPopplerFailure = () => setPref("documents:poppler-failure", null);

/**
 * Poppler's folder — installed first when it's missing and allowed. Throws an Error with the reason
 * (and what to do by hand) when it can't be had; concurrent callers share one install.
 */
export async function ensurePoppler(): Promise<string> {
  const have = findPoppler();
  if (have) return have;
  const manual = manualInstall();
  if (!documentSettings().autoInstall) throw new Error(t("A scanned or complex PDF needs Poppler (pdftoppm). Automatic installation is off (Documents → Settings) — turn it on, or install it yourself ({command}), then click “Read again”.", { command: manual }));
  const failed = lastFailure();
  if (failed && Date.now() - Date.parse(failed.at) < DAY) throw new Error(t("Poppler (pdftoppm) isn't installed, and the automatic installation failed ({reason}). Install it yourself ({command}), then click “Read again”.", { reason: failed.reason, command: manual }));
  const list = installers(process.platform, hasCommand);
  if (!list.length) throw new Error(t("A scanned or complex PDF needs Poppler (pdftoppm), and this machine has no package manager Zeff can use. Install it yourself ({command}), then click “Read again”.", { command: manual }));
  // One install at a time, shared.
  state.__zeffPopplerInstall ??= (async () => {
    let reason = "";
    for (const i of list) {
      console.log(`[documents] Poppler is missing — installing it with ${i.name} …`);
      const r = await run(i);
      const dir = findPoppler();
      if (dir) {
        console.log(`[documents] Poppler installed: ${dir}`);
        setPref("documents:poppler-failure", null);
        return null;
      }
      reason = `${i.name}: ${r.out.replace(/\s+/g, " ").slice(-160) || (r.ok ? t("installed, but pdftoppm wasn't found") : t("failed"))}`;
      console.warn(`[documents] Poppler install with ${i.name} failed: ${reason}`);
    }
    setPref("documents:poppler-failure", { at: new Date().toISOString(), reason });
    return reason;
  })().finally(() => {
    state.__zeffPopplerInstall = undefined;
  });
  const reason = await state.__zeffPopplerInstall;
  const dir = findPoppler();
  if (reason !== null || !dir) throw new Error(t("Poppler (pdftoppm) isn't installed, and the automatic installation failed ({reason}). Install it yourself ({command}), then click “Read again”.", { reason: reason ?? "?", command: manual }));
  return dir;
}
