import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { listKeepBoards } from "@/plugins/keep/boards";
import { KeepAccountForm } from "@/plugins/keep/KeepAccountForm";
import { KeepBoardsManager } from "@/plugins/keep/KeepBoardsManager";
import { KeepNav } from "@/plugins/keep/KeepNav";
import { keepSettings } from "@/plugins/keep/store";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Manage Keep") };
}

/** Keep's settings: your boards (order, names, colours, in the Lage, archived ones, a new one) and which Google account's Keep is read. */
export default async function KeepSettingsPage() {
  await connection();
  if (!isInstalled("keep")) return <PluginNotInstalled id="keep" />;
  const boards = listKeepBoards({ archived: true }).map((b) => ({ id: b.id, name: b.name, description: b.description, color: b.color, archived: b.archived, inLage: b.inLage, inKnowledge: b.inKnowledge, notes: b.notes }));
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Manage Keep")}</h1>
        <KeepNav current="settings" />
        <p className="text-sm text-zinc-500">
          {t("Your own note boards — in the order Keep shows them. A board “in the briefing” brings its notes into the briefing: as context, as todos, attached to todos.")}
        </p>
        <KeepAccountForm account={keepSettings().account} />
      </div>
      <KeepBoardsManager boards={boards} />
    </div>
  );
}
