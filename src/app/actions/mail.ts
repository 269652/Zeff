"use server";

import { t } from "@/lib/i18n/server";
import { revalidateAll, type ActionState } from "@/app/action-helpers";

/** Mails matching words (sender, subject, text) — for the source picker; a few, newest first. */
export async function searchMailsAction(q: string): Promise<import("@/lib/mail/shared").MailView[]> {
  const text = String(q ?? "").trim();
  if (text.length < 2) return [];
  const { listMails } = await import("@/lib/mail/store");
  return listMails({ q: text, limit: 6 });
}

/** "Sync now" on the Nachrichten page: read the inbox's latest mails in the automation Chrome (read-only: none opened; opens Outlook's mail there if needed). */
export async function syncMailAction(): Promise<ActionState> {
  // Through the Sync menu's step: stoppable from there (and from the page's button).
  const { syncAndWait } = await import("@/lib/sync/registry");
  const r = await syncAndWait("mail");
  revalidateAll();
  return r.lastOk ? { ok: true, message: r.lastMessage ?? "" } : { ok: false, error: r.lastMessage ?? t("Failed.") };
}

/** Which Outlook folders the mail sync reads, by name as Outlook lists them ("Posteingang, Notifications"). */
export async function saveMailFoldersAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const text = String(fd.get("folders") ?? "");
  const folders = [...new Set(text.split(",").map((f) => f.trim()).filter(Boolean))].slice(0, 12);
  if (!folders.length) return { ok: false, error: t("At least one folder (e.g. Posteingang).") };
  const { updateMailSettings } = await import("@/lib/mail/store");
  updateMailSettings({ folders });
  revalidateAll();
  return { ok: true, message: t("Reads: {folders}.", { folders: folders.join(", ") }) };
}

/** The Sync settings page: how often one sync runs by itself (an installed plugin's — its settings module sets it). */
export async function saveSyncIntervalAction(key: string, minutes: number): Promise<ActionState> {
  const { findSyncInterval } = await import("@/plugins/sync-settings-modules");
  const i = findSyncInterval(String(key));
  if (!i) return { ok: false, error: t("There is no such sync (plugin not installed?).") };
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m < 0 || m > Math.max(...i.choices, i.get())) return { ok: false, error: t("Not a valid interval.") };
  i.set(m);
  revalidateAll();
  const { minutesText } = await import("@/plugins/sync-settings");
  return { ok: true, message: minutesText(m, t) };
}
