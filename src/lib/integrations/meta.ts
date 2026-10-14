import type { PluginManifest } from "@/plugins/catalog";
import { MOUNTED_META } from "./mounted-meta";
import type { IntegrationMeta } from "./types";

/** The plugins of the mounted integrations (data only: client-safe) — none when nothing is mounted. */
export const integrationMetas = (): IntegrationMeta[] => MOUNTED_META.flatMap((m) => m.meta);
/** Their catalog entries: the plugin catalog adds them to its own. */
export const integrationManifests = (): PluginManifest[] => integrationMetas().map((m) => m.manifest);
/** Whether a plugin id is brought by a mounted integration. */
export const isMounted = (id: string) => integrationMetas().some((m) => m.id === id);
