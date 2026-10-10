import type { Metadata } from "next";
import { connection } from "next/server";
import { LagePage, type LageSearch } from "@/components/boards/LagePage";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Todos" };

/** Todos (Todos plugin): your todos from the Ticket-Lage — done, activity — and the recap of a day. */
export default async function TodosPage({ searchParams }: { searchParams: Promise<LageSearch> }) {
  await connection();
  if (!isInstalled("todos")) return <PluginNotInstalled id="todos" />;
  return LagePage({ searchParams, part: "todos" });
}
