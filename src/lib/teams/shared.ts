/**
 * Synced Teams messages — the parts pages, forms and the server share. No DB access here
 * (client-safe).
 */
import { isoDay } from "@/lib/text";
import { htmlToMarkdown } from "../html-to-markdown";
import { type T, translator } from "@/lib/i18n/shared";

/** Where you were @mentioned, or what a colleague wrote you in a 1:1 chat. */
/** mention: you were @mentioned; pm: a colleague wrote you 1:1; chat: a chat's other messages lately (yours too, group chats) — the conversation. */
export type TeamsKind = "mention" | "pm" | "chat";

export type TeamsMessageView = {
  key: string;
  kind: TeamsKind;
  /** For mentions: person | tag | team | channel | everyone. */
  mentionType: string | null;
  place: string | null;
  senderName: string | null;
  /** ISO time. */
  sentAt: string;
  subject: string | null;
  html: string;
  text: string;
  link: string;
  isRead: boolean | null;
  /** A context item links to it already. */
  inContext: boolean;
  /** Marked done (ISO): no new todos from it. */
  resolvedAt: string | null;
};

const mentionLabels = (t: T): Record<string, string> => ({
  person: t("you"),
  tag: t("a tag"),
  team: t("the team"),
  channel: t("the channel"),
  everyone: t("everyone"),
});

/** "@you", "@the channel", "PM" — in the language of `t` (English without). */
export const teamsKindLabel = (m: Pick<TeamsMessageView, "kind" | "mentionType">, t: T = translator("en")) =>
  m.kind === "pm" ? t("PM") : m.kind === "chat" ? t("Chat") : `@${mentionLabels(t)[m.mentionType ?? "person"] ?? m.mentionType}`;

/** Teams keeps pictures behind its own sign-in (asm.skype.com): they can't be fetched — the message in Teams has them. */
const isTeamsPicture = (src: string) => /asm\.skype\.com|teams\.microsoft\.com|teams\.cloud\.microsoft/i.test(src);

/**
 * A Teams message (HTML) as Markdown, for display and as context. Browser only (DOMParser).
 * Teams' own pictures are left out — `pictures` counts them, to point at the message instead.
 */
export function teamsMarkdown(html: string): { markdown: string; pictures: number } {
  let pictures = 0;
  const markdown = htmlToMarkdown(html, ({ src }) => {
    if (isTeamsPicture(src)) {
      pictures++;
      return null;
    }
    return /^https?:/i.test(src) ? src : null;
  });
  return { markdown, pictures };
}

/**
 * The synced message a Teams message link points at, as its key "<conversationId>|<messageId>"
 * (".../l/message/19:…@thread.v2/1696923456789?…"), or null for any other link.
 */
export function teamsLinkKey(url: string | null | undefined): string | null {
  const m = /^https:\/\/teams\.(?:microsoft\.com|cloud\.microsoft|live\.com)\/l\/message\/([^/?#]+)\/(\d+)/i.exec(String(url ?? "").trim());
  if (!m) return null;
  let conversation = m[1];
  try {
    conversation = decodeURIComponent(conversation);
  } catch {
    // keep it as written
  }
  return `${conversation}|${m[2]}`;
}

/** The local day ("2026-10-06") a message was sent. */
export function teamsDay(sentAt: string): string {
  const d = new Date(sentAt);
  return isoDay(d);
}
