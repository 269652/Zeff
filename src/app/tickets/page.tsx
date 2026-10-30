import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";

/** Tickets (Tickets plugin): now a toggle inside Todos — the old address leads there (with its filters). */
export default async function TicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  if (!isInstalled("tickets")) return <PluginNotInstalled id="tickets" />;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const x of [v ?? []].flat()) if (k !== "part") q.append(k, x);
  q.set("part", "tickets");
  redirect(`/todos?${q}`);
}
