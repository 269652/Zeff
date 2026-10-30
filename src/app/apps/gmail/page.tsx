import { redirect } from "next/navigation";

/** The Gmail app is the inbox's Gmail filter now: old links (?folder= an account, ?q=) land there. */
export default async function GmailAppPage({ searchParams }: { searchParams: Promise<{ q?: string; folder?: string }> }) {
  const sp = await searchParams;
  redirect(`/mail?${new URLSearchParams({ channel: "gmail", ...(sp.folder ? { folder: sp.folder } : {}), ...(sp.q ? { q: sp.q } : {}) })}`);
}
