import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import { PersistedDetails } from "@/components/PersistedDetails";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { TicketLink } from "@/components/TicketLink";
import { BranchSelect } from "@/components/work/BranchSelect";
import { BranchWork } from "@/components/work/BranchWork";
import { allBranchWork } from "@/lib/branches";
import { RunPanel } from "@/components/work/RunPanel";
import { WorkFollow } from "@/components/work/WorkFollow";
import { WorkSettingsForm } from "@/components/work/WorkSettingsForm";
import { WorkTodo } from "@/components/work/WorkTodo";
import { ATTENTION_LABELS, todoRef, type TodoView } from "@/lib/boards/shared";
import {
  COMMS_KINDS,
  duration,
  WORK_MODE_LABELS,
  WORK_STATUS_LABELS,
} from "@/lib/work/shared";
import { aiChoice, aiProviders } from "@/lib/ai";
import { copilotModels } from "@/plugins/copilot-cli/cli";
import { workPageData } from "@/lib/work/view";
import { SidebarFrame } from "@/components/SidebarFrame";
import { SessionSidebar } from "@/components/work/SessionSidebar";
import { NewSessionPane, SessionPane, TicketPane } from "@/components/work/SessionPanes";
import { sessionTickets } from "@/lib/work/sessions";
import { getRun, toRunView } from "@/lib/work/store";
import { listRepos } from "@/lib/repos";

export const metadata: Metadata = { title: "Work" };

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/**
 * Work: the todos and the Ticket-Lage as pieces of work to hand out — to Claude Code (or the
 * Copilot CLI), up to the settings' number at once, unattended. Each run's log while it goes;
 * what it did, attached to its todo, once it's done: todos ticked off, the comments and messages
 * they came from marked done, follow-ups (replies, comments, ticket changes) drafted — to send
 * yourself or hand out again. Its time waits in the Weekly report, to book with a click.
 */
const TABS = [
  ["todos", "Todos"],
  ["runs", "Läufe"],
  ["branches", "Branches"],
  ["settings", "Settings"],
] as const;

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; run?: string; ticket?: string; new?: string }>;
}) {
  await connection();
  // A plugin's page: there while it's installed.
  if (!isInstalled("work")) return <PluginNotInstalled id="work" />;
  const sp = await searchParams;
  const tabParam = sp.tab;
  const tickets = sessionTickets();
  const sidebar = (selected: { ticket?: string; run?: number; isNew?: boolean }) => <SessionSidebar tickets={tickets} selected={selected} />;
  // Sessions (like Claude Code) — the views from before (todos, runs, branches, settings) by their tab.
  if (!tabParam) {
    const runId = Number(sp.run) || null;
    const run = runId ? getRun(runId) : undefined;
    const ticket = sp.ticket === undefined ? undefined : sp.ticket === "-" ? "" : sp.ticket.toUpperCase();
    const options = {
      tickets: tickets.filter((t) => t.ticket).map((t) => ({ key: t.ticket, summary: t.summary })),
      repos: listRepos().map((r) => ({ id: r.id, name: r.name })),
      providers: aiProviders()
        .filter((x) => x.found)
        .map((x) => ({ id: x.id, label: x.label })),
    };
    const running = tickets.reduce((n, t) => n + t.sessions.filter((x) => x.status === "running").length, 0);
    return (
      <SidebarFrame storageKey="zeff-work-sidebar" sidebar={sidebar({ run: run?.id, ticket, isNew: !run && ticket === undefined })} contentClassName="flex-col">
        <WorkFollow active={running > 0} />
        {run ? (
          <SessionPane run={toRunView(run)} options={options} />
        ) : ticket !== undefined ? (
          <TicketPane ticket={ticket} data={tickets.find((t) => t.ticket === ticket)} options={options} />
        ) : (
          <NewSessionPane options={options} running={running} />
        )}
      </SidebarFrame>
    );
  }
  const tab = tabParam === "branches" || tabParam === "settings" || tabParam === "runs" ? tabParam : "todos";
  const d = workPageData(
    aiChoice().provider === "copilot" ? await copilotModels() : [],
  );
  const running = d.active.filter(
    (r) => r.status === "running" && r.provider !== "agent",
  ).length;
  const agents = d.active.filter(
    (r) => r.status === "running" && r.provider === "agent",
  );
  const queued = d.active.filter((r) => r.status === "queued").length;
  const todoById = new Map(d.todos.map((t) => [t.id, t]));
  const analysis = new Map(
    (d.board?.result?.tickets ?? []).map((t) => [t.key, t]),
  );
  const facts = new Map((d.board?.tickets ?? []).map((t) => [t.key, t]));

  const item = (t: TodoView) => (
    <WorkTodo
      key={t.id}
      t={t}
      runs={d.runs[t.id] ?? []}
      sources={d.sources}
      cards={d.cards}
      providers={d.providers}
      preferred={d.preferred}
      targetUrl={d.targets[t.id] ?? null}
      created={d.created}
      repo={d.repoOf[t.ticket]?.name ?? null}
      full={running >= d.settings.parallel}
      parallel={d.settings.parallel}
    />
  );

  return (
    <SidebarFrame storageKey="zeff-work-sidebar" sidebar={sidebar({})} contentClassName="flex-col overflow-y-auto pr-1">
      <div className="space-y-6">
      <WorkFollow active={d.active.length > 0} />
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold">Work</h1>
        <div className="text-right text-sm text-zinc-500" role="status">
          <div>
            <span className="font-semibold text-zinc-700 dark:text-zinc-200">
              {running}/{d.settings.parallel}
            </span>{" "}
            workers busy{queued ? ` · ${queued} queued` : ""}
            {agents.length > 0 && (
              <span
                title={agents
                  .map((r) => `${r.ref}: ${r.model ?? "Agent"} on ${r.ticket}`)
                  .join("\n")}
              >
                {" "}
                · +{agents.length} extern (
                {[...new Set(agents.map((r) => r.model ?? "Agent"))].join(", ")}
                )
              </span>
            )}
          </div>
        </div>
      </div>

      <nav
        className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800"
        role="tablist"
        aria-label="Work"
      >
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/work?tab=${key}`}
            scroll={false}
            role="tab"
            aria-selected={tab === key}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? "border-indigo-600 text-zinc-900 dark:border-indigo-400 dark:text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
          >
            {label}
            {key === "settings" && !d.repos.length ? " ·  set up" : ""}
          </Link>
        ))}
      </nav>

      {tab === "branches" && <BranchesTab />}

      {tab === "settings" && (
        <section className="card p-4">
          <WorkSettingsForm
            s={d.settings}
            repos={d.repos}
            defaultModel={d.defaultModel}
            models={d.models}
            provider={d.preferred}
          />
        </section>
      )}

      {tab === "todos" && (
        <>
          {d.active.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-zinc-500 uppercase">
                Working now
              </h2>
              {d.active.map((r) => {
                const t = todoById.get(r.todoId);
                return (
                  <div key={r.id} className="space-y-1">
                    <a
                      href={`#work-todo-${r.todoId}`}
                      className="block truncate px-1 text-xs text-zinc-500 hover:underline"
                    >
                      <span className="font-mono">{r.ticket}</span> ·{" "}
                      <span className="font-mono">{todoRef(r.todoId)}</span>
                      {t ? ` — ${t.text}` : ""}
                    </a>
                    <RunPanel run={r} created={d.created[r.id] ?? []} />
                  </div>
                );
              })}
            </section>
          )}

          {!d.board && (
            <p className="card p-6 text-center text-sm text-zinc-500">
              No Ticket-Lage yet — run it on the{" "}
              <Link
                href="/todos"
                className="text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Todos
              </Link>{" "}
              tab: its todos are the work here.
            </p>
          )}

          {/* Tickets with open todos for you first; the others (only waiting on others, or done) folded away. */}
          {[
            d.tickets.filter((k) =>
              d.todos.some(
                (t) =>
                  t.ticket === k && t.status === "open" && t.owner === "me",
              ),
            ),
            d.tickets.filter(
              (k) =>
                !d.todos.some(
                  (t) =>
                    t.ticket === k && t.status === "open" && t.owner === "me",
                ),
            ),
          ].map((keys, group) => {
            const sections = keys.map((key) => {
              const mine = d.todos.filter((t) => t.ticket === key);
              const open = mine.filter((t) => t.status === "open");
              const code = open.filter(
                (t) => t.owner === "me" && !COMMS_KINDS.includes(t.kind),
              );
              const comms = open.filter(
                (t) => t.owner === "me" && COMMS_KINDS.includes(t.kind),
              );
              const waiting = open.filter((t) => t.owner === "other");
              const done = mine.filter((t) => t.status !== "open");
              const a = analysis.get(key);
              const f = facts.get(key);
              return (
                <section key={key} className="card overflow-hidden">
                  <header className="space-y-0.5 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <TicketLink
                        ticket={key}
                        card={d.cards[key]}
                        className="text-sm font-semibold text-indigo-700 dark:text-indigo-300"
                      />
                      <span className="font-medium">
                        {f?.summary ?? d.cards[key]?.summary ?? ""}
                      </span>
                      {a && (
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {ATTENTION_LABELS[a.attention]}
                        </span>
                      )}
                      <span className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                        {d.repoOf[key] ? (
                          <>
                            <Link
                              href="/repos"
                              className="hover:underline"
                              title={`Code work goes to ${d.repoOf[key]!.name} (${d.repoOf[key]!.via === "ticket" ? "the ticket is assigned to it" : d.repoOf[key]!.via === "board" ? "its board is assigned to it" : "its merge requests are in its GitLab project"})`}
                            >
                              <span className="font-medium text-zinc-700 dark:text-zinc-200">
                                {d.repoOf[key]!.name}
                              </span>
                            </Link>
                            {d.repoOf[key]!.branch && (
                              <BranchSelect
                                repoId={d.repoOf[key]!.id}
                                repo={d.repoOf[key]!.name}
                                path={d.repoOf[key]!.path}
                                branch={d.repoOf[key]!.branch!}
                                branches={d.repoOf[key]!.branches}
                              />
                            )}
                          </>
                        ) : (
                          <Link
                            href="/repos"
                            className="text-amber-700 hover:underline dark:text-amber-400"
                          >
                            no repo — set one
                          </Link>
                        )}
                      </span>
                    </div>
                    {a?.lead && (
                      <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        {a.lead}
                      </p>
                    )}
                  </header>
                  <div className="space-y-3 p-4">
                    {code.length + comms.length > 0 && (
                      <ul className="space-y-3">{[...code, ...comms].map(item)}</ul>
                    )}
                    {!code.length && !comms.length && (
                      <p className="text-sm text-zinc-500">
                        Nothing open for you here.
                      </p>
                    )}
                    {waiting.length > 0 && (
                      <PersistedDetails
                        storageKey="work-waiting"
                        summaryClassName="text-xs font-semibold text-zinc-500 uppercase"
                        summary={`Waiting for others (${waiting.length})`}
                      >
                        <ul className="mt-2 space-y-3">{waiting.map(item)}</ul>
                      </PersistedDetails>
                    )}
                    {done.length > 0 && (
                      <Link
                        href="/todos?todos=done"
                        className="block text-xs text-zinc-400 hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
                      >
                        {done.length} diese Woche erledigt →
                      </Link>
                    )}
                  </div>
                </section>
              );
            });
            if (group === 0)
              return (
                <div key="mine" className="space-y-6">
                  {sections}
                </div>
              );
            return keys.length > 0 ? (
              <details key="others" className="space-y-6">
                <summary className="cursor-pointer text-sm font-semibold text-zinc-500 uppercase">
                  Ohne Todos für dich ({keys.length})
                </summary>
                <div className="mt-3 space-y-6">{sections}</div>
              </details>
            ) : null;
          })}

        </>
      )}

      {tab === "runs" && (
        <>
          {d.history.length === 0 && (
            <p className="card p-6 text-center text-sm text-zinc-500">
              Noch keine Läufe.
            </p>
          )}
          {d.history.length > 0 && (
            <section className="space-y-2">
              <div className="space-y-1.5">
                {d.history.map((r) =>
                  todoById.has(r.todoId) ? (
                    <a
                      key={r.id}
                      href={`/work#w-${r.id}`}
                      className="flex flex-wrap items-baseline gap-x-2 rounded px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      <span className="font-mono font-semibold">{r.ref}</span>
                      <span className="text-zinc-500">
                        {when(r.startedAt ?? r.queuedAt)}
                      </span>
                      <span className="font-mono">{r.ticket}</span>
                      <span className="font-mono text-zinc-500">
                        {todoRef(r.todoId)}
                      </span>
                      <span>{WORK_MODE_LABELS[r.mode]}</span>
                      <span className="text-zinc-500">
                        {WORK_STATUS_LABELS[r.status]}
                        {r.outcome ? ` (${r.outcome})` : ""}
                      </span>
                      <span className="text-zinc-500">
                        {duration(r.durationMs)}
                        {r.costUsd != null ? ` · $${r.costUsd.toFixed(2)}` : ""}
                      </span>
                      {r.entryId && (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          booked
                        </span>
                      )}
                      {r.entryLine && (
                        <span className="min-w-0 truncate text-zinc-500">
                          — {r.entryLine}
                        </span>
                      )}
                    </a>
                  ) : (
                    <div key={r.id}>
                      <div className="px-1 pb-0.5 text-xs text-zinc-500">
                        {r.ticket} · {todoRef(r.todoId)}
                      </div>
                      <RunPanel run={r} />
                    </div>
                  ),
                )}
              </div>
            </section>
          )}
        </>
      )}
      </div>
    </SidebarFrame>
  );
}

/** The Branches tab: what the repos' local branches need (git is only asked here). */
function BranchesTab() {
  const items = allBranchWork();
  return items.some((b) => !b.ignored) ? (
    <BranchWork items={items} />
  ) : (
    <p className="card p-6 text-center text-sm text-zinc-500">
      No local branch needs anything
      {items.length ? ` (${items.length} ignored)` : ""}.
    </p>
  );
}
