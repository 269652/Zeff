import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import { LagePage, type LageSearch } from "@/components/boards/LagePage";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Todos") };
}

/** Todos (Todos plugin): your todos from the Ticket-Lage — done, activity — and the recap of a day. */
export default async function TodosPage({ searchParams }: { searchParams: Promise<LageSearch> }) {
  await connection();
  if (!isInstalled("todos")) return <PluginNotInstalled id="todos" />;
  return LagePage({ searchParams, part: "todos" });
}
