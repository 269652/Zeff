import { EmptyState } from "@/components/EmptyState";
import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { boardDot } from "@/plugins/kanban/colors";
import { NewBoardForm } from "@/plugins/kanban/NewBoardForm";
import { providerBoards } from "@/plugins/kanban/providers";
import type { BoardSummary } from "@/plugins/kanban/shared";
import { listBoards } from "@/plugins/kanban/store";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Kanban" };

function BoardTile({ b }: { b: BoardSummary }) {
  return (
    <li>
      <Link href={b.href} className="card block h-full space-y-1 p-4 transition hover:border-indigo-300 dark:hover:border-indigo-700">
        <span className="flex items-center gap-2">
          <span className={`size-2.5 shrink-0 rounded-full ${boardDot(b.color)}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
          <span className="text-xs text-zinc-500 tabular-nums">
            {t("{n} open", { n: b.open })}
            {b.cards !== b.open ? ` · ${b.cards}` : ""}
          </span>
        </span>
        {b.description && <span className="line-clamp-2 block text-sm text-zinc-500">{b.description}</span>}
      </Link>
    </li>
  );
}

/** Kanban: your boards, and the ones other plugins bring (Jira Lage) — and a new one. */
export default async function KanbanPage() {
  await connection();
  if (!isInstalled("kanban")) return <PluginNotInstalled id="kanban" />;
  const own: BoardSummary[] = [
    ...listBoards().map((b) => ({ id: String(b.id), name: b.name, description: b.description, color: b.color, source: "Kanban", cards: b.cards, open: b.open, href: `/kanban/${b.id}`, updatedAt: b.updatedAt })),
    // The boards in the Workspace (moved Kanban boards among them).
    ...(await import("@/plugins/kanban/to-workspace")).workspaceBoards(),
  ];
  // Jira's boards: their Workspace databases once the sync keeps them (Jira as a data source).
  const jira = isInstalled("jira-lage") && isInstalled("workspace") ? await import("@/plugins/jira-lage/to-workspace") : null;
  const others = (await providerBoards()).map((b) => ({ ...b, href: jira?.jiraBoardHref(b.id) ?? b.href }));
  return (
    <div className="page">
      <div className="page-aside">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-lg font-semibold">Kanban</h1>
          <Link href="/kanban/settings" className="btn btn-sm">
            {t("Manage boards")}
          </Link>
        </div>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          {others.length
            ? t("Boards of your own — for private projects or your own work boards — and your Jira boards with the briefing per ticket.")
            : t("Boards of your own — for private projects or your own work boards —.")}
        </p>
      </div>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("My boards")}</h2>
        {own.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {own.map((b) => (
              <BoardTile key={b.id} b={b} />
            ))}
          </ul>
        ) : (
          <EmptyState>{t("None yet — create one below.")}</EmptyState>
        )}
      </section>
      {others.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Jira briefing")}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((b) => (
              <BoardTile key={b.id} b={b} />
            ))}
          </ul>
        </section>
      )}
      <NewBoardForm />
    </div>
  );
}
