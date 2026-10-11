import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import { LagePage, type LageSearch } from "@/components/boards/LagePage";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Tickets") };
}

/** Tickets (Tickets plugin): the Ticket-Lage per ticket — how each stands, what happened, its todos. */
export default async function TicketsPage({ searchParams }: { searchParams: Promise<LageSearch> }) {
  await connection();
  if (!isInstalled("tickets")) return <PluginNotInstalled id="tickets" />;
  return LagePage({ searchParams, part: "tickets" });
}
