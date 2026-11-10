/** The Workspace tree's badge settings for this account (badge-config.ts). Server only. */
import { getPref, setPref } from "@/lib/prefs";
import { DEFAULT_WS_BADGES, parseWsBadges, type WsBadgeConfig } from "./badge-config";

const PREF = "workspace.badges";

export function getWsBadges(): WsBadgeConfig {
  try {
    return parseWsBadges(getPref<unknown>(PREF, null));
  } catch {
    return DEFAULT_WS_BADGES;
  }
}

export function setWsBadges(config: unknown): WsBadgeConfig {
  const clean = parseWsBadges(config);
  setPref(PREF, clean);
  return clean;
}
