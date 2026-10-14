import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ExtFrame } from "@/components/ext/ExtFrame";
import { getPlugin } from "@/lib/ext/registry";
import { t } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Plugin" };

/**
 * A plugin's panel as a page of its own (Work's sidebar links to the plugins' "tab" panels).
 * ?runId=…&ticket=…&todoId=… are handed to the panel as its context.
 */
export default async function ExtPanelPage({ params, searchParams }: { params: Promise<{ plugin: string; panel: string }>; searchParams: Promise<{ runId?: string; ticket?: string; todoId?: string }> }) {
  await connection();
  const { plugin: id, panel: panelId } = await params;
  const sp = await searchParams;
  const plugin = getPlugin(id);
  const panel = plugin?.enabled ? plugin.manifest.contributes.workPanels.find((p) => p.id === panelId) : undefined;
  if (!plugin || !panel) notFound();
  // An app (Menu → Apps) is a page of its own; any other panel belongs to Work.
  const isApp = plugin.manifest.contributes.apps.some((a) => a.panel === panel.id);
  const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  return (
    <div className="flex min-h-[calc(100vh-7rem)] w-full flex-col gap-3">
      <header className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold">{panel.title}</h1>
        <span className="text-xs text-zinc-500">{plugin.manifest.name}</span>
        {!isApp && (
          <Link href="/work" className="ml-auto text-xs text-indigo-600 hover:underline dark:text-indigo-400">
            {t("← Work")}
          </Link>
        )}
      </header>
      <ExtFrame plugin={plugin.id} entry={panel.entry} title={panel.title} context={{ runId: num(sp.runId), ticket: sp.ticket?.slice(0, 40), todoId: num(sp.todoId) }} />
    </div>
  );
}
