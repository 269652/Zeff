/**
 * What goes around every LLM call (plugins/llm/run.ts): a retry for an answer without JSON, a small
 * cache for tasks whose identical input must give an equal answer, and a gate that keeps background
 * jobs and review loops from starting too many CLIs at once. Server only; no imports of its own
 * beyond the abort helpers, so they are testable with fakes.
 */
import { createHash } from "node:crypto";
import { ABORTED } from "@/lib/abort";
import { NoJsonError } from "./json";
import type { AiProvider } from "./shared";

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

/** Whether a failed attempt is worth one more try: Copilot and Codex answered without parseable JSON. */
export const retryable = (provider: AiProvider, err: unknown): boolean => provider !== "claude" && err instanceof NoJsonError;

/** Two attempts in all (the same prompt) when the first answer had no JSON; anything else fails at once. `before` runs ahead of the second (e.g. to stop when aborted). */
export async function withNoJsonRetry<T>(provider: AiProvider, attempt: () => Promise<T>, before?: () => void): Promise<T> {
  try {
    return await attempt();
  } catch (e) {
    if (!retryable(provider, e)) throw e;
    before?.();
    return attempt();
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export type AnswerCache<V> = { get(key: string): V | undefined; set(key: string, value: V): void; clear(): void; readonly size: number };

/** Entries live `ttlMs`; at most `max` of them (the oldest goes first). */
export function createAnswerCache<V>(opts: { ttlMs: number; max: number; now?: () => number }): AnswerCache<V> {
  const now = opts.now ?? Date.now;
  const map = new Map<string, { at: number; value: V }>();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (now() - hit.at >= opts.ttlMs) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      while (map.size >= opts.max) map.delete(map.keys().next().value as string);
      map.set(key, { at: now(), value });
    },
    clear: () => map.clear(),
    get size() {
      return map.size;
    },
  };
}

/** The key of a call: a hash of everything that decides its answer. */
export const answerKey = (parts: unknown[]): string => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export type Gate = { run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>; readonly active: number; readonly waiting: number };

/** At most `max` at once, the rest in line (first come, first served). The slot is given back when `fn` ends — however it ends; a stopped (aborted) waiter leaves the line and rejects with ABORTED. */
export function createGate(max: number): Gate {
  let active = 0;
  const line: { go: () => void }[] = [];
  const release = () => {
    const next = line.shift();
    if (next) next.go(); // the slot passes on as it is
    else active--;
  };
  const acquire = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) return Promise.reject(new Error(ABORTED));
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const entry = {
        go: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
      };
      const onAbort = () => {
        const i = line.indexOf(entry);
        if (i >= 0) line.splice(i, 1);
        reject(new Error(ABORTED));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      line.push(entry);
    });
  };
  return {
    async run(fn, signal) {
      await acquire(signal);
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return line.length;
    },
  };
}
