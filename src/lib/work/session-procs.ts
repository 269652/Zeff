import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { WorkRun } from "@/db/schema";
import { emitChange } from "@/lib/events";
import { workDir } from "./log";
import { t } from "@/lib/i18n/server";

/**
 * A session's dev servers — Claude Code's preview: the configurations in the folder's
 * .claude/launch.json (name, command, arguments, port, env), started in the session's folder,
 * their output in a file, stopped with everything they started. They run detached (a Zeff
 * restart doesn't stop them); a pid file says what's running.
 */

export type LaunchConfig = { name: string; runtimeExecutable: string; runtimeArgs?: string[]; port?: number; autoPort?: boolean; env?: Record<string, string>; url?: string };
export type ProcView = { name: string; port: number | null; url: string | null; running: boolean; pid: number | null; startedAt: string | null; log: string };

const procDir = () => path.join(workDir(), "procs");
const pidFile = (runId: number, name: string) => path.join(procDir(), `${runId}-${name.replace(/[^\w.-]+/g, "_")}.json`);
const outFile = (runId: number, name: string) => path.join(procDir(), `${runId}-${name.replace(/[^\w.-]+/g, "_")}.log`);

function alive(pid: number | null | undefined) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The configurations in the session's folder (else its repo's). */
export function launchConfigs(run: Pick<WorkRun, "cwd" | "repo">): LaunchConfig[] {
  for (const dir of [run.cwd, run.repo].filter((d): d is string => !!d)) {
    const file = path.join(dir, ".claude", "launch.json");
    try {
      const j = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as { configurations?: LaunchConfig[] };
      return (j.configurations ?? []).filter((c) => c && typeof c.name === "string" && typeof c.runtimeExecutable === "string");
    } catch {
      // none here
    }
  }
  return [];
}

type PidInfo = { pid: number; port: number | null; url: string | null; startedAt: string };
const readPid = (runId: number, name: string): PidInfo | null => {
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ pidFile(runId, name), "utf8")) as PidInfo;
  } catch {
    return null;
  }
};

/** The session's dev servers: configured, running or not, the end of their output. */
export function listProcs(run: Pick<WorkRun, "id" | "cwd" | "repo">): ProcView[] {
  return launchConfigs(run).map((c) => {
    const p = readPid(run.id, c.name);
    let log = "";
    try {
      const t = fs.readFileSync(/*turbopackIgnore: true*/ outFile(run.id, c.name), "utf8");
      log = t.slice(-6000);
    } catch {
      // not started yet
    }
    const running = alive(p?.pid);
    return { name: c.name, port: p?.port ?? c.port ?? null, url: p?.url ?? null, running, pid: running ? p!.pid : null, startedAt: running ? p!.startedAt : null, log };
  });
}

/** A free port (from the OS). */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
const portTaken = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });

/** Start a configuration in the session's folder — on its port, or a free one (autoPort, or its port taken). */
export async function startProc(run: Pick<WorkRun, "id" | "cwd" | "repo">, name: string): Promise<ProcView> {
  const c = launchConfigs(run).find((x) => x.name === name);
  if (!c) throw new Error(t("No configuration “{name}” in .claude/launch.json.", { name }));
  if (alive(readPid(run.id, name)?.pid)) throw new Error(t("{name} is running already.", { name }));
  if (!run.cwd) throw new Error(t("The session has no folder."));
  let port = c.port ?? null;
  if (port && (await portTaken(port))) {
    if (!c.autoPort) throw new Error(t("Port {port} is taken — stop what runs there, or set \"autoPort\": true in launch.json.", { port }));
    port = await freePort();
  }
  fs.mkdirSync(/*turbopackIgnore: true*/ procDir(), { recursive: true });
  const out = fs.openSync(/*turbopackIgnore: true*/ outFile(run.id, name), "w");
  const { workerEnv } = await import("./runner");
  const env = { ...workerEnv(run.id), ...(c.env ?? {}), ...(port ? { PORT: String(port) } : {}) } as NodeJS.ProcessEnv;
  // npm, npx and other .cmd shims need a shell on Windows; the arguments are the config's own.
  const win = process.platform === "win32";
  const args = [...(c.runtimeArgs ?? [])];
  // A dev server on another port than configured: told so, the way Next and Vite take it.
  if (port && c.port && port !== c.port && !args.some((a) => a === "-p" || a === "--port")) args.push(...(args.includes("--") ? [] : ["--"]), "-p", String(port));
  const child = spawn(/*turbopackIgnore: true*/ c.runtimeExecutable, args, { cwd: run.cwd, env, detached: true, stdio: ["ignore", out, out], windowsHide: true, shell: win && !/\.exe$/i.test(c.runtimeExecutable) });
  fs.closeSync(out);
  child.unref();
  const url = c.url ?? (port ? `http://localhost:${port}` : null);
  const info: PidInfo = { pid: child.pid ?? 0, port, url, startedAt: new Date().toISOString() };
  fs.writeFileSync(/*turbopackIgnore: true*/ pidFile(run.id, name), JSON.stringify(info));
  emitChange("work");
  return listProcs(run).find((p) => p.name === name)!;
}

/** Stop it and everything it started. */
export function stopProc(run: Pick<WorkRun, "id">, name: string): void {
  const p = readPid(run.id, name);
  if (p?.pid && alive(p.pid)) {
    if (process.platform === "win32") execFile("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true }, () => {});
    else
      try {
        process.kill(-p.pid, "SIGTERM");
      } catch {
        // gone already
      }
  }
  fs.rmSync(/*turbopackIgnore: true*/ pidFile(run.id, name), { force: true });
  emitChange("work");
}
