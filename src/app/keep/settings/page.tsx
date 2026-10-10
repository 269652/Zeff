import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { listKeepBoards } from "@/plugins/keep/boards";
import { KeepAccountForm } from "@/plugins/keep/KeepAccountForm";
import { KeepBoardsManager } from "@/plugins/keep/KeepBoardsManager";
import { KeepNav } from "@/plugins/keep/KeepNav";
import { keepSettings } from "@/plugins/keep/store";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Keep verwalten" };

/** Keep's settings: your boards (order, names, colours, in the Lage, archived ones, a new one) and which Google account's Keep is read. */
export default async function KeepSettingsPage() {
  await connection();
  if (!isInstalled("keep")) return <PluginNotInstalled id="keep" />;
  const boards = listKeepBoards({ archived: true }).map((b) => ({ id: b.id, name: b.name, description: b.description, color: b.color, archived: b.archived, inLage: b.inLage, inKnowledge: b.inKnowledge, notes: b.notes }));
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Keep verwalten</h1>
        <KeepNav current="settings" />
        <p className="text-sm text-zinc-500">Deine eigenen Notiz-Boards — in der Reihenfolge, in der Keep sie zeigt. Ein Board „in der Ticket-Lage“ bringt seine Notizen in die Auswertung: als Kontext, als Todos, an Todos gehängt.</p>
        <KeepAccountForm account={keepSettings().account} />
      </div>
      <KeepBoardsManager boards={boards} />
    </div>
  );
}
