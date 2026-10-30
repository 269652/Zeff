"use server";

import { revalidatePath } from "next/cache";
import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";

/** Signal: its server actions (each answers an ActionState unless it says otherwise). */

const notInstalled = () => ({ ok: false as const, error: t("Signal is not installed (Menu → Plugins).") });

/** "Signal syncen": the active chats' messages from Signal Desktop — through the Sync menu's step, so it records how it went. */
export async function syncSignalAction(): Promise<ActionState> {
  if (!isInstalled("signal")) return notInstalled();
  const { syncAndWait } = await import("@/lib/sync/registry");
  const r = await syncAndWait("signal");
  revalidateAll();
  return r.lastOk ? { ok: true, message: r.lastMessage ?? "" } : { ok: false, error: r.lastMessage ?? t("Failed.") };
}

/** "Ganzen Verlauf laden" on a chat (Signal app): its whole history as far as Signal Desktop has it. */
export async function pullSignalHistoryAction(chat: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  if (!isInstalled("signal")) return notInstalled();
  const name = String(chat ?? "").trim();
  if (!name) return { ok: false, error: t("Which chat?") };
  const { pullSignalHistory } = await import("./history");
  const r = await pullSignalHistory(name);
  revalidatePath("/mail");
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

/** "Signal starten": Signal Desktop started in the tray with its debug port, if it isn't running. */
export async function startSignalAction(): Promise<ActionState> {
  if (!isInstalled("signal")) return notInstalled();
  const { openSignal } = await import("./open");
  const r = await openSignal();
  revalidatePath("/mail");
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

/** "Autostart mit Port einrichten": Signal's autostart entry starts it with its debug port from now on. */
export async function setupSignalAutostartAction(): Promise<ActionState> {
  if (!isInstalled("signal")) return notInstalled();
  try {
    const { setupSignalAutostart } = await import("./autostart");
    const r = await setupSignalAutostart();
    revalidatePath("/mail");
    return r.withPort ? { ok: true, message: t("Signal now starts with its debug port after every login.") } : { ok: false, error: t("Signal's autostart couldn't be set up here (Windows only).") };
  } catch (e) {
    return { ok: false, error: errorMessage(e).slice(0, 300) };
  }
}
