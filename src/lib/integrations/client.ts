import { MOUNTED_CLIENT } from "./mounted-client";
import type { IntegrationClient } from "./types";

/** The components a plugin of a mounted integration shows in Zeff's pages (null: it isn't mounted, or shows none). */
export const integrationClient = (id: string): IntegrationClient | null => MOUNTED_CLIENT.find((m) => id in m.client)?.client[id] ?? null;
