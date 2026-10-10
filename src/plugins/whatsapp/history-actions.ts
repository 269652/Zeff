"use server";

import { revalidatePath } from "next/cache";
import { isInstalled } from "@/plugins/state";
import { pullWhatsappHistory } from "./history";

/** "Ganzen Verlauf laden" on a chat (WhatsApp app): its whole history, from the phone too. */
export async function pullWhatsappHistoryAction(chat: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  if (!isInstalled("whatsapp")) return { ok: false, error: "WhatsApp ist nicht installiert (Menü → Plugins)." };
  const name = String(chat ?? "").trim();
  if (!name) return { ok: false, error: "Welcher Chat?" };
  const r = await pullWhatsappHistory(name);
  revalidatePath("/apps/whatsapp");
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}
