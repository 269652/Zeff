import { execFile } from "node:child_process";

/** A program run to its end: did it succeed, and the last 400 characters of what it printed (stdout + stderr). */
export type Captured = { ok: boolean; out: string };

/** The last 400 characters of what a program printed, trimmed. */
export const tail = (text: string): string => text.trim().slice(-400);

/** Run a program (no shell unless asked) with a time limit; never rejects. `env` is added to the process's own. Server only. */
export function runCapture(command: string, args: string[], opts: { timeout: number; env?: Record<string, string>; shell?: boolean }): Promise<Captured> {
  return new Promise((resolve) =>
    execFile(
      command,
      args,
      { timeout: opts.timeout, windowsHide: true, maxBuffer: 8_000_000, ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}), ...(opts.shell ? { shell: true } : {}) },
      (err, stdout, stderr) => resolve({ ok: !err, out: tail(`${stdout}\n${stderr}`) }),
    ),
  );
}
