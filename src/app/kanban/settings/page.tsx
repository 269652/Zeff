import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { BoardsManager } from "@/plugins/kanban/BoardsManager";
import { NewBoardForm } from "@/plugins/kanban/NewBoardForm";
import { listBoards } from "@/plugins/kanban/store";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Kanban-Boards verwalten" };

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
        <h1 className="text-lg font-semibold">Boards verwalten</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          Deine Boards in der Reihenfolge, in der Kanban sie zeigt. Ein Board „in der Ticket-Lage“ bringt seine offenen Karten (KB-…) in den Lage-Lauf: Todos, die Lage je Karte, die Berichte{isInstalled("todos") ? "" : " — dafür braucht es das Todos-Plugin"}.
        </p>
      </div>
      <BoardsManager boards={boards} />
      <NewBoardForm />
    </div>
  );
}
