"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/** The inbox templates for a database of this type (mails, messages): what the "+ Inbox" menu offers. */
export async function inboxTemplatesAction(dataType: string) {
  const { inboxTemplates } = await import("./templates");
  return inboxTemplates(dataType === "mail" || dataType === "message" ? dataType : undefined).map((x) => ({ id: x.id, title: t(x.title), icon: x.icon, description: t(x.description) }));
}

/** An inbox from a template under the database — its id; its rows read at once (in the background). */
export async function createInboxAction(parentId: number, templateId: string): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    const id = await (await import("./templates")).createInbox(Number(parentId), String(templateId));
    (await import("@/plugins/workspace/pipeline")).startPipeline(id, { ai: false });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
