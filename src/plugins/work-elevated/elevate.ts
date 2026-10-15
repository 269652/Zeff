import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BASE_DIR } from "@/db/accounts";
import { getPref, setPref } from "@/lib/prefs";
import { findClaudeCli } from "@/plugins/claude-cli/cli";
import { hostScript } from "@/plugins/claude-cli/live";
import { isInstalled } from "@/plugins/state";
import { t } from "@/lib/i18n/server";

/**
 * Admin sessions (beta plugin "work-elevated"): a live Claude session run as administrator, on
 * Windows. Its host (scripts/work-session-host.mjs) starts elevated; Zeff talks to it over 127.0.0.1 as
 * to any other.
 *
 * - Interactive ("uac"): each admin session asks Windows — the UAC prompt on your desktop.
 * - Automatic ("task"): a scheduled task with the highest privileges, set up once (that once
 *   asks UAC), starts them without asking: Zeff drops the host's config into a spool folder and
 *   runs the task (scripts/work-host-spool.mjs).
 *
 * Automatic means: anything that can write to your profile can get a process elevated through
 * it — the trade-off of no prompts. The plugin's warning says so.
 */

export const TASK_PATH = "\\Zeff\\";
export const TASK_NAME = "Elevated work sessions";
const TASK = `${TASK_PATH}${TASK_NAME}`;
export const spoolDir = () => path.join(BASE_DIR, "work-elevated-spool");
const spoolScript = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "work-host-spool.mjs");

export type ElevationMode = "uac" | "task";
export const elevationMode = (): ElevationMode => (getPref<string>("workElevated.mode", "uac") === "task" ? "task" : "uac");
export const setElevationMode = (m: ElevationMode) => setPref("workElevated.mode", m);

/** Admin sessions can be had here: Windows, the plugin installed. */
export const elevationAvailable = () => process.platform === "win32" && isInstalled("work-elevated");

const run = (file: string, args: string[], env?: Record<string, string>) =>
  new Promise<{ code: number; out: string }>((resolve) =>
    execFile(file, args, { windowsHide: true, timeout: 300000, env: { ...process.env, ...env } }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}`.trim() }),
    ),
  );

/** The scheduled task is there (automatic admin sessions set up). */
export async function taskInstalled(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  return (await run("schtasks", ["/Query", "/TN", TASK])).code === 0;
}

/** Start a session's host as administrator: through the task (no prompt) or UAC. */
export async function startElevatedHost(cfgFile: string): Promise<void> {
  if (!elevationAvailable()) throw new Error(t("Admin sessions need Windows and the “Admin sessions” plugin (Plugins)."));
  if (elevationMode() === "task") {
    if (!(await taskInstalled())) throw new Error(t("Automatic admin sessions aren't set up — Code → Admin sessions → Set up."));
    fs.mkdirSync(spoolDir(), { recursive: true });
    const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`;
    fs.copyFileSync(cfgFile, path.join(spoolDir(), name));
    const r = await run("schtasks", ["/Run", "/TN", TASK]);
    if (r.code) throw new Error(t("The admin task didn't start: {why}", { why: r.out }));
    return;
  }
  // UAC: Windows asks on your desktop. The paths through the environment (nothing to quote wrong).
  const r = await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Start-Process -FilePath $env:ZEFF_NODE -ArgumentList ('"' + $env:ZEFF_HOST_SCRIPT + '" "' + $env:ZEFF_HOST_CFG + '"') -Verb RunAs -WindowStyle Hidden`,
    ],
    { ZEFF_NODE: process.execPath, ZEFF_HOST_SCRIPT: hostScript(), ZEFF_HOST_CFG: cfgFile },
  );
  if (r.code) throw new Error(/cancel/i.test(r.out) ? t("Administrator rights were declined (UAC).") : t("Couldn't start as administrator: {why}", { why: r.out.slice(0, 300) }));
}

/** A PowerShell string literal. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Run a script elevated (UAC) and wait for it; its result (ok, or the error) from a file it writes. */
async function elevatedScript(body: string): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-elevate-"));
  const ps1 = path.join(dir, "run.ps1");
  const result = path.join(dir, "result.txt");
  fs.writeFileSync(ps1, `$ErrorActionPreference = 'Stop'\ntry {\n${body}\n  Set-Content -LiteralPath ${lit(result)} -Value 'ok'\n} catch {\n  Set-Content -LiteralPath ${lit(result)} -Value $_.Exception.Message\n}\n`, "utf8");
  try {
    const r = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `Start-Process -FilePath powershell.exe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + $env:ZEFF_PS1 + '"') -Verb RunAs -Wait -WindowStyle Hidden`],
      { ZEFF_PS1: ps1 },
    );
    if (r.code) throw new Error(/cancel/i.test(r.out) ? t("Administrator rights were declined (UAC).") : r.out.slice(0, 300));
    const out = fs.existsSync(result) ? fs.readFileSync(result, "utf8").replace(/^﻿/, "").trim() : "no result";
    if (out !== "ok") throw new Error(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Set up automatic admin sessions: the scheduled task (asks UAC once). */
export async function installTask(): Promise<void> {
  if (process.platform !== "win32") throw new Error(t("Admin sessions are for Windows."));
  const cli = findClaudeCli();
  if (!cli) throw new Error(t("The Claude CLI wasn't found."));
  fs.mkdirSync(spoolDir(), { recursive: true });
  const user = `${process.env.USERDOMAIN ?? os.hostname()}\\${os.userInfo().username}`;
  const args = `"${spoolScript()}" "${spoolDir()}" "${cli}"`;
  await elevatedScript(`  $action = New-ScheduledTaskAction -Execute ${lit(process.execPath)} -Argument ${lit(args)}
  $principal = New-ScheduledTaskPrincipal -UserId ${lit(user)} -LogonType Interactive -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances Parallel
  Register-ScheduledTask -TaskPath ${lit(TASK_PATH)} -TaskName ${lit(TASK_NAME)} -Action $action -Principal $principal -Settings $settings -Description 'Zeff: starts Code sessions as administrator (Admin sessions plugin). Remove it from Zeff or here.' -Force | Out-Null`);
  setElevationMode("task");
}

/** Remove the task (asks UAC); admin sessions ask UAC each time again. */
export async function removeTask(): Promise<void> {
  if (process.platform !== "win32") return;
  if (await taskInstalled()) await elevatedScript(`  Unregister-ScheduledTask -TaskPath ${lit(TASK_PATH)} -TaskName ${lit(TASK_NAME)} -Confirm:$false`);
  setElevationMode("uac");
}

/** Whether Zeff itself runs elevated (then every session does). */
export async function zeffElevated(): Promise<boolean> {
  if (process.platform !== "win32") return typeof process.getuid === "function" && process.getuid() === 0;
  return (await run("net", ["session"])).code === 0;
}

