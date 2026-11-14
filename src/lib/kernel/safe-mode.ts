import fs from "node:fs";
import path from "node:path";
import { BASE_DIR } from "@/db/accounts";

/**
 * Safe mode for everything stored (docs/zeff-kernel.md, "Safe mode, for everything"): one switch for Zeff with the kernel alone. While it
 * is on, what Zeff was given at runtime doesn't run: no mod, no external plugin (they read as off, their functions, hooks, schedules and
 * contributions with them), and nothing that starts by itself: flows by clock or event, routines, pipelines. What you open and run
 * by hand still works, and so do the pages, the databases, the history of every part, rolling back and the AI. That is how you repair
 * what broke. Your settings are kept: leaving safe mode brings back exactly what was on before.
 *
 * On by `ZEFF_SAFE_MODE=1`, by you (the banner, the Mods page), or by Zeff itself after two starts in a row that didn't come up
 * (lib/kernel/boot-guard.ts). The switch is a file beside the data, `<data>/.safe-mode`, holding why and since when. Server only.
 */

export type SafeModeState = { on: boolean; since?: string; reason?: string; by?: "you" | "auto" | "env" };

const file = () => path.join(/*turbopackIgnore: true*/ BASE_DIR, ".safe-mode");
/** The switch the Mods page had before safe mode covered everything (`<mods>/.safe-mode`): still honoured. */
const legacyFile = () => path.join(/*turbopackIgnore: true*/ process.env.ZEFF_MODS_DIR ? path.resolve(/*turbopackIgnore: true*/ process.env.ZEFF_MODS_DIR) : path.join(BASE_DIR, "mods"), ".safe-mode");

/** Is Zeff in safe mode now? Cheap enough to ask on every call (two file checks). */
export function safeMode(): boolean {
  return process.env.ZEFF_SAFE_MODE === "1" || fs.existsSync(file()) || fs.existsSync(legacyFile());
}

/** Safe mode, with why and since when (for the banner and the Mods page). */
export function safeModeState(): SafeModeState {
  if (process.env.ZEFF_SAFE_MODE === "1") return { on: true, by: "env", reason: "ZEFF_SAFE_MODE=1" };
  for (const f of [file(), legacyFile()]) {
    let text: string;
    try {
      text = fs.readFileSync(/*turbopackIgnore: true*/ f, "utf8");
    } catch {
      continue;
    }
    try {
      const j = JSON.parse(text) as Partial<SafeModeState>;
      return { on: true, since: j.since, reason: j.reason, by: j.by === "auto" ? "auto" : "you" };
    } catch {
      return { on: true, since: text.trim() || undefined, by: "you" }; // (the old file held only a date)
    }
  }
  return { on: false };
}

/** Switch safe mode on (with why) or off. Off removes both switches; `ZEFF_SAFE_MODE=1` can only be lifted where it is set. */
export function setSafeMode(on: boolean, opts: { reason?: string; by?: "you" | "auto" } = {}): void {
  if (on) {
    fs.mkdirSync(/*turbopackIgnore: true*/ BASE_DIR, { recursive: true });
    const state = { since: new Date().toISOString(), by: opts.by ?? "you", ...(opts.reason ? { reason: opts.reason } : {}) };
    fs.writeFileSync(/*turbopackIgnore: true*/ file(), JSON.stringify(state, null, 2));
  } else {
    fs.rmSync(/*turbopackIgnore: true*/ file(), { force: true });
    fs.rmSync(/*turbopackIgnore: true*/ legacyFile(), { force: true });
  }
}
