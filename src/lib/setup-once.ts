/**
 * Work a page needs done before it is drawn — making its databases, its pages — done once, not on every request: once per key (an
 * account and the plugins installed in it), again when `ttlMs` is up (something connected since: a new mailbox gets its database).
 * Two requests at once wait for the same run; one that failed is tried again by the next. Server only.
 */

const g = globalThis as { __zeffSetupOnce?: Map<string, { at: number; done: Promise<void> }> };

export function setupOnce(key: string, fn: () => unknown, ttlMs = 10 * 60_000): Promise<void> {
  const memo = (g.__zeffSetupOnce ??= new Map());
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.done;
  const done = Promise.resolve()
    .then(fn)
    .then(() => undefined)
    .catch((e: unknown) => {
      memo.delete(key);
      throw e;
    });
  memo.set(key, { at: Date.now(), done });
  return done;
}
