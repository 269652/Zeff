import { AsyncLocalStorage } from "node:async_hooks";
import { execFile, type ChildProcess } from "node:child_process";

/**
 * Stopping a sync: each one runs with an abort signal that whatever it starts underneath — a
 * browser driver, the Claude or Copilot CLI — reads from here (no parameter threaded through) and
 * ends itself on. Shared across the server's module copies (on globalThis).
 */
const g = globalThis as { __zeffAbortStore?: AsyncLocalStorage<AbortSignal> };
const store = (g.__zeffAbortStore ??= new AsyncLocalStorage<AbortSignal>());

export const ABORTED = "Abgebrochen.";

/** Run with this signal — and, if there's one around already (a step of the Lage), stopped with that too. */
export function withAbort<T>(controller: AbortController, fn: () => Promise<T>): Promise<T> {
  const outer = store.getStore();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return store.run(controller.signal, fn);
}

/** Stopped: a step's loop ends here (between batches). */
export function throwIfAborted(): void {
  if (store.getStore()?.aborted) throw new Error(ABORTED);
}

/** Call this when the sync is stopped (at once if it is already) — a function to stop listening. */
export function onAbort(cb: () => void): () => void {
  const s = store.getStore();
  if (!s) return () => {};
  // Stopped already: called on the next turn (the caller's own setup — its timer — done by then).
  if (s.aborted) {
    const t = setImmediate(cb);
    return () => clearImmediate(t);
  }
  s.addEventListener("abort", cb, { once: true });
  return () => s.removeEventListener("abort", cb);
}

/** A process and what it started (the CLIs start more), ended. */
export function killTree(child: ChildProcess): void {
  if (child.pid && process.platform === "win32") execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
  else child.kill();
}
