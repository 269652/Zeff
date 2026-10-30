import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { BoardEnableToggle } from "@/components/BoardEnableToggle";
import { BoardJobSelect } from "@/components/BoardJobSelect";
import { BoardSyncControls } from "@/components/BoardSyncControls";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { rich } from "@/lib/i18n/rich";
import { t } from "@/lib/i18n/server";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { listJiraBoards } from "@/lib/jira/store";
import { listJobs } from "@/lib/jobs";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Jira settings") };
}

/** Settings → Jira: how Zeff reaches Jira, and which boards are synced with which default job. */
export default async function JiraSettingsPage() {
  await connection();
  if (!isInstalled("jira")) return <PluginNotInstalled id="jira" />;
  const cfg = getJiraSyncConfig();
  const boards = listJiraBoards();
  const jobs = listJobs().map((j) => ({ number: j.number, name: j.name }));
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("All settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Jira settings")}</h1>
        <p className="text-sm text-zinc-500">
          {t("How Zeff reaches Jira, and which boards are synced.")} <Link href="/jira" className="text-indigo-600 hover:underline dark:text-indigo-400">{t("Open Jira")}</Link>
        </p>
      </div>

      <section className="card space-y-1 p-4 text-sm">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Connection")}</h2>
        <p className="text-xs text-zinc-500">
          {cfg.configured
            ? t("via {source}: {command} · {tool}", {
                source: cfg.source === "mcp.json" ? ".mcp.json" : "env",
                command: `${cfg.command} ${cfg.args.join(" ")}`,
                tool: cfg.tool,
              })
            : t("no Jira MCP server configured")}
        </p>
        {cfg.configured && (
          <p className="text-xs text-zinc-400">
            JQL: <code className="code">{cfg.jql}</code>
            {cfg.baseUrl ? ` · ${cfg.baseUrl}` : ""}
          </p>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Boards → default job")}</h2>
          <BoardSyncControls />
        </div>
        <p className="text-xs text-zinc-400">
          {rich(
            t(
              "Only <b>enabled</b> boards are synced and feed the ticket dropdown — uncheck stale boards to declutter. Map a board to a job and every ticket on it defaults to that job (override per ticket below). Re-syncing only re-reads enabled and newly-found boards.",
            ),
            { b: (s) => <strong>{s}</strong> },
          )}
        </p>
        {boards.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">{t("No boards yet — click “Sync boards”.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" className="text-center">{t("On")}</th>
                  <th scope="col">{t("Board")}</th>
                  <th scope="col">{t("Type")}</th>
                  <th scope="col">{t("Project")}</th>
                  <th scope="col" className="text-right">{t("Tickets")}</th>
                  <th scope="col">{t("Default job")}</th>
                </tr>
              </thead>
              <tbody>
                {boards.map((b) => (
                  <tr key={b.id} className={b.enabled ? "" : "bg-zinc-50 dark:bg-zinc-900/60"}>
                    <td className="text-center">
                      <BoardEnableToggle boardId={b.id} enabled={b.enabled} />
                    </td>
                    <td className="font-medium whitespace-nowrap">{b.name}</td>
                    <td className="text-xs text-zinc-500">{b.type}</td>
                    <td className="font-mono text-xs">{b.projectKey}</td>
                    <td className="text-right tabular-nums text-zinc-500">{b.memberCount}</td>
                    <td>
                      <BoardJobSelect boardId={b.id} boardName={b.name} jobs={jobs} current={b.jobNumber} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
