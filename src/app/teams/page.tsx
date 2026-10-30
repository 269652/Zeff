import { redirect } from "next/navigation";

/** Teams' page is the inbox's Teams filter now (mentions, PMs, its sync): old links (?kind=, ?q=) land there. */
export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const sp = await searchParams;
  redirect(`/mail?${new URLSearchParams({ channel: "teams", ...(sp.kind ? { kind: sp.kind } : {}), ...(sp.q ? { q: sp.q } : {}) })}`);
}
