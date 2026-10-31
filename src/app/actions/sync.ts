"use server";

import { t } from "@/lib/i18n/server";
import type { ActionState } from "@/app/action-helpers";

// ---------------------------------------------------------------------------
// The header's sync menu (every sync, its last run, its next)
// ---------------------------------------------------------------------------

/** Every sync step: running?, how it last went, when it runs next by itself. */
export async function syncOverviewAction(): Promise<import("@/lib/sync/shared").SyncOverview> {
  const { syncOverview } = await import("@/lib/sync/registry");
  const overview = syncOverview();
  // How each source holds up (cached a minute): a dot and why on the steps that aren't well.
  try {
    const { sourceHealth } = await import("@/lib/sync/source-health");
    const { healthReason } = await import("@/lib/sync/source-health-shared");
    const health = (await sourceHealth()).flatMap((h) => (h.state === "ok" ? [] : [{ key: h.key, state: h.state, reason: healthReason(t, h) }]));
    return { ...overview, health };
  } catch (e) {
    console.error("[sync] source health", e);
    return overview;
  }
}

/** One step, started in the background (the menu follows it). */
export async function runSyncAction(key: string): Promise<ActionState> {
  const { isSyncKey, startSync } = await import("@/lib/sync/registry");
  if (!isSyncKey(key)) return { ok: false, error: t("Unknown sync.") };
  const r = await startSync(key);
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

/** Stop a sync that's running (Sync menu, a page's button) — and what it started. */
export async function stopSyncAction(key: string): Promise<ActionState> {
  const { stopSync } = await import("@/lib/sync/registry");
  return (await stopSync(String(key))) ? { ok: true, message: t("Stopping.") } : { ok: false, error: t("Not running.") };
}

/** Stop "Sync all" (the step it's on, and the rest). */
export async function stopSyncAllAction(): Promise<ActionState> {
  const { stopSyncAll } = await import("@/lib/sync/registry");
  return (await stopSyncAll()) ? { ok: true, message: t("Stopping.") } : { ok: false, error: t("Not running.") };
}

/** "Sync all": every step one after the other, in the background. */
export async function runSyncAllAction(): Promise<ActionState> {
  const { startSyncAll } = await import("@/lib/sync/registry");
  const r = await startSyncAll();
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}
