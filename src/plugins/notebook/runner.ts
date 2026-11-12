import { execFile, spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import type { KernelContext, KernelLanguage, Spawned, Where } from "./languages";
import { kernelEnv, networkAllowed, memoryLimit } from "./runtimes";

/**
 * Where a session runs. By default in a Docker container of its own — the language's image, the session's folder mounted as /work,
 * no environment of Zeff in it, no extra rights, a limit of memory, processors and processes — or, when set (or when there is no
 * Docker), as a program on this computer with a cleaned environment. Server only.
 */

const run = (cmd: string, args: string[], timeout = 15000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4_000_000 }, (err, out, errOut) => resolve({ ok: !err, out: `${out}${errOut}`.trim() })));

let docker: { at: number; up: boolean; version: string } | null = null;

/** Whether a Docker daemon answers (looked at every 20 seconds). */
export async function dockerStatus(force = false): Promise<{ up: boolean; version: string }> {
  if (!force && docker && Date.now() - docker.at < 20_000) return docker;
  const r = await run("docker", ["info", "--format", "{{.ServerVersion}}"], 8000);
  docker = { at: Date.now(), up: r.ok && /^\d/.test(r.out), version: r.ok ? r.out.split("\n")[0] : "" };
  return docker;
}

/** The image there, or pulled (its progress said to `note`). */
export async function ensureImage(image: string, note: (t: string) => void): Promise<void> {
  if (!/^[\w][\w./:@-]{0,200}$/.test(image)) throw new Error(`Not an image name: ${image.slice(0, 60)}`);
  if ((await run("docker", ["image", "inspect", image], 15000)).ok) return;
  note(`Pulling the image ${image} (the first time only) …\n`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn("docker", ["pull", "--quiet", image], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (c: Buffer) => (err += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`docker pull ${image} failed: ${err.trim().slice(-300)}`))));
  });
  note("Image ready.\n");
}

function killTree(proc: ChildProcess): void {
  if (!proc.pid || proc.exitCode !== null) return;
  if (process.platform === "win32") execFile("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true }, () => undefined);
  else proc.kill("SIGKILL");
}

/** A session's way of starting processes: in a container, or on this computer. */
export function makeContext(lang: KernelLanguage, dir: string, where: Where, image: string, hostProgram: string[] | null, note: (t: string) => void): KernelContext {
  fs.mkdirSync(dir, { recursive: true });
  if (where === "host") {
    return {
      dir,
      where,
      program: hostProgram ?? [lang.id],
      path: (file) => `${dir}${dir.endsWith("/") || dir.endsWith("\\") ? "" : process.platform === "win32" ? "\\" : "/"}${file}`,
      note,
      spawn(argv, opts = {}) {
        const child: ChildProcess = spawn(argv[0], argv.slice(1), { cwd: dir, env: kernelEnv(opts.env ?? {}), windowsHide: true, stdio: [opts.stdin ? "pipe" : "ignore", "pipe", "pipe"] });
        return { child, kill: () => killTree(child) };
      },
    };
  }
  return {
    dir,
    where,
    program: lang.docker.program,
    path: (file) => `/work/${file}`,
    note,
    spawn(argv, opts = {}): Spawned {
      const name = `znb-${crypto.randomBytes(6).toString("hex")}`;
      const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
      const gid = typeof process.getgid === "function" ? process.getgid() : undefined;
      const args = [
        "run", "--rm", opts.stdin ? "-i" : "", "--init", "--name", name,
        "-v", `${dir}:/work`, "-w", "/work",
        "--memory", memoryLimit(), "--cpus", "2", "--pids-limit", "512",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        ...(networkAllowed() ? [] : ["--network", "none"]),
        ...(uid !== undefined && gid !== undefined ? ["--user", `${uid}:${gid}`] : []),
        "-e", "HOME=/tmp", "-e", "PYTHONUNBUFFERED=1", "-e", "PYTHONIOENCODING=utf-8", "-e", "MPLBACKEND=Agg",
        ...Object.entries(opts.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
        image, ...argv,
      ].filter((a) => a !== "");
      const child: ChildProcess = spawn("docker", args, { windowsHide: true, stdio: [opts.stdin ? "pipe" : "ignore", "pipe", "pipe"] });
      return { child, kill: () => execFile("docker", ["rm", "-f", name], { windowsHide: true }, () => undefined) };
    },
  };
}
