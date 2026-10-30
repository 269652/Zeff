import { redirect } from "next/navigation";

/** The WhatsApp app is the inbox's WhatsApp filter now: old links (?chat= a chat's id or name, ?q=) land there, the chat unfolded. */
export default async function WhatsappAppPage({ searchParams }: { searchParams: Promise<{ q?: string; chat?: string }> }) {
  const sp = await searchParams;
  const chat = sp.chat ?? "";
  const open: Record<string, string> = chat.startsWith("wa:") ? { open: chat } : chat ? { q: chat } : {};
  redirect(`/mail?${new URLSearchParams({ channel: "whatsapp", ...(sp.q ? { q: sp.q } : {}), ...open })}`);
}
