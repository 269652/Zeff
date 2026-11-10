/** The small marks' look for this account (look.ts). Server only. */
import { getPref, setPref } from "@/lib/prefs";
import { DEFAULT_LOOK, parseLook, type BadgeLook } from "./look";

const PREF = "badges.look";

export function getBadgeLook(): BadgeLook {
  try {
    return parseLook(getPref<unknown>(PREF, null));
  } catch {
    return DEFAULT_LOOK;
  }
}

export function setBadgeLook(look: unknown): BadgeLook {
  const clean = parseLook(look);
  setPref(PREF, clean);
  return clean;
}
