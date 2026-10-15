import { knownPermissions } from "@/lib/plugins/api";

/** The permissions in words, translated: Zeff's own and those the installed plugins bring (a plugin that isn't installed brings none). */
export const permissionTexts = (): Record<string, string> => knownPermissions();
