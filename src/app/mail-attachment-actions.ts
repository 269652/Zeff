"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import type { AttachmentSettings } from "@/lib/mail/attachment-rules";

/** Server actions for the mail attachments → Documents step (settings, the one-time notice, “Fetch now”). */

async function guard(): Promise<string | null> {
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("documents")) return t("The Documents plugin is not installed (Menu → Plugins).");
  if (!isInstalled("outlook-mail") && !isInstalled("gmail")) return t("No mail plugin installed (Outlook Mail or Gmail).");
  return null;
}

/** Save the settings (anything out of bounds is brought back in). */
export async function saveAttachmentSettingsAction(values: Partial<AttachmentSettings>): Promise<ActionState> {
  try {
    const no = await guard();
    if (no) return { ok: false, error: no };
    const { saveAttachmentSettings } = await import("@/lib/mail/attachments-store");
    // Whoever saved the settings has seen the notice.
    const { answerAttachmentOffer, attachmentOfferAnswer } = await import("@/lib/mail/attachments-store");
    if (attachmentOfferAnswer() === null) answerAttachmentOffer(values.enabled ? "on" : "later");
    const s = saveAttachmentSettings(values);
    revalidateAll();
    return { ok: true, message: s.enabled ? t("Saved. Attachments of your mails are taken into Documents.") : t("Saved. Attachments are not fetched.") };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The one-time notice: “Turn on” enables it (its settings open next), “Not now” never asks again. */
export async function answerAttachmentOfferAction(answer: "on" | "later"): Promise<ActionState> {
  try {
    const no = await guard();
    if (no) return { ok: false, error: no };
    const { answerAttachmentOffer, saveAttachmentSettings } = await import("@/lib/mail/attachments-store");
    answerAttachmentOffer(answer === "on" ? "on" : "later");
    if (answer === "on") saveAttachmentSettings({ enabled: true });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * “Fetch attachments now”: the mails the list flagged in the last days. Mails read before the list
 * could say whether they have attachments are read again first (the Mail sync, two months).
 */
export async function fetchAttachmentsNowAction(): Promise<ActionState> {
  try {
    const no = await guard();
    if (no) return { ok: false, error: no };
    const { attachmentSettings, unknownAttachmentMails } = await import("@/lib/mail/attachments-store");
    const s = attachmentSettings();
    if (!s.enabled) return { ok: false, error: t("Turn on “Take attachments into Documents” first.") };
    if (unknownAttachmentMails(Math.min(s.days, 60)) > 0) {
      const { syncAndWait } = await import("@/lib/sync/registry");
      await syncAndWait("mail");
    }
    const { fetchMailAttachments } = await import("@/lib/mail/attachments-sync");
    const r = await fetchMailAttachments({ manual: true });
    revalidateAll();
    if (r.error && !r.documents) return { ok: false, error: r.message };
    return { ok: true, message: r.message || t("No new attachments.") };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
