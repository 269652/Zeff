import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import { LagePage, type LageSearch } from "@/components/boards/LagePage";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata({ searchParams }: { searchParams: Promise<LageSearch> }): Promise<Metadata> {
  return { title: (await searchParams).part === "tickets" ? t("Tickets") : t("Todos") };
}

/** Todos (Todos plugin): your todos from the Ticket-Lage — done, activity —, the same per ticket (?part=tickets, Tickets plugin) and the recap of a day. */
export default async function TodosPage({ searchParams }: { searchParams: Promise<LageSearch> }) {
  await connection();
  if (!isInstalled("todos")) return <PluginNotInstalled id="todos" />;
  const sp = await searchParams;
  const tickets = sp.part === "tickets" && isInstalled("tickets");
  return LagePage({ searchParams: Promise.resolve(sp), part: tickets ? "tickets" : "todos" });
}
