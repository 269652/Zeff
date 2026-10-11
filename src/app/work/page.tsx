import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { WorkFollow } from "@/components/work/WorkFollow";
import { composerOptions } from "@/lib/work/composer-options";
import { SidebarFrame } from "@/components/SidebarFrame";
import { SessionSidebar } from "@/components/work/SessionSidebar";
import { NewSessionPane, SessionPane, TicketPane } from "@/components/work/SessionPanes";
import { sessionTickets } from "@/lib/work/sessions";
import { claudeSessionSettings, getRun, toRunView } from "@/lib/work/store";
import { CLAUDE_MODELS } from "@/lib/ai/shared";
import { llmChoice } from "@/plugins/llm/run";
import { elevationAvailable } from "@/plugins/work-elevated/elevate";
import { listRepos, repoForTicket } from "@/lib/repos";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Work") };
}

/**
 * Work: sessions, like Claude Code's — a ticket's (or a todo's) conversation with a worker, in its
 * repo and branch. The sidebar lists the tickets that have sessions; a new one starts from the
 * composer. The workers' settings are on the Settings page (its Work section).
 */
export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; run?: string; ticket?: string; new?: string; archived?: string }>;
}) {
  await connection();
  // A plugin's page: there while it's installed.
  if (!isInstalled("work")) return <PluginNotInstalled id="work" />;
  const sp = await searchParams;
  // The tabs from before (todos, runs, branches, settings): their settings are on the Settings page now.
  if (sp.tab === "settings") redirect("/settings#work");
  if (sp.tab) redirect("/work");
  // The sidebar: tickets with sessions (archived ones on asking); a new session's tickets: all with work.
  const showArchived = sp.archived === "1";
  const tickets = sessionTickets({ archived: showArchived });
  const { archivedSessions } = await import("@/lib/work/session-admin");
  const archivedCount = archivedSessions().size;
  const runId = Number(sp.run) || null;
  const run = runId ? getRun(runId) : undefined;
  const ticket = sp.ticket === undefined ? undefined : sp.ticket === "-" ? "" : sp.ticket.toUpperCase();
  const composer = await composerOptions();
  const options = {
    tickets: tickets.filter((x) => x.ticket).map((x) => ({ key: x.ticket, summary: x.summary })),
    repos: listRepos().map((r) => ({ id: r.id, name: r.name, path: r.path })),
    // Each ticket's repo as Zeff infers it (board, ticket, Repos page): the composer starts there.
    ticketRepos: Object.fromEntries(
      [...new Set([...tickets.map((x) => x.ticket), ticket ?? ""].filter(Boolean))].flatMap((k) => {
        const m = repoForTicket(k);
        return m ? [[k.toUpperCase(), m.repo.path]] : [];
      }),
    ),
    providers: composer.providers.map((x) => ({ id: x.id, label: x.label })),
    composer,
  };
  const running = tickets.reduce((n, x) => n + x.sessions.filter((x) => x.status === "running").length, 0);
  const selected = { run: run?.id, ticket, isNew: !run && ticket === undefined };
  return (
    <SidebarFrame
      storageKey="zeff-work-sidebar"
      sidebar={<SessionSidebar tickets={tickets.filter((x) => x.sessions.length > 0)} selected={selected} showArchived={showArchived} archivedCount={archivedCount} />}
      contentClassName="flex-col"
    >
      <WorkFollow active={running > 0} />
      {run ? (
        <SessionPane run={toRunView(run)} options={options} />
      ) : ticket !== undefined ? (
        <TicketPane ticket={ticket} data={tickets.find((x) => x.ticket === ticket)} options={options} />
      ) : (
        <NewSessionPane options={options} running={running} />
      )}
    </SidebarFrame>
  );
}
