import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import { clearJiraAction } from "@/plugins/jira/server-actions";
import { BoardEnableToggle } from "@/components/BoardEnableToggle";
import { BoardJobSelect } from "@/components/BoardJobSelect";
import { BoardSyncControls } from "@/components/BoardSyncControls";
import { JiraJobSelect } from "@/components/JiraJobSelect";
import { JiraSyncControls } from "@/components/JiraSyncControls";
import { TicketTagsEditor } from "@/components/TicketTagsEditor";
import { SubmitButton } from "@/components/SubmitButton";
import type { JiraStatusCategory } from "@/db/schema";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { jiraStats, listJiraBoards, listJiraTickets } from "@/lib/jira/store";
import { listDefaultTagMaps } from "@/lib/default-tags";
import { listJobs } from "@/lib/jobs";
import { listTags } from "@/lib/tags";
import { getUiOpen } from "@/lib/ui-state";

export const metadata: Metadata = { title: "Jira" };

const CAT_BADGE: Record<JiraStatusCategory, string> = {
  todo: "badge-jtodo",
  inprogress: "badge-jprogress",
  done: "badge-jdone",
  unknown: "badge-junknown",
};

export default async function JiraPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string }>;
}) {
  await connection();
  // A plugin's page: there while it's installed.
  if (!isInstalled("jira")) return <PluginNotInstalled id="jira" />;
  const sp = await searchParams;
  const mineOnly = sp.mine === "1";
  const cfg = getJiraSyncConfig();
  const stats = jiraStats();
  const allTickets = listJiraTickets();
  const mineCount = allTickets.filter((x) => x.mine).length;
  const tickets = mineOnly ? allTickets.filter((x) => x.mine) : allTickets;
  const boards = listJiraBoards();
  const jobRows = listJobs();
  const allTags = listTags().map((x) => x.name);
  const ticketTags = listDefaultTagMaps().tickets;
  const jobs = jobRows.map((j) => ({ number: j.number, name: j.name }));
  const ui = await getUiOpen();
  const jobName = new Map(jobRows.map((j) => [j.number, j.name]));
  const boardMap = new Map(boards.map((b) => [b.id, b]));

  return (
    <div className="page">
      <div className="page-aside">
        <div>
          <h1 className="text-lg font-semibold">Jira</h1>
          <p className="text-sm text-zinc-500">
            {t("A local, syncable copy of your assigned tickets. Feeds the ticket autocomplete, ticket→job memory, and completion tracking in Analysis.")}
          </p>
        </div>
        {stats.total > 0 && (
          <form action={clearJiraAction}>
            <SubmitButton className="btn btn-sm btn-danger" pendingText="…" confirm={t("Delete all synced tickets?")}>
              {t("Clear")}
            </SubmitButton>
          </form>
        )}
      </div>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Sync")}</h2>
          <span className="text-xs text-zinc-500">
            {cfg.configured
              ? t("via {source}: {command} · {tool}", {
                  source: cfg.source === "mcp.json" ? ".mcp.json" : "env",
                  command: `${cfg.command} ${cfg.args.join(" ")}`,
                  tool: cfg.tool,
                })
              : t("no Jira MCP server configured")}
            {stats.lastSyncedAt ? ` · ${t("last synced {at}", { at: stats.lastSyncedAt.replace("T", " ").slice(0, 16) })}` : ""}
          </span>
        </div>
        <JiraSyncControls configured={cfg.configured} ui={ui} />
        {cfg.configured && (
          <p className="text-xs text-zinc-400">
            JQL: <code className="code">{cfg.jql}</code>
            {cfg.baseUrl ? ` · ${cfg.baseUrl}` : ""}. {t("Runs the Jira MCP server directly (no LLM); first run is slow while")}{" "}
            <code className="code">uvx</code> {t("starts it.")}
          </p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label={t("Tickets")} value={String(stats.total)} />
        <Stat label={t("To do")} value={String(stats.byCategory.todo)} />
        <Stat label={t("In progress")} value={String(stats.byCategory.inprogress)} tone="amber" />
        <Stat label={t("Done")} value={String(stats.byCategory.done)} tone="emerald" />
        <Stat label={t("Linked to a job")} value={String(stats.withJob)} />
      </div>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Boards → default job")}</h2>
          <BoardSyncControls />
        </div>
        <p className="text-xs text-zinc-400">
          {t("Only")} <strong>{t("enabled")}</strong>{" "}
          {t("boards are synced and feed the ticket dropdown — uncheck stale boards to declutter. Map a board to a job and every ticket on it defaults to that job (override per ticket below). Re-syncing only re-reads enabled and newly-found boards.")}
        </p>
        {boards.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">{t("No boards yet — click “Sync boards”.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="text-center">{t("On")}</th>
                  <th>{t("Board")}</th>
                  <th>{t("Type")}</th>
                  <th>{t("Project")}</th>
                  <th className="text-right">{t("Tickets")}</th>
                  <th>{t("Default job")}</th>
                </tr>
              </thead>
              <tbody>
                {boards.map((b) => (
                  <tr key={b.id} className={b.enabled ? "" : "opacity-45"}>
                    <td className="text-center">
                      <BoardEnableToggle boardId={b.id} enabled={b.enabled} />
                    </td>
                    <td className="font-medium whitespace-nowrap">{b.name}</td>
                    <td className="text-xs text-zinc-500">{b.type}</td>
                    <td className="font-mono text-xs">{b.projectKey}</td>
                    <td className="text-right tabular-nums text-zinc-500">{b.memberCount}</td>
                    <td>
                      <BoardJobSelect boardId={b.id} jobs={jobs} current={b.jobNumber} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">
            {mineOnly ? t("Tickets ({n} of {total})", { n: tickets.length, total: allTickets.length }) : t("Tickets ({n})", { n: tickets.length })}
          </h2>
          <div className="flex items-center gap-1">
            <Link href="/jira" className={`btn btn-sm ${mineOnly ? "" : "btn-primary"}`}>{t("All {n}", { n: allTickets.length })}</Link>
            <Link href="/jira?mine=1" className={`btn btn-sm ${mineOnly ? "btn-primary" : ""}`}>{t("Mine {n}", { n: mineCount })}</Link>
          </div>
        </div>
        {tickets.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">
            {mineOnly ? t("None of the synced tickets are assigned to you.") : t("No tickets yet. Sync from Jira, or paste issues JSON above.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Key")}</th>
                  <th>{t("Type")}</th>
                  <th>{t("Summary")}</th>
                  <th>{t("Status")}</th>
                  <th>{t("Assignee")}</th>
                  <th>{t("Board")}</th>
                  <th>{t("Job")}</th>
                  <th title={t("Default tags: added to every entry booked on the ticket")}>{t("Tags")}</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((tk) => {
                  const board = tk.boardId != null ? boardMap.get(tk.boardId) : undefined;
                  const boardJob =
                    board?.enabled && board.jobNumber
                      ? { number: board.jobNumber, name: jobName.get(board.jobNumber) ?? board.jobNumber }
                      : null;
                  return (
                    <tr key={tk.id} className={`${tk.active ? "" : "opacity-50"} ${tk.mine ? "bg-indigo-50/50 dark:bg-indigo-950/20" : ""}`}>
                      <td className="font-mono whitespace-nowrap">
                        {tk.url ? (
                          <a href={tk.url} target="_blank" rel="noreferrer" className="hover:underline">{tk.key}</a>
                        ) : (
                          tk.key
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs text-zinc-500">{tk.issueType ?? ""}</td>
                      <td className="max-w-md truncate" title={tk.summary}>{tk.summary}</td>
                      <td className="whitespace-nowrap">
                        <span className={`badge ${CAT_BADGE[tk.statusCategory]}`}>{tk.status || tk.statusCategory}</span>
                      </td>
                      <td className="whitespace-nowrap">
                        {tk.assignee ? (
                          <span
                            className={`badge ${tk.mine ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300" : "badge-web"}`}
                            title={tk.mine ? t("Assigned to you") : tk.assignee}
                          >
                            {tk.assignee}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-400">{t("Unassigned")}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs text-zinc-500" title={board?.name}>{board?.name ?? ""}</td>
                      <td>
                        <JiraJobSelect ticketKey={tk.key} jobs={jobs} current={tk.jobNumber} boardJob={boardJob} />
                      </td>
                      <td>
                        <TicketTagsEditor ticketKey={tk.key} tags={ticketTags[tk.key.toUpperCase()] ?? []} allTags={allTags} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" | "emerald" }) {
  const cls = tone === "amber" ? "text-amber-600 dark:text-amber-400" : tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "";
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium text-zinc-500 uppercase">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
