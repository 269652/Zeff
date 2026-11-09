/**
 * A page older than the server (Zeff or the phone's server rebuilt while it was open): its buttons' Server Actions
 * aren't known there any more — Next says "Server Action … was not found on the server". Reloading fetches the page as
 * it is now; at most once a minute (a page that keeps failing is shown, not reloaded in a loop). Client only.
 */
const KEY = "zeff-stale-reload";

export const isStaleActionError = (e: unknown): boolean =>
  /Server Action .*was not found on the server|Failed to find Server Action|UnrecognizedActionError/i.test(
    e instanceof Error ? `${e.name} ${e.message}` : String((e as { message?: unknown })?.message ?? e ?? ""),
  );

/** Reloads the page for a stale Server Action — true when it does (not again within a minute). */
export function reloadIfStale(e: unknown): boolean {
  if (typeof window === "undefined" || !isStaleActionError(e)) return false;
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // no storage: reload anyway (once — the page that comes is new)
  }
  window.location.reload();
  return true;
}
