/**
 * What can wait for a touch (client-safe: ids only). "booking-export" is the real fill into Chrono or Punch (a dry run is
 * read-only and never asks); "touch-settings" is this feature's own settings, which ask once a key exists.
 */
export const TOUCH_ACTIONS = ["booking-export", "touch-settings"] as const;
export type TouchAction = (typeof TOUCH_ACTIONS)[number];

/** The actions Settings lets you switch on (the settings guard themselves). */
export const GUARDABLE: readonly TouchAction[] = ["booking-export"];
