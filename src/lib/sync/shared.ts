/** The header's sync menu — the steps, as the page sees them (client-safe). */

export const SYNC_KEYS = ["jira", "teams", "mail", "whatsapp", "keep", "gitlab", "calendar", "roar", "timo", "boards", "mailtodos", "relations", "autoactions", "boardlage"] as const;
export type SyncKey = (typeof SYNC_KEYS)[number];

export const isSyncKey = (v: unknown): v is SyncKey => (SYNC_KEYS as readonly unknown[]).includes(v);

/** One step: where it is, how it last went, whether and when it runs by itself. */
export type SyncView = {
  key: SyncKey;
  label: string;
  href: string;
  /** What it does, for the tooltip. */
  what: string;
  running: boolean;
  /** ISO times. */
  lastAt: string | null;
  lastOk: boolean | null;
  lastMessage: string | null;
  /** Minutes between runs by itself; 0: only by hand. */
  everyMinutes: number;
  /** When it runs next by itself (ISO), if it does. */
  nextAt: string | null;
  /** When it may run by itself, if not always (e.g. "workdays 7–20"). */
  window: string | null;
};

export type SyncOverview = {
  /** "Sync all" going: the step it's on. */
  all: { running: boolean; step: SyncKey | null };
  steps: SyncView[];
};
