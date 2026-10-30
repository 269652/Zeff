import { redirect } from "next/navigation";

/** The Signal app is the inbox's Signal filter now (Signal Desktop's status and autostart beside it): old links (?chat=, ?q=) land there. */
export default async function SignalAppPage({ searchParams }: { searchParams: Promise<{ q?: string; chat?: string }> }) {
  const sp = await searchParams;
  const chat = sp.chat ?? "";
  const open: Record<string, string> = chat.startsWith("sg:") ? { open: chat } : chat ? { q: chat } : {};
  redirect(`/mail?${new URLSearchParams({ channel: "signal", ...(sp.q ? { q: sp.q } : {}), ...open })}`);
}
