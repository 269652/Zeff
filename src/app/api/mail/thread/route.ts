import { connection } from "next/server";

/**
 * One conversation's messages (a mail thread, a chat), oldest first — what a row of the Messages page unfolds into. The
 * page lists hundreds of conversations; their messages are fetched here when one is opened, not all rendered up front.
 * `?conv=<id>` and `&older=1` for the whole thread (else the last 25). The account you're in; a GET only reads, and a
 * request from another site gets nothing.
 */
export async function GET(req: Request) {
  await connection();
  const { foreignRequest, refused } = await import("@/lib/request-guard");
  const why = foreignRequest(req);
  if (why) return refused(why);
  const url = new URL(req.url);
  const conv = url.searchParams.get("conv") ?? "";
  if (!conv) return Response.json({ messages: [] }, { status: 400 });
  const { conversationOf } = await import("@/lib/mail/store");
  const { isMine } = await import("@/lib/mail/shared");
  const { formatSmart } = await import("@/lib/format");
  const { applyLanguage } = await import("@/lib/i18n/server");
  applyLanguage();
  const messages = conversationOf(conv, url.searchParams.get("older") === "1" ? 2000 : 25).map((m) => ({
    key: m.key,
    name: m.fromName ?? m.fromEmail ?? "?",
    email: m.fromEmail,
    at: formatSmart(m.receivedAt),
    unread: m.unread,
    subject: m.subject,
    preview: m.preview,
    mine: isMine(m),
  }));
  return Response.json({ messages }, { headers: { "cache-control": "no-store" } });
}
