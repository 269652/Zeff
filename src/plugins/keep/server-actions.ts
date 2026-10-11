"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { t } from "@/lib/i18n/server";

/** Google Keep: its server actions (each answers an ActionState unless it says otherwise). */

/** "Keep syncen" in the Keep app: your Google Keep notes — through the Sync menu's step, so it records how it went. */
export async function syncKeepAction(): Promise<ActionState> {
  if (!(await import("@/plugins/state")).isInstalled("keep")) return { ok: false, error: t("Google Keep is not installed (Menu → Plugins).") };
  const { syncAndWait } = await import("@/lib/sync/registry");
  const r = await syncAndWait("keep");
  revalidateAll();
  return r.lastOk ? { ok: true, message: r.lastMessage ?? "" } : { ok: false, error: r.lastMessage ?? t("Failed.") };
}
