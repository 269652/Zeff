import fs from "node:fs";
import net from "node:net";
import { t } from "@/lib/i18n/server";

/**
 * What a live session's driver needs of its own host (scripts/work-session-host.mjs), whatever CLI
 * it runs: the host's info file, its socket, and the log it writes, read on line by line. (Claude
 * Code's driver has its own copies of these in plugins/claude-cli/live.ts.)
 */

/** The host's info file: written once it listens, removed when it ends. */
export type HostInfo = { pid: number; childPid: number | null; port: number; elevated?: boolean };

export function readHostInfo(file: string): HostInfo | null {
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as HostInfo;
  } catch {
    return null;
  }
}

export function pidAlive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // there — someone else's (an elevated host)
  }
}

/** A file's new whole lines from where it was read (null: nothing new). */
export function newLines(file: string, at: { offset: number; rest: string }): string[] | null {
  let size: number;
  try {
    size = fs.statSync(/*turbopackIgnore: true*/ file).size;
  } catch {
    return null;
  }
  if (size <= at.offset) return null;
  const fd = fs.openSync(/*turbopackIgnore: true*/ file, "r");
  try {
    const buf = Buffer.alloc(Math.min(size - at.offset, 32 * 1024 * 1024));
    const n = fs.readSync(fd, buf, 0, buf.length, at.offset);
    at.offset += n;
    at.rest += buf.subarray(0, n).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
  const out: string[] = [];
  let i: number;
  while ((i = at.rest.indexOf("\n")) >= 0) {
    const line = at.rest.slice(0, i).trim();
    at.rest = at.rest.slice(i + 1);
    if (line) out.push(line);
  }
  return out;
}

/** The host's socket, signed in with its token — once its info file is there (it may take a while to come up). */
export async function connectHost(infoFile: string, token: string, opts: { waitMs: number; gone: () => boolean }): Promise<net.Socket> {
  const until = Date.now() + opts.waitMs;
  let info = readHostInfo(infoFile);
  while (!info && Date.now() < until && !opts.gone()) {
    await new Promise((r) => setTimeout(r, 300));
    info = readHostInfo(infoFile);
  }
  if (!info) throw new Error(t("The session isn't running (any more)."));
  const sock = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host: "127.0.0.1", port: info.port });
    let buf = "";
    const timer = setTimeout(() => {
      s.destroy();
      reject(new Error(t("The session's host doesn't answer.")));
    }, 5000);
    s.setEncoding("utf8");
    s.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    s.on("data", function ok(d) {
      buf += d;
      if (!buf.includes("\n")) return;
      clearTimeout(timer);
      s.off("data", ok);
      if (buf.startsWith("ok")) resolve(s);
      else reject(new Error(t("The session's host refused Zeff.")));
    });
    s.on("connect", () => s.write(`${token}\n`));
  });
  sock.on("error", () => {});
  return sock;
}
