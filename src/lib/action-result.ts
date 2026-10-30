import { errorMessage } from "@/lib/errors";
import { isInstalled } from "@/plugins/state";

/** What a server action answers: ok with its own fields, or not ok with the error message. */
export type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/** `fn`'s fields after `ok: true` — or, when it throws, `{ ok: false, error }` with the error's message. */
export async function run<T extends object>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * `run` for a plugin's actions: when the plugin is not installed, the answer is `{ ok: false, error: notInstalled() }`
 * (a function, so its text is translated when the action runs).
 */
export function pluginAction(id: string, notInstalled: () => string) {
  return <T extends object>(fn: () => T | Promise<T>): Promise<Result<T>> =>
    run(() => {
      if (!isInstalled(id)) throw new Error(notInstalled());
      return fn();
    });
}
