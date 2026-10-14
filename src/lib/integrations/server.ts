import path from "node:path";
import { MOUNTED_SERVER } from "./mounted-server";
import type { IntegrationServer } from "./types";

/** What a plugin of a mounted integration does on the server (null: it isn't mounted, or has no server part). */
export const integrationServer = (id: string): IntegrationServer | null => MOUNTED_SERVER.find((m) => id in m.server)?.server[id] ?? null;

/** The ids of the plugins that bring a server part. */
export const integrationServerIds = (): string[] => MOUNTED_SERVER.flatMap((m) => Object.keys(m.server));

/** Where a plugin's browser driver is (null: it has none, or isn't mounted). */
export function integrationDriverPath(id: string): string | null {
  const m = MOUNTED_SERVER.find((x) => id in x.server);
  const file = m?.server[id]?.driver;
  return m && file ? path.join(/*turbopackIgnore: true*/ process.cwd(), m.dir, file) : null;
}
