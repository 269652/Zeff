import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

const { syncState } = schema;

/** The steps without settings of their own: how often they run by itself unless set otherwise (minutes). */
export const DEFAULT_MINUTES = { jira: 15, calendar: 15, chrono: 240, punch: 1440, whatsapp: 15, keep: 60 } as const;
export type OwnIntervalKey = keyof typeof DEFAULT_MINUTES;

/** How often a step runs by itself (minutes, 0: only by hand) — as set on the Sync settings page, else its default. */
export function stepMinutes(key: OwnIntervalKey): number {
  const r = getDb().select({ m: syncState.everyMinutes }).from(syncState).where(eq(syncState.key, key)).get();
  return r?.m ?? DEFAULT_MINUTES[key];
}

export function setStepMinutes(key: OwnIntervalKey, minutes: number): void {
  const everyMinutes = Math.max(0, Math.min(10080, Math.round(minutes)));
  getDb().insert(syncState).values({ key, everyMinutes }).onConflictDoUpdate({ target: syncState.key, set: { everyMinutes } }).run();
}

