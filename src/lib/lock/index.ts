import { beginUnlockAssertion, finishUnlockAssertion, listCredentials, type AssertOptions } from "@/lib/touch";
import type { AssertionInput } from "@/lib/touch/webauthn";
import { keyPresentNow, startKeyWatch } from "./detect";
import { newSecret, readConfig, readState, sessionValid, sign, writeConfig, writeState, SESSION_MS, YUBICO } from "./shared";

/**
 * The lock: Zeff's pages open only with the key's PIN and a touch, and shut the moment the key is pulled out. Server-only
 * (src/proxy.ts does the shutting, from the files in shared.ts; this is the unlocking and the switch).
 *
 * The PIN is the key's own (FIDO2 user verification, checked by the key and shown in the signed answer) — Zeff keeps no
 * secret of its own. Only the browser is locked: agents, MCP and scripts send no Sec-Fetch headers and are not the screen.
 * Locked out? Delete data/lock.json (next to the database): the lock is off again.
 */

export type LockView = { enabled: boolean; locked: boolean; keyPresent: boolean | null };

/** What the page may know: is the lock on, is this browser's session live, is a key plugged in. */
export function lockView(cookie: string | undefined): LockView {
  const cfg = readConfig();
  const state = readState();
  const keyPresent = state && Date.now() - state.beat < 20_000 ? state.present : null;
  if (!cfg) return { enabled: false, locked: false, keyPresent };
  return { enabled: true, locked: !sessionValid(cookie, cfg, state, Date.now()), keyPresent };
}

/** Step 1 of unlocking (or of switching the lock on): what the browser asks the key. */
export function beginUnlock(origin: string): AssertOptions {
  return beginUnlockAssertion(origin);
}

/**
 * Step 2: the touch and the PIN, checked. For `enable` the lock is switched on first (a key must be plugged in and
 * seen — otherwise the first thing the lock did would be to lock you out). Returns the session cookie.
 */
export async function finishUnlock(origin: string, challenge: string, input: AssertionInput, enable: boolean): Promise<{ value: string; maxAge: number }> {
  finishUnlockAssertion(origin, challenge, input);
  let cfg = readConfig();
  if (enable && !cfg) {
    if (listCredentials().length === 0) throw new Error("Register a security key first.");
    if (!(await keyPresentNow())) throw new Error("Zeff does not see the key plugged in (USB). Without that it could not lock when you pull it out.");
    cfg = { enabled: true, secret: newSecret(), vendor: YUBICO };
    writeConfig(cfg);
  }
  if (!cfg) throw new Error("The lock is off.");
  startKeyWatch();
  if (!(await keyPresentNow())) throw new Error("Zeff does not see the key plugged in (USB), so it cannot unlock.");
  // A tick later than any removal the watcher wrote while the ceremony ran.
  return { value: sign(cfg.secret, Date.now()), maxAge: Math.floor(SESSION_MS / 1000) };
}

/** Lock now, every browser: all sessions issued up to this moment end. */
export function lockNow(): void {
  const s = readState();
  if (s) writeState({ ...s, removedAt: Date.now() });
}

/** Switch the lock off (the route checks the session first). */
export function disableLock(): void {
  const cfg = readConfig();
  if (cfg) writeConfig({ ...cfg, enabled: false });
}
