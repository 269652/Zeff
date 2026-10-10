import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import Link from "next/link";
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
  const mineCount = allTickets.filter((t) => t.mine).length;
  const tickets = mineOnly ? allTickets.filter((t) => t.mine) : allTickets;
  const boards = listJiraBoards();
  const jobRows = listJobs();
  const allTags = listTags().map((t) => t.name);
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
            A local, syncable copy of your assigned tickets. Feeds the ticket autocomplete, ticket→job
            memory, and completion tracking in Analysis.
          </p>
        </div>
        {stats.total > 0 && (
          <form action={clearJiraAction}>
            <SubmitButton className="btn btn-sm btn-danger" pendingText="…" confirm="Delete all synced tickets?">
              Clear
            </SubmitButton>
          </form>
        )}
      </div>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Sync</h2>
          <span className="text-xs text-zinc-500">
            {cfg.configured
              ? `via ${cfg.source === "mcp.json" ? ".mcp.json" : "env"}: ${cfg.command} ${cfg.args.join(" ")} · ${cfg.tool}`
              : "no Jira MCP server configured"}
            {stats.lastSyncedAt ? ` · last synced ${stats.lastSyncedAt.replace("T", " ").slice(0, 16)}` : ""}
          </span>
        </div>
        <JiraSyncControls configured={cfg.configured} ui={ui} />
        {cfg.configured && (
          <p className="text-xs text-zinc-400">
            JQL: <code className="code">{cfg.jql}</code>
            {cfg.baseUrl ? ` · ${cfg.baseUrl}` : ""}. Runs the Jira MCP server directly (no LLM); first
            run is slow while <code className="code">uvx</code> starts it.
          </p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Tickets" value={String(stats.total)} />
        <Stat label="To do" value={String(stats.byCategory.todo)} />
        <Stat label="In progress" value={String(stats.byCategory.inprogress)} tone="amber" />
        <Stat label="Done" value={String(stats.byCategory.done)} tone="emerald" />
        <Stat label="Linked to a job" value={String(stats.withJob)} />
      </div>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Boards → default job</h2>
          <BoardSyncControls />
        </div>
        <p className="text-xs text-zinc-400">
          Only <strong>enabled</strong> boards are synced and feed the ticket dropdown — uncheck stale boards to
          declutter. Map a board to a job and every ticket on it defaults to that job (override per ticket below).
          Re-syncing only re-reads enabled and newly-found boards.
        </p>
        {boards.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">No boards yet — click “Sync boards”.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="text-center">On</th>
                  <th>Board</th>
                  <th>Type</th>
                  <th>Project</th>
                  <th className="text-right">Tickets</th>
                  <th>Default job</th>
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
            Tickets ({tickets.length}{mineOnly ? ` of ${allTickets.length}` : ""})
          </h2>
          <div className="flex items-center gap-1">
            <Link href="/jira" className={`btn btn-sm ${mineOnly ? "" : "btn-primary"}`}>All {allTickets.length}</Link>
            <Link href="/jira?mine=1" className={`btn btn-sm ${mineOnly ? "btn-primary" : ""}`}>Mine {mineCount}</Link>
          </div>
        </div>
        {tickets.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">
            {mineOnly ? "None of the synced tickets are assigned to you." : "No tickets yet. Sync from Jira, or paste issues JSON above."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Type</th>
                  <th>Summary</th>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th>Board</th>
                  <th>Job</th>
                  <th title="Default tags: added to every entry booked on the ticket">Tags</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => {
                  const board = t.boardId != null ? boardMap.get(t.boardId) : undefined;
                  const boardJob =
                    board?.enabled && board.jobNumber
                      ? { number: board.jobNumber, name: jobName.get(board.jobNumber) ?? board.jobNumber }
                      : null;
                  return (
                    <tr key={t.id} className={`${t.active ? "" : "opacity-50"} ${t.mine ? "bg-indigo-50/50 dark:bg-indigo-950/20" : ""}`}>
                      <td className="font-mono whitespace-nowrap">
                        {t.url ? (
                          <a href={t.url} target="_blank" rel="noreferrer" className="hover:underline">{t.key}</a>
                        ) : (
                          t.key
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs text-zinc-500">{t.issueType ?? ""}</td>
                      <td className="max-w-md truncate" title={t.summary}>{t.summary}</td>
                      <td className="whitespace-nowrap">
                        <span className={`badge ${CAT_BADGE[t.statusCategory]}`}>{t.status || t.statusCategory}</span>
                      </td>
                      <td className="whitespace-nowrap">
                        {t.assignee ? (
                          <span
                            className={`badge ${t.mine ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300" : "badge-web"}`}
                            title={t.mine ? "Assigned to you" : t.assignee}
                          >
                            {t.assignee}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-400">Unassigned</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs text-zinc-500" title={board?.name}>{board?.name ?? ""}</td>
                      <td>
                        <JiraJobSelect ticketKey={t.key} jobs={jobs} current={t.jobNumber} boardJob={boardJob} />
                      </td>
                      <td>
                        <TicketTagsEditor ticketKey={t.key} tags={ticketTags[t.key.toUpperCase()] ?? []} allTags={allTags} />
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
