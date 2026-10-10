/**
 * The Sync settings page's parts: each plugin that brings a sync has a settings module
 * (src/plugins/<id>/sync-settings.ts) — its syncs, how often each runs by itself, and the steps
 * that only run with another. Types only (the modules read and write their own settings).
 */

/** A sync a plugin brings, and how often it runs by itself. */
export type SyncInterval = {
  /** The Sync menu's step (its last and next run are shown) — or the plugin's own job ("backup"). */
  key: string;
  label: string;
  what: string;
  /** Minutes between runs by itself; 0: only by hand. */
  get: () => number;
  set: (minutes: number) => void;
  /** What can be picked (minutes) — the current value is added if it isn't one. */
  choices: readonly number[];
  /** When it may run by itself, if not always. */
  window?: string;
};

/** A step without an interval of its own: it runs with (after) another. */
export type SyncFollower = { key: string; label: string; follows: string };

export type PluginSyncSettings = { intervals?: SyncInterval[]; follows?: SyncFollower[] };

/** The usual choices: by hand, minutes, hours, once a day. */
export const MINUTE_CHOICES = [0, 5, 10, 15, 30, 60, 120, 240, 480, 720, 1440] as const;

/** "alle 15 min", "stündlich", "nur von Hand". */
export function minutesText(m: number): string {
  if (!m) return "nur von Hand";
  if (m === 60) return "stündlich";
  if (m === 1440) return "täglich";
  if (m === 10080) return "wöchentlich";
  if (m % 1440 === 0) return `alle ${m / 1440} Tage`;
  if (m % 60 === 0) return `alle ${m / 60} h`;
  return `alle ${m} min`;
}
