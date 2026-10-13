/**
 * Which part of Zeff this server is. By default one server does it all ("all"). With the launcher's sync host
 * there are two: the "web" server (the pages, the actions, the MCP) and the "sync" server (the syncs, the
 * scheduler, the briefing and the other AI steps behind it, backups) — so a deploy restarts the pages while a
 * sync goes on. The web server hands everything long-running to the sync host (ZEFF_SYNC_HOST) and mirrors what
 * it is doing (mirror.ts); without that address it does it itself, as ever.
 */
export type Role = "all" | "web" | "sync";

export const role = (): Role => (process.env.ZEFF_ROLE === "web" ? "web" : process.env.ZEFF_ROLE === "sync" ? "sync" : "all");

/** The sync host's address (http://127.0.0.1:9334), when this is a web server that has one. */
export const syncHostUrl = (): string | null => (role() === "web" ? process.env.ZEFF_SYNC_HOST?.replace(/\/+$/, "") || null : null);

/** This server hands long-running work (syncs, runs) to the sync host. */
export const delegates = (): boolean => !!syncHostUrl();

/** This server runs the work itself (the scheduler, the syncs, the runs): alone, or as the sync host. */
export const runsWork = (): boolean => !delegates();

/** The secret web and sync host share (the launcher makes it): the host answers nobody without it. */
export const hostToken = (): string => process.env.ZEFF_SYNC_TOKEN ?? "";

/** Whether a request carries the shared secret. A host without one answers nobody. */
export function authorized(req: Request): boolean {
  const token = hostToken();
  return !!token && req.headers.get("authorization") === `Bearer ${token}`;
}
