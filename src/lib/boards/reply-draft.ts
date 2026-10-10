import { runAi } from "@/lib/ai";
import { errorMessage } from "@/lib/errors";
import { conversationOf, mailsByKeys } from "@/lib/mail/store";
import { teamsMessagesByKeys } from "@/lib/teams/store";
import { extraBlock, getContextPrefs } from "./context-prefs";
import { getTodo } from "./store";

/** Where a reply goes, and where to open it. */
export type ReplyTarget = { channel: "whatsapp" | "mail" | "teams"; to: string; openUrl: string };
export type ReplyDraft = { ok: true; text: string; target: ReplyTarget } | { ok: false; error: string };

/** The pages a reply's "Öffnen" may bring up (in the automation Chrome, where they're signed in). */
export const REPLY_HOSTS = /^https:\/\/(web\.whatsapp\.com|mail\.google\.com|outlook\.office\.com|outlook\.office365\.com|teams\.microsoft\.com|teams\.cloud\.microsoft)\//;

const SCHEMA = { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] };

/**
 * A reply to the message a todo is about — written by the AI from the conversation (the WhatsApp
 * chat, the mail thread, the Teams message), in its language and tone. Never sent: you copy it
 * and send it yourself.
 */
export async function draftReply(todoId: number): Promise<ReplyDraft> {
  const t = getTodo(todoId);
  if (!t) return { ok: false, error: "Das Todo gibt es nicht." };
  const refs = [...t.refs, ...t.mailRefs];
  const mails = [...mailsByKeys(refs.filter((r) => r.startsWith("mail:")).map((r) => r.slice(5))).values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const teams = [...teamsMessagesByKeys(refs.filter((r) => r.startsWith("teams:")).map((r) => r.slice(6))).values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const mail = mails[0];
  const tm = teams[0];
  // The newest message it's about: the one to answer.
  const useTeams = !!tm && (!mail || tm.sentAt > mail.receivedAt);
  if (!mail && !tm) return { ok: false, error: "Das Todo nennt keine Nachricht, auf die man antworten könnte." };

  let target: ReplyTarget;
  let history: string[];
  if (useTeams) {
    target = { channel: "teams", to: tm.senderName ?? "Teams", openUrl: tm.link };
    history = teams
      .slice(0, 8)
      .reverse()
      .map((m) => `${m.sentAt.slice(0, 16).replace("T", " ")} ${m.senderName ?? "?"}${m.place ? ` (${m.place})` : ""}: ${m.text.slice(0, 1500)}`);
  } else {
    const chat = mail.folder === "WhatsApp";
    const gmailThread = /^gmail:(?:[^:]+:)?([0-9a-f]+)$/i.exec(mail.convId)?.[1];
    target = {
      channel: chat ? "whatsapp" : "mail",
      to: chat ? mail.subject : (mail.fromName ?? mail.fromEmail ?? "?"),
      openUrl: chat ? "https://web.whatsapp.com/" : gmailThread ? `https://mail.google.com/mail/u/0/#all/${gmailThread}` : "https://outlook.office.com/mail/",
    };
    history = conversationOf(mail.convId, chat ? getContextPrefs().replies.numbers.messages : 8).map(
      (m) => `${m.receivedAt.slice(0, 16).replace("T", " ")} ${m.fromName ?? m.fromEmail ?? "?"}${chat ? "" : ` — Betreff „${m.subject}“`}: ${m.preview.slice(0, 1500)}`,
    );
  }

  const notes = t.userNotes.map((n) => `- ${n.text}`).join("\n");
  const prompt = [
    `Schreib meine Antwort auf diese ${target.channel === "whatsapp" ? "WhatsApp-Unterhaltung" : target.channel === "teams" ? "Teams-Nachricht" : "Mail"} — ich schicke sie selbst ab.`,
    "Die Antwort erledigt dieses Todo, so weit eine Nachricht das kann. Sprache, Anrede (du/Sie) und Ton wie im Verlauf; kurz und natürlich, so wie ich schreibe (meine Nachrichten stehen als „Ich“ im Verlauf). Keine Floskeln, keine Platzhalter in eckigen Klammern — wo etwas fehlt (eine Uhrzeit, ein Datum), schlag etwas Konkretes und Plausibles vor oder frag kurz zurück. Bei Mails ohne Betreffzeile, nur der Text mit Gruß." + extraBlock("replies"),
    "",
    `# Todo\n${t.text}${t.due ? ` (Frist ${t.due})` : ""}`,
    notes && `# Meine Notizen dazu\n${notes}`,
    `# Verlauf (älteste zuerst) — an ${target.to}\n${history.join("\n")}`,
    `Heute ist ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    const answer = await runAi<{ reply?: string }>(prompt, SCHEMA, { task: "reply-draft", timeoutMs: 3 * 60000, maxBudgetUsd: 0.3 });
    const text = answer.output?.reply?.trim();
    return text ? { ok: true, text, target } : { ok: false, error: "Die KI hat keinen Entwurf geliefert." };
  } catch (e) {
    return { ok: false, error: errorMessage(e).slice(0, 300) };
  }
}
