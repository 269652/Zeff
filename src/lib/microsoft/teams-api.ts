/**
 * Teams through Microsoft Graph (the "api" driver): what the automation Chrome's Teams driver
 * (src/plugins/teams/driver.mjs, teams_messages) reads — where you were @mentioned, what colleagues
 * wrote you in 1:1 chats, and every chat's latest messages — from your chats (Chat.Read). Read-only.
 * Channel messages need an administrator's consent (ChannelMessage.Read.All) and are not asked for:
 * @mentions in channels are therefore not read this way. Server only.
 */
import { apiGet } from "@/lib/connectors/http";
import type { TeamsMessageInput } from "@/lib/teams/store";
import { escapeHtml } from "@/lib/html-text";

type Member = { userId?: string; displayName?: string };
type Chat = { id: string; topic?: string | null; chatType?: string; members?: Member[]; lastMessagePreview?: { createdDateTime?: string } | null };
type Msg = {
  id: string;
  replyToId?: string | null;
  messageType?: string;
  createdDateTime?: string;
  deletedDateTime?: string | null;
  subject?: string | null;
  body?: { contentType?: string; content?: string };
  from?: { user?: { id?: string; displayName?: string } | null; application?: { displayName?: string } | null } | null;
  mentions?: { mentioned?: { user?: { id?: string } | null; conversation?: unknown; tag?: unknown } | null }[];
  webUrl?: string | null;
};
type Page<T> = { value?: T[]; "@odata.nextLink"?: string };

/** Pages of messages read per chat at most (50 each), newest first. */
const MAX_MESSAGE_PAGES = 10;

/** Plain text for search (the driver does the same by hand). */
const textOf = (html: string) =>
  html
    .replace(/<(br|\/p|\/div|\/li|\/blockquote)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

async function chatsOf(): Promise<Chat[]> {
  const out: Chat[] = [];
  const get = async (expand: string) => {
    let next: string | undefined = `/me/chats?$expand=${expand}&$top=50`;
    const list: Chat[] = [];
    for (let i = 0; next && i < 40; i++) {
      const page: Page<Chat> = await apiGet<Page<Chat>>("microsoft", next);
      list.push(...(page.value ?? []));
      next = page["@odata.nextLink"];
    }
    return list;
  };
  try {
    out.push(...(await get("members,lastMessagePreview")));
  } catch (e) {
    // The preview (it lets quiet chats be skipped) isn't offered together with the members: just the members, then.
    if (!/answered 400/.test(String((e as Error)?.message))) throw e;
    out.push(...(await get("members")));
  }
  return out;
}

/** One chat's messages newer than `since` (ms), newest first; null: the chat can't be read (left, expired). */
async function messagesOf(chatId: string, since: number): Promise<Msg[] | null> {
  const out: Msg[] = [];
  let next: string | undefined = `/me/chats/${encodeURIComponent(chatId)}/messages?$top=50&$orderby=createdDateTime desc`;
  try {
    for (let i = 0; next && i < MAX_MESSAGE_PAGES; i++) {
      const page: Page<Msg> = await apiGet<Page<Msg>>("microsoft", next);
      const list = page.value ?? [];
      out.push(...list.filter((m) => Date.parse(m.createdDateTime ?? "") >= since));
      // Newest first: one older than the window ends it.
      if (list.some((m) => Date.parse(m.createdDateTime ?? "") < since)) break;
      next = page["@odata.nextLink"];
    }
  } catch (e) {
    if (/answered (403|404)/.test(String((e as Error)?.message))) return null;
    throw e;
  }
  return out;
}

export async function readTeams({ pmDays, chatDays }: { pmDays: number; chatDays: number }): Promise<{ messages: TeamsMessageInput[]; unresolved: number }> {
  const me = await apiGet<{ id?: string; displayName?: string }>("microsoft", "/me?$select=id,displayName");
  const myId = me.id ?? "";
  const pmSince = Date.now() - pmDays * 864e5;
  const chatSince = Date.now() - chatDays * 864e5;
  const out = new Map<string, TeamsMessageInput>();
  let unresolved = 0;
  for (const chat of await chatsOf()) {
    // A chat that was quiet since the window: nothing in it to read.
    const last = Date.parse(chat.lastMessagePreview?.createdDateTime ?? "");
    if (Number.isFinite(last) && last < pmSince) continue;
    const oneOnOne = chat.chatType === "oneOnOne";
    const other = (chat.members ?? []).find((m) => m.userId && m.userId !== myId)?.displayName;
    const topic = chat.topic?.trim() || null;
    const place = topic || (oneOnOne ? `Chat with ${other || "…"}` : chat.chatType === "meeting" ? "Meeting chat" : "Group chat");
    const list = await messagesOf(chat.id, pmSince);
    if (list === null) {
      unresolved++;
      continue;
    }
    for (const m of list) {
      if (m.messageType !== "message" || m.deletedDateTime || !m.id) continue;
      const sentAt = Date.parse(m.createdDateTime ?? "");
      if (!Number.isFinite(sentAt)) continue;
      const mine = !!myId && m.from?.user?.id === myId;
      // A mention of you (by name, or all of the chat), a colleague's message in a 1:1 chat, else the chat's latest messages.
      const mentioned = !mine && (m.mentions ?? []).some((x) => x.mentioned?.user?.id === myId || (!!x.mentioned?.conversation && !x.mentioned?.user) || !!x.mentioned?.tag);
      let kind: TeamsMessageInput["kind"] | null = null;
      if (mentioned) kind = "mention";
      else if (oneOnOne && !mine) kind = "pm";
      else if (sentAt >= chatSince) kind = "chat";
      if (!kind) continue;
      const html = m.body?.contentType === "text" ? escapeHtml(m.body.content ?? "") : (m.body?.content ?? "");
      const key = `${chat.id}|${m.id}`;
      out.set(key, {
        key,
        kind,
        mentionType: kind === "mention" ? ((m.mentions ?? []).some((x) => x.mentioned?.user?.id === myId) ? "person" : "chat") : null,
        conversationId: chat.id,
        replyChainId: m.replyToId || null,
        messageId: m.id,
        place,
        senderName: m.from?.user?.displayName || m.from?.application?.displayName || null,
        senderId: m.from?.user?.id || null,
        sentAt,
        subject: m.subject?.trim() || null,
        html,
        text: textOf(html),
        link: m.webUrl || `https://teams.microsoft.com/l/message/${chat.id}/${m.id}?context=${encodeURIComponent('{"contextType":"chat"}')}`,
        isRead: null,
      });
    }
  }
  return { messages: [...out.values()], unresolved };
}
