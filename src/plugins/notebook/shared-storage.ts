import { getPref, setPref } from "@/lib/prefs";

/**
 * The shared storage of a notebook: strings by key, shared by the kernels of one page (Python, Node.js, Rust) — like localStorage
 * between them. What goes in is serialized by the code (JSON text …) and parsed by the code that reads it. Kept with the page (the
 * preferences), so it survives a restart of the sessions. Not a way into Zeff's data: it holds only what the notebook put there, and
 * needs no permission. Server only.
 */

const MAX_KEY = 200;
const MAX_VALUE = 2_000_000;
const MAX_TOTAL = 10_000_000;
const prefKey = (session: string) => `notebook.shared.${session}`;

/** Everything the page's kernels have put there (a copy). */
export function readShared(session: string): Record<string, string> {
  const v = getPref<unknown>(prefKey(session), {});
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "string") out[k] = x;
  return out;
}

/** A change a kernel made: set, remove or clear. What is too big or too much is refused in words (it throws). */
export function applyShared(session: string, op: string, key: string, value?: string): void {
  const m = readShared(session);
  if (op === "clear") {
    setPref(prefKey(session), {});
    return;
  }
  if (!key || key.length > MAX_KEY) throw new Error(`sharedStorage: a key is 1 to ${MAX_KEY} characters.`);
  if (op === "remove") delete m[key];
  else if (op === "set") {
    if (typeof value !== "string") throw new Error("sharedStorage holds strings: serialize the value first.");
    if (value.length > MAX_VALUE) throw new Error(`sharedStorage: “${key.slice(0, 40)}” is too big (at most ${MAX_VALUE / 1_000_000} MB a value).`);
    m[key] = value;
    if (Object.entries(m).reduce((n, [k, x]) => n + k.length + x.length, 0) > MAX_TOTAL) throw new Error(`sharedStorage: it holds at most ${MAX_TOTAL / 1_000_000} MB.`);
  } else throw new Error(`sharedStorage: no such operation “${op.slice(0, 20)}”.`);
  setPref(prefKey(session), m);
}

/** What a kernel is given: the storage as it is now, and how it hands its changes back. */
export type SharedAccess = { snapshot: Record<string, string>; apply(op: string, key: string, value?: string): void };
export function sharedAccess(session: string, onError: (text: string) => void): SharedAccess {
  return {
    snapshot: readShared(session),
    apply(op, key, value) {
      try {
        applyShared(session, op, key, value);
      } catch (e) {
        onError(`[${e instanceof Error ? e.message : String(e)}]\n`);
      }
    },
  };
}
