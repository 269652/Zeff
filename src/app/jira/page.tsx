import type { Metadata } from "next";
import { connection } from "next/server";
import { clearJiraAction } from "@/app/actions";
import { JiraJobSelect } from "@/components/JiraJobSelect";
import { JiraSyncControls } from "@/components/JiraSyncControls";
import { SubmitButton } from "@/components/SubmitButton";
import type { JiraStatusCategory } from "@/db/schema";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { jiraStats, listJiraTickets } from "@/lib/jira/store";
import { listJobs } from "@/lib/jobs";

export const metadata: Metadata = { title: "Jira" };

const CAT_BADGE: Record<JiraStatusCategory, string> = {
  todo: "badge-jtodo",
  inprogress: "badge-jprogress",
  done: "badge-jdone",
  unknown: "badge-junknown",
};

export default async function JiraPage() {
  await connection();
  const cfg = getJiraSyncConfig();
  const stats = jiraStats();
  const tickets = listJiraTickets();
  const jobs = listJobs().map((j) => ({ number: j.number, name: j.name }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
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
        <JiraSyncControls configured={cfg.configured} />
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

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Tickets ({tickets.length})</h2>
        {tickets.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">
            No tickets yet. Sync from Jira, or paste issues JSON above.
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
                  <th>Job</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} className={t.active ? "" : "opacity-50"}>
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
                    <td>
                      <JiraJobSelect ticketKey={t.key} jobs={jobs} current={t.jobNumber} />
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" | "emerald" }) {
  const cls = tone === "amber" ? "text-amber-600 dark:text-amber-400" : tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "";
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium text-zinc-500 uppercase">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
