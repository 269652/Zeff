import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { ArchivedCards } from "@/plugins/kanban/ArchivedCards";
import { getBoard, listArchivedCards } from "@/plugins/kanban/store";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Archived cards") };
}

/** A board's archived cards: look at them, bring them back or delete them for good. */
export default async function ArchivePage({ params }: { params: Promise<{ board: string }> }) {
  await connection();
  if (!isInstalled("kanban")) return <PluginNotInstalled id="kanban" />;
  const { board } = await params;
  if (!/^\d+$/.test(board)) notFound();
  let name: string;
  try {
    name = getBoard(Number(board)).name;
  } catch {
    notFound();
  }
  const cards = listArchivedCards(Number(board));
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/kanban/settings" className="text-sm text-zinc-500 hover:underline">
          {t("← Manage boards")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Archived cards of {name}", { name })}</h1>
      </div>
      {cards.length ? <ArchivedCards cards={cards} /> : <EmptyState>{t("No archived cards.")}</EmptyState>}
    </div>
  );
}
