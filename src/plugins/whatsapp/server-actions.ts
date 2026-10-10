"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";

/** WhatsApp: its server actions (each answers an ActionState unless it says otherwise). */

/** "WhatsApp syncen" on the Nachrichten page: the chats' latest messages from WhatsApp Web's chat list (no chat opened) — through the Sync menu's step, so it records how it went. */
export async function syncWhatsappAction(): Promise<ActionState> {
  if (!(await import("@/plugins/state")).isInstalled("whatsapp")) return { ok: false, error: "WhatsApp ist nicht installiert (Menü → Plugins)." };
  const { syncAndWait } = await import("@/lib/sync/registry");
  const r = await syncAndWait("whatsapp");
  revalidateAll();
  return r.lastOk ? { ok: true, message: r.lastMessage ?? "" } : { ok: false, error: r.lastMessage ?? "Fehlgeschlagen." };
}
