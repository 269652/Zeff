import { runAi } from "@/lib/ai";
import { fillPrompt } from "@/lib/prompts";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { conversationOf, mailsByKeys } from "@/lib/mail/store";
import { teamsMessagesByKeys } from "@/lib/teams/store";
import { isChatFolder } from "@/lib/mail/shared";
import { extraBlock, getContextPrefs } from "./context-prefs";
import { getTodo } from "./store";

/** Where a reply goes, and where to open it ("": nowhere to open — Signal Desktop). */
export type ReplyTarget = { channel: "whatsapp" | "signal" | "mail" | "teams"; to: string; openUrl: string };
export type ReplyDraft = { ok: true; text: string; target: ReplyTarget } | { ok: false; error: string };

/** The pages a reply's "Öffnen" may bring up (in the automation Chrome, where they're signed in). */
export const REPLY_HOSTS = /^https:\/\/(web\.whatsapp\.com|mail\.google\.com|outlook\.office\.com|outlook\.office365\.com|teams\.microsoft\.com|teams\.cloud\.microsoft)\//;

const SCHEMA = { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] };

/**
 * A reply to the message a todo is about — written by the AI from the conversation (the WhatsApp
 * chat, the mail thread, the Teams message), in its language and tone. Never sent: you copy it
 * and send it yourself.
 */
/** The reply drafts' instructions ({{channel}}: Mail, Teams-Nachricht, WhatsApp-Unterhaltung …) — a page of System → Prompts. */
export const INSTRUCTIONS = "Schreib meine Antwort auf diese {{channel}} — ich schicke sie selbst ab.\n\nDie Antwort erledigt dieses Todo, so weit eine Nachricht das kann. Sprache, Anrede (du/Sie) und Ton wie im Verlauf; kurz und natürlich, so wie ich schreibe (meine Nachrichten stehen als „Ich“ im Verlauf). Keine Floskeln, keine Platzhalter in eckigen Klammern — wo etwas fehlt (eine Uhrzeit, ein Datum), schlag etwas Konkretes und Plausibles vor oder frag kurz zurück. Bei Mails ohne Betreffzeile, nur der Text mit Gruß.";

export async function draftReply(todoId: number): Promise<ReplyDraft> {
  const todo = getTodo(todoId);
  if (!todo) return { ok: false, error: t("That todo doesn't exist.") };
  const refs = [...todo.refs, ...todo.mailRefs];
  const mails = [...mailsByKeys(refs.filter((r) => r.startsWith("mail:")).map((r) => r.slice(5))).values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const teams = [...teamsMessagesByKeys(refs.filter((r) => r.startsWith("teams:")).map((r) => r.slice(6))).values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const mail = mails[0];
  const tm = teams[0];
  // The newest message it's about: the one to answer.
  const useTeams = !!tm && (!mail || tm.sentAt > mail.receivedAt);
  if (!mail && !tm) return { ok: false, error: t("The todo names no message to reply to.") };

  let target: ReplyTarget;
  let history: string[];
  if (useTeams) {
    target = { channel: "teams", to: tm.senderName ?? "Teams", openUrl: tm.link };
    history = teams
      .slice(0, 8)
      .reverse()
      .map((m) => `${m.sentAt.slice(0, 16).replace("T", " ")} ${m.senderName ?? "?"}${m.place ? ` (${m.place})` : ""}: ${m.text.slice(0, 1500)}`);
  } else {
    const chat = isChatFolder(mail.folder);
    const gmailThread = /^gmail:(?:[^:]+:)?([0-9a-f]+)$/i.exec(mail.convId)?.[1];
    target = {
      channel: mail.folder === "WhatsApp" ? "whatsapp" : mail.folder === "Signal" ? "signal" : "mail",
      to: chat ? mail.subject : (mail.fromName ?? mail.fromEmail ?? "?"),
      openUrl: mail.folder === "WhatsApp" ? "https://web.whatsapp.com/" : chat ? "" : gmailThread ? `https://mail.google.com/mail/u/0/#all/${gmailThread}` : "https://outlook.office.com/mail/",
    };
    history = conversationOf(mail.convId, chat ? getContextPrefs().replies.numbers.messages : 8).map(
      (m) => `${m.receivedAt.slice(0, 16).replace("T", " ")} ${m.fromName ?? m.fromEmail ?? "?"}${chat ? "" : ` — Betreff „${m.subject}“`}: ${m.preview.slice(0, 1500)}`,
    );
  }

  const notes = todo.userNotes.map((n) => `- ${n.text}`).join("\n");
  const prompt = [
    fillPrompt("reply-draft", INSTRUCTIONS, { channel: target.channel === "whatsapp" ? "WhatsApp-Unterhaltung" : target.channel === "signal" ? "Signal-Unterhaltung" : target.channel === "teams" ? "Teams-Nachricht" : "Mail" }) + extraBlock("replies"),
    "",
    `# Todo\n${todo.text}${todo.due ? ` (Frist ${todo.due})` : ""}`,
    notes && `# Meine Notizen dazu\n${notes}`,
    `# Verlauf (älteste zuerst) — an ${target.to}\n${history.join("\n")}`,
    `Heute ist ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    const answer = await runAi<{ reply?: string }>(prompt, SCHEMA, { task: "reply-draft", timeoutMs: 3 * 60000, maxBudgetUsd: 0.3 });
    const text = answer.output?.reply?.trim();
    return text ? { ok: true, text, target } : { ok: false, error: t("The AI returned no draft.") };
  } catch (e) {
    return { ok: false, error: errorMessage(e).slice(0, 300) };
  }
}
