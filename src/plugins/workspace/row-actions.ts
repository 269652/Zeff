import { t } from "@/lib/i18n/server";
import { rowKey } from "./collections";
import { docText } from "./doc";
import { getDatabase, getPage } from "./store";

/**
 * Zeff's actions from a row of the Workspace (no todo needed): a draft's address (a mail in Outlook / Gmail — you send it),
 * a message sent (Teams, WhatsApp, Signal), something done in Zeff — and a reply drafted by the AI from the row's
 * conversation. What needs a todo (an appointment on it, a worker) runs from a todo.
 */

/** The actions a row can run itself (they need no todo); a draft (href) always can. */
const ROW_RUNNABLE = new Set(["teams-message", "whatsapp-message", "signal-message", "zeff-do"]);

export type RowActionResult = { href?: string; what?: string };

/** Whether a row can run this action now: installed, and a draft (opens for you) or one that needs no todo. */
export async function rowCanRun(type: string): Promise<boolean> {
  const { actionOf } = await import("@/plugins/actions/catalog");
  const { opAvailable } = await import("@/plugins/ops");
  const spec = actionOf(type as never);
  return !!spec && opAvailable(type) && (!!spec.href || ROW_RUNNABLE.has(type));
}

/**
 * An action (as an AI or the views hand it over) for a row, checked and cleaned — what may run from a row: a draft (opens
 * for you) or one that needs no todo, installed. It's run by the click only (lib/ops runRowOp — no runner here: the
 * pipeline, an automatic step, reads this module).
 */
export async function checkRowAction(rowId: number, raw: Record<string, unknown>): Promise<{ op: Record<string, unknown> & { type: string }; href: string | null }> {
  const row = getPage(rowId);
  if (!row?.dbId) throw new Error(t("Not a row of a database."));
  return checkAction(raw, rowKey({ id: row.id, cells: row.props }) ?? "");
}

/** The same check for an action without a row (the inbox's reply to a conversation): a draft, or one that needs no todo. */
export async function checkAction(raw: Record<string, unknown>, ticket = ""): Promise<{ op: Record<string, unknown> & { type: string }; href: string | null }> {
  const { actionOf } = await import("@/plugins/actions/catalog");
  const { opAvailable } = await import("@/plugins/ops");
  const type = String(raw.type ?? "");
  const spec = actionOf(type as never);
  if (!spec) throw new Error(t("Unknown action."));
  if (!spec.href && !ROW_RUNNABLE.has(type)) throw new Error(t("This action runs from a todo (make one from the row)."));
  if (!opAvailable(type)) throw new Error(t("{action}: not installed (Menu → Plugins).", { action: spec.label }));
  const op = spec.clean(raw, { ticket });
  if (!op) throw new Error(t("The action is incomplete."));
  return { op: op as never, href: spec.href ? spec.href(op as never) : null };
}

/** Who a row's reply goes to, and on what: its sender's address and its subject (a mail), its chat (a message). */
function replyTarget(row: NonNullable<ReturnType<typeof getPage>>): { channel: string; to: string; subject: string; conv: string } {
  const p = row.props;
  const select = (prop: string) => getDatabase(row.dbId!)?.schema.properties.find((x) => x.id === prop)?.options?.find((o) => o.id === p[prop])?.name ?? "";
  // A combined inbox's rows carry the shared fields (commfrom, commchannel …); a mail's or a chat's own, the others.
  const channel = select("commchannel") || select("mailaccount") || select("msgchannel");
  const from = typeof p.commfrom === "string" ? p.commfrom : typeof p.mailfrom === "string" ? p.mailfrom : "";
  const conv = String(p.commconv ?? p.mailconv ?? p.msgconv ?? "");
  if (channel === "Outlook" || channel === "Gmail" || (!channel && typeof p.mailfrom === "string")) {
    const address = /<([^>]+)>/.exec(from)?.[1] ?? (/@/.test(from) ? from : "");
    return { channel: channel || "Outlook", to: address, subject: /^(AW|RE|Re|Aw):/.test(row.title) ? row.title : `AW: ${row.title}`, conv };
  }
  return { channel, to: String(p.commwhere ?? p.msgchat ?? ""), subject: "", conv };
}

/** The conversation a row of a mail is in ("gmail:<thread>", Outlook's …) — null: not a row, or not of a mail. */
export function rowMailConv(rowId: number): string | null {
  const row = getPage(rowId);
  if (!row?.dbId) return null;
  return replyTarget(row).conv || null;
}

/** A reply to a row (a mail, a message) drafted by the AI from its conversation — as the reply drafts are (System → Prompts). */
export async function draftRowReply(rowId: number): Promise<{ text: string; to: string; subject: string; channel: string }> {
  const row = getPage(rowId);
  if (!row?.dbId) throw new Error(t("Not a row of a database."));
  return draftReply(replyTarget(row), `${row.title}\n${docText(row.content).slice(0, 3000)}`);
}

/** Who a reply goes to and on what (a conversation of the inbox, a row's) — drafted by the AI from the conversation, else from `alone`. */
export async function draftReply(target: { channel: string; to: string; subject: string; conv: string }, alone = ""): Promise<{ text: string; to: string; subject: string; channel: string }> {
  const { conversationOf } = await import("@/lib/mail/store");
  const history = target.conv && !target.conv.startsWith("19:") ? conversationOf(target.conv, 12).map((m) => `${m.receivedAt.slice(0, 16).replace("T", " ")} ${m.fromName ?? m.fromEmail ?? "?"}: ${m.preview.slice(0, 1500)}`) : [alone];
  const { fillPrompt } = await import("@/lib/prompts");
  const { INSTRUCTIONS } = await import("@/lib/boards/reply-draft");
  const channel = target.channel === "Outlook" || target.channel === "Gmail" ? "Mail" : target.channel === "Teams" ? "Teams-Nachricht" : `${target.channel}-Unterhaltung`;
  const { runAi } = await import("@/lib/ai");
  const r = await runAi<{ text?: string }>(
    [fillPrompt("reply-draft", INSTRUCTIONS, { channel }), "", `# Verlauf (älteste zuerst) — an ${target.to || target.channel}`, ...history, "", `Heute ist ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`].join("\n"),
    { type: "object", required: ["text"], properties: { text: { type: "string" } } },
    { task: "reply-draft", timeoutMs: 3 * 60000, maxBudgetUsd: 0.3 },
  );
  return { text: String(r.output?.text ?? "").trim(), to: target.to, subject: target.subject, channel: target.channel };
}
