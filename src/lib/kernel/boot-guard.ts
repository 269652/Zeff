import fs from "node:fs";
import path from "node:path";
import { BASE_DIR } from "@/db/accounts";
import { safeMode, setSafeMode } from "./safe-mode";

/**
 * The start guard (docs/zeff-kernel.md, "Safe mode, for everything"). Zeff can be changed at runtime, so a change can also stop it from
 * starting. Every start is written down as *pending*, with the step it is in (`bootStep`), until it got through them all (`bootReady`). A
 * start that stays up for a minute, or ends by being stopped, clears it. When a start finds the one before it pending and not through its
 * steps, that start failed. After two failed starts in a row, Zeff comes up in safe mode by itself and says why, naming the step it
 * stopped in. Then you can repair it.
 *
 * One file per server role, beside the data (`<data>/.boot-web.json`, `.boot-sync.json`), so the web server and the sync host don't
 * count each other's starts. Server only.
 */

/** Failed starts in a row that switch safe mode on. */
export const FAILED_STARTS = 2;
/** A start that stays up this long counts as one that came up. */
export const HEALTHY_AFTER_MS = 60_000;

type BootRecord = { pending: boolean; failures: number; startedAt: string; step?: string; /** The start got through its steps (bootReady). */ ready?: boolean };
export type BootResult = { failures: number; safeModeOn: boolean; /** The step the last failed start stopped in. */ stoppedIn?: string };

type Opts = { role?: string; healthyAfterMs?: number; /** Tests: no timer, no exit listener. */ manual?: boolean };

const roleOf = (o: Opts) => (o.role ?? process.env.ZEFF_ROLE ?? "web").replace(/[^\w-]/g, "") || "web";
const fileOf = (role: string) => path.join(/*turbopackIgnore: true*/ BASE_DIR, `.boot-${role}.json`);

function read(file: string): BootRecord | null {
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as BootRecord;
  } catch {
    return null;
  }
}
function write(file: string, r: BootRecord): void {
  try {
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
    fs.writeFileSync(/*turbopackIgnore: true*/ file, JSON.stringify(r, null, 2));
  } catch {
    /* (a read-only data folder: no guard, Zeff starts anyway) */
  }
}

const g = globalThis as { __zeffBootFile?: string };

/** A start begins: count the one before it if it never came up, switch safe mode on after too many. Call once, first thing. */
export function beginBoot(opts: Opts = {}): BootResult {
  const file = fileOf(roleOf(opts));
  g.__zeffBootFile = file;
  const prev = read(file);
  // Failed: the start before never got through its steps. One that did and was then stopped or restarted (a dev server killed while it
  // compiles, the launcher restarting it) is not counted — its count stays where it was.
  const failed = !!prev?.pending && !prev.ready;
  const failures = failed ? prev!.failures + 1 : prev?.pending ? prev.failures : 0;
  const stoppedIn = failed ? prev!.step : undefined;
  let safeModeOn = false;
  if (failures >= FAILED_STARTS && !safeMode()) {
    setSafeMode(true, {
      by: "auto",
      reason: `Zeff didn't start ${failures} times in a row${stoppedIn ? ` (it stopped while ${stoppedIn})` : ""}. Safe mode switched on by itself: mods, plugins and what runs by itself are off until you leave it.`,
    });
    safeModeOn = true;
  }
  write(file, { pending: true, failures, startedAt: new Date().toISOString() });
  if (!opts.manual) {
    setTimeout(() => markHealthy(), opts.healthyAfterMs ?? HEALTHY_AFTER_MS).unref();
    // Stopped on purpose (Ctrl+C, a restart by the launcher): no failed start. A crash ends with another code and stays counted.
    process.once("exit", (code) => {
      if (code === 0 || code === 130 || code === 143) markHealthy();
    });
  }
  return { failures, safeModeOn, ...(stoppedIn ? { stoppedIn } : {}) };
}

/** The step the start is in now ("loading the mods"), so a start that dies here is named. */
export function bootStep(step: string): void {
  const file = g.__zeffBootFile;
  if (!file) return;
  const r = read(file);
  if (r?.pending) write(file, { ...r, step });
}

/** The start got through all its steps (the last call in instrumentation.ts): if it dies later, it isn't counted as a failed start. */
export function bootReady(): void {
  const file = g.__zeffBootFile;
  if (!file) return;
  const r = read(file);
  if (r?.pending) write(file, { ...r, step: undefined, ready: true });
}

/** This start came up: the count starts again. */
export function markHealthy(): void {
  const file = g.__zeffBootFile;
  if (!file) return;
  const r = read(file);
  if (r?.pending) write(file, { pending: false, failures: 0, startedAt: r.startedAt });
}
