"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";

/**
 * The inbox's replies (/mail): to a conversation, not a Workspace row — a mail drafted (Outlook, Gmail; sent from here with
 * Gmail's write access), a chat message sent (WhatsApp, Signal, Teams) — the same actions and checks a row's reply runs.
 */

type Fail = { ok: false; error: string };

/** A reply drafted by the AI from the conversation (as a row's: System → Prompts, reply-draft). */
export async function inboxDraftReplyAction(target: { channel: string; to: string; subject: string; conv: string }): Promise<{ ok: true; text: string; to: string } | Fail> {
  try {
    if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
    const { draftReply } = await import("@/plugins/workspace/row-actions");
    const r = await draftReply({ channel: String(target.channel), to: String(target.to ?? ""), subject: String(target.subject ?? ""), conv: String(target.conv ?? "") });
    return { ok: true, text: r.text, to: r.to };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The reply's action on your click: a draft's address (it opens for you), a message sent — `mode` a Gmail mail sent or saved via the API. */
export async function inboxReplyAction(conv: string, mailKey: string, op: Record<string, unknown>, mode?: "send" | "draft"): Promise<{ ok: true; href: string | null; what: string | null } | Fail> {
  try {
    const { runConvOp } = await import("@/lib/ops");
    const r = await runConvOp(String(conv ?? ""), String(mailKey ?? ""), op && typeof op === "object" ? op : {}, mode === "send" || mode === "draft" ? mode : undefined);
    return { ok: true, href: r.href ?? null, what: r.what ?? null };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** A Gmail conversation archived or marked unread (with Gmail's write access). */
export async function inboxGmailChangeAction(conv: string, what: "archive" | "unread"): Promise<{ ok: true; message: string } | Fail> {
  try {
    const { gmailConvChange } = await import("@/plugins/gmail/run");
    const message = await gmailConvChange(String(conv ?? ""), what === "unread" ? "unread" : "archive");
    revalidatePath("/mail");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
