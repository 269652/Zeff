import { getPref, setPref } from "@/lib/prefs";
import { resolveWeek } from "@/lib/week";
import { TOUCH_ACTIONS, type TouchAction } from "./actions";
import { b64u, newChallenge, verifyAssertion, verifyRegistration, type RegistrationInput, type AssertionInput, type StoredCredential } from "./webauthn";
import { currentAccountId } from "@/db/accounts";

/**
 * Touch to approve: an action that reaches outside Zeff (the export into Chrono and Punch) can be made to wait for a touch
 * of a security key. The browser asks the key (WebAuthn), the server checks the answer and keeps a one-time approval for
 * exactly that action and scope; the code that acts then takes it (requireTouch) — or refuses. Server-only.
 *
 * Nothing is asked until a key is registered AND the action is switched on (Settings). Registered keys and the
 * switches live in the prefs; challenges and approvals only in memory, for two minutes.
 */

const CREDENTIALS = "touch.credentials";
const GUARDED = "touch.guarded";
const WINDOW_MS = 2 * 60 * 1000;

export class TouchRequiredError extends Error {
  constructor(what: string) {
    super(`Touch your security key to approve ${what}: Zeff asks in the browser before it starts.`);
    this.name = "TouchRequiredError";
  }
}

type Pending = { kind: "register" | "assert" | "unlock"; action: TouchAction; scope: string; origin: string; expires: number };
// One state for every bundle of the server (a route and a server action may load this module twice).
const g = globalThis as { __zeffTouch?: { pending: Map<string, Pending>; approvals: Map<string, number> } };
const state = (g.__zeffTouch ??= { pending: new Map(), approvals: new Map() });

function prune(): void {
  const now = Date.now();
  for (const [k, p] of state.pending) if (p.expires < now) state.pending.delete(k);
  for (const [k, e] of state.approvals) if (e < now) state.approvals.delete(k);
}

export const listCredentials = (): StoredCredential[] => getPref<StoredCredential[]>(CREDENTIALS, []);
export const guardedActions = (): TouchAction[] => getPref<string[]>(GUARDED, []).filter((a): a is TouchAction => (TOUCH_ACTIONS as readonly string[]).includes(a));

/** Whether this action waits for a touch now: a key is registered, and (for the settings of this very feature: always) it is switched on. */
export function touchNeeded(action: TouchAction): boolean {
  if (listCredentials().length === 0) return false;
  return action === "touch-settings" || guardedActions().includes(action);
}

/** The scope as the code that acts will name it: for an export "<chrono|punch>|<week>" (the page knows the week as typed). */
function normalizeScope(action: TouchAction, raw: string): string {
  if (action !== "booking-export") return "";
  const [system, week] = String(raw).split("|");
  if (system !== "chrono" && system !== "punch") throw new Error("Unknown system.");
  const w = resolveWeek(week);
  if (!w) throw new Error("Could not read the week.");
  return `${system}|${w.startIso}`;
}

// Per account: an approval given in one account (a touch of the key) is never used up by the same action in another.
const key = (action: TouchAction, scope: string) => `${currentAccountId()}\n${action}\n${scope}`;

/** Take the approval for this action and scope (one use), or throw. A no-op while the action isn't guarded. `scope` as the actor knows it ("chrono|2026-10-12"). */
export function requireTouch(action: TouchAction, scope: string, what = "this action"): void {
  if (!touchNeeded(action)) return;
  prune();
  const k = key(action, scope);
  const expires = state.approvals.get(k);
  if (!expires || expires < Date.now()) throw new TouchRequiredError(what);
  state.approvals.delete(k);
}

const hostOf = (origin: string): string => new URL(origin).hostname;

export type RegisterOptions = {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  excludeCredentials: { id: string; type: "public-key" }[];
};

/** Step 1 of adding a key. With a key already registered it takes a touch first (action "touch-settings"). */
export function beginRegistration(origin: string): RegisterOptions {
  requireTouch("touch-settings", "", "adding another key");
  prune();
  const challenge = newChallenge();
  state.pending.set(challenge, { kind: "register", action: "touch-settings", scope: "", origin, expires: Date.now() + WINDOW_MS });
  const rpId = hostOf(origin);
  return {
    challenge,
    rp: { id: rpId, name: "Zeff" },
    user: { id: b64u.enc(Buffer.from("zeff")), name: "zeff", displayName: "Zeff" },
    excludeCredentials: listCredentials().filter((c) => c.rpId === rpId).map((c) => ({ id: c.id, type: "public-key" as const })),
  };
}

/** Step 2: the key's answer, checked; the key is kept. */
export function finishRegistration(origin: string, challenge: string, input: RegistrationInput, label: string): StoredCredential {
  const p = state.pending.get(challenge);
  state.pending.delete(challenge);
  if (!p || p.kind !== "register" || p.origin !== origin || p.expires < Date.now()) throw new Error("The request expired — try again.");
  const rpId = hostOf(origin);
  const { id, publicKey } = verifyRegistration(input, { challenge, origin, rpId });
  const all = listCredentials();
  if (all.some((c) => c.id === id)) throw new Error("This key is registered already.");
  const cred: StoredCredential = { id, publicKey, rpId, label: label.trim().slice(0, 60) || "Security key", signCount: 0, createdAt: new Date().toISOString() };
  setPref(CREDENTIALS, [...all, cred]);
  return cred;
}

export type AssertOptions = { challenge: string; rpId: string; allowCredentials: { id: string; type: "public-key" }[] };

/** Step 1 of a touch: `null` when this action needs none (the page goes on), else what the browser asks the key. */
export function beginAssertion(action: TouchAction, rawScope: string, origin: string): AssertOptions | null {
  if (!touchNeeded(action)) return null;
  const rpId = hostOf(origin);
  const keys = listCredentials().filter((c) => c.rpId === rpId);
  if (keys.length === 0) throw new Error(`No key is registered for ${rpId}. Open Zeff at the address you registered the key on.`);
  const scope = normalizeScope(action, rawScope);
  prune();
  const challenge = newChallenge();
  state.pending.set(challenge, { kind: "assert", action, scope, origin, expires: Date.now() + WINDOW_MS });
  return { challenge, rpId, allowCredentials: keys.map((c) => ({ id: c.id, type: "public-key" as const })) };
}

/** Step 2: the touch, checked; the approval for the action and scope waits (one use, two minutes). */
export function finishAssertion(origin: string, challenge: string, input: AssertionInput): void {
  const p = state.pending.get(challenge);
  state.pending.delete(challenge);
  if (!p || p.kind !== "assert" || p.origin !== origin || p.expires < Date.now()) throw new Error("The request expired — try again.");
  const all = listCredentials();
  const cred = all.find((c) => c.id === input.id);
  if (!cred) throw new Error("This is not a registered key.");
  const { signCount } = verifyAssertion(input, cred, { challenge, origin });
  setPref(CREDENTIALS, all.map((c) => (c.id === cred.id ? { ...c, signCount } : c)));
  state.approvals.set(key(p.action, p.scope), Date.now() + WINDOW_MS);
}

/**
 * The lock screen's ceremony (see lib/lock): a touch AND the key's PIN (user verification), for any registered key — it is
 * not tied to an action and leaves no approval behind; the caller starts the session.
 */
export function beginUnlockAssertion(origin: string): AssertOptions {
  const rpId = hostOf(origin);
  const keys = listCredentials().filter((c) => c.rpId === rpId);
  if (keys.length === 0) throw new Error(`No key is registered for ${rpId}. Open Zeff at the address you registered the key on.`);
  prune();
  const challenge = newChallenge();
  state.pending.set(challenge, { kind: "unlock", action: "touch-settings", scope: "", origin, expires: Date.now() + WINDOW_MS });
  return { challenge, rpId, allowCredentials: keys.map((c) => ({ id: c.id, type: "public-key" as const })) };
}

/** Step 2 of the lock screen: the touch and the PIN, checked (the key's own flag, inside the signed data). Throws when not. */
export function finishUnlockAssertion(origin: string, challenge: string, input: AssertionInput): void {
  const p = state.pending.get(challenge);
  state.pending.delete(challenge);
  if (!p || p.kind !== "unlock" || p.origin !== origin || p.expires < Date.now()) throw new Error("The request expired — try again.");
  const all = listCredentials();
  const cred = all.find((c) => c.id === input.id);
  if (!cred) throw new Error("This is not a registered key.");
  const { signCount } = verifyAssertion(input, cred, { challenge, origin, userVerified: true });
  setPref(CREDENTIALS, all.map((c) => (c.id === cred.id ? { ...c, signCount } : c)));
}

/** Settings: switch an action's touch on or off (the settings take a touch themselves once a key exists). */
export function setGuarded(actions: TouchAction[]): void {
  requireTouch("touch-settings", "", "changing this setting");
  if (actions.length > 0 && listCredentials().length === 0) throw new Error("Register a security key first.");
  setPref(GUARDED, actions.filter((a) => a !== "touch-settings"));
}

/** Settings: forget a key. The last one goes with every switch (nothing could be approved any more). */
export function removeCredential(id: string): void {
  requireTouch("touch-settings", "", "removing a key");
  const left = listCredentials().filter((c) => c.id !== id);
  setPref(CREDENTIALS, left);
  if (left.length === 0) setPref(GUARDED, []);
}
