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

/** An action (as an AI or the views hand it over) run from a row: cleaned, checked, then opened (a draft) or run. */
export async function runRowAction(rowId: number, raw: Record<string, unknown>): Promise<RowActionResult> {
  const row = getPage(rowId);
  if (!row?.dbId) throw new Error(t("Not a row of a database."));
  const { actionOf } = await import("@/plugins/actions/catalog");
  const { opAvailable } = await import("@/plugins/ops");
  const type = String(raw.type ?? "");
  const spec = actionOf(type as never);
  if (!spec) throw new Error(t("Unknown action."));
  if (!spec.href && !ROW_RUNNABLE.has(type)) throw new Error(t("This action runs from a todo (make one from the row)."));
  if (!opAvailable(type)) throw new Error(t("{action}: not installed (Menu → Plugins).", { action: spec.label }));
  const op = spec.clean(raw, { ticket: rowKey({ id: row.id, cells: row.props }) ?? "" });
  if (!op) throw new Error(t("The action is incomplete."));
  if (spec.href) return { href: spec.href(op as never) };
  const { RUNNERS } = await import("@/plugins/actions/run");
  const runner = RUNNERS[type as keyof typeof RUNNERS];
  if (!runner) throw new Error(t("Unknown action."));
  const r = await runner(op as never, { todo: null as never, note: () => {} });
  return { what: r.what };
}

/** Who a row's reply goes to, and on what: its sender's address and its subject (a mail), its chat (a message). */
function replyTarget(row: NonNullable<ReturnType<typeof getPage>>): { channel: string; to: string; subject: string; conv: string } {
  const p = row.props;
  const select = (prop: string) => getDatabase(row.dbId!)?.schema.properties.find((x) => x.id === prop)?.options?.find((o) => o.id === p[prop])?.name ?? "";
  if (typeof p.mailfrom === "string") {
    const address = /<([^>]+)>/.exec(p.mailfrom)?.[1] ?? (/@/.test(p.mailfrom) ? p.mailfrom : "");
    return { channel: select("mailaccount") || "Outlook", to: address, subject: /^(AW|RE|Re|Aw):/.test(row.title) ? row.title : `AW: ${row.title}`, conv: String(p.mailconv ?? "") };
  }
  return { channel: select("msgchannel"), to: String(p.msgchat ?? ""), subject: "", conv: String(p.msgconv ?? "") };
}

/** A reply to a row (a mail, a message) drafted by the AI from its conversation — as the reply drafts are (System → Prompts). */
export async function draftRowReply(rowId: number): Promise<{ text: string; to: string; subject: string; channel: string }> {
  const row = getPage(rowId);
  if (!row?.dbId) throw new Error(t("Not a row of a database."));
  const target = replyTarget(row);
  const { conversationOf } = await import("@/lib/mail/store");
  const history = target.conv && !target.conv.startsWith("19:") ? conversationOf(target.conv, 12).map((m) => `${m.receivedAt.slice(0, 16).replace("T", " ")} ${m.fromName ?? m.fromEmail ?? "?"}: ${m.preview.slice(0, 1500)}`) : [`${row.title}\n${docText(row.content).slice(0, 3000)}`];
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
