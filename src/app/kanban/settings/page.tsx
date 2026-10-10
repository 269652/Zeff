import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { BoardsManager } from "@/plugins/kanban/BoardsManager";
import { NewBoardForm } from "@/plugins/kanban/NewBoardForm";
import { listBoards } from "@/plugins/kanban/store";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Manage Kanban boards" };

/** Kanban's settings: your boards — order, names, colours, the Lage, archived ones — and a new one. */
export default async function KanbanSettingsPage() {
  await connection();
  if (!isInstalled("kanban")) return <PluginNotInstalled id="kanban" />;
  const boards = listBoards({ archived: true }).map((b) => ({ id: b.id, name: b.name, description: b.description, color: b.color, archived: b.archived, inLage: b.inLage, cards: b.cards, open: b.open }));
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/kanban" className="text-sm text-zinc-500 hover:underline">
          ← Kanban
        </Link>
        <h1 className="text-lg font-semibold">Manage boards</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          Your boards in the order Kanban shows them. A board “in the briefing” brings its open cards (KB-…) into the briefing run: todos, the briefing per card, the reports{isInstalled("todos") ? "" : " — that needs the Todos plugin"}.
        </p>
      </div>
      <BoardsManager boards={boards} />
      <NewBoardForm />
    </div>
  );
}
