import { workingTodoIds } from "@/lib/work/live-driver";
import { healthLabel, type HealthState } from "@/lib/sync/source-health-shared";
import { isInstalled, stepAvailable } from "@/plugins/state";
import { getContextPrefs } from "@/lib/runs/context-prefs";
import { PRESYNC_ORDER } from "@/lib/runs/context-prefs-shared";
/**
 * The Ticket-Lage's pages, shared: the Todos tab (Todos plugin — your todos, and the recap) and
 * the Tickets tab (Tickets plugin — each ticket with its Lage). One base, two plugins: either tab
 * goes with its plugin.
 */
export type LageSearch = { todos?: string; view?: string; day?: string; /** "tickets": the Tickets toggle (the Tickets plugin's half). */ part?: string };

import Link from "next/link";
import { SidebarFrame } from "@/components/SidebarFrame";
import { connection } from "next/server";
import { BoardRunControls } from "@/components/boards/BoardRunControls";
import { RecapControls } from "@/components/boards/RecapControls";
import { RecapDayPicker } from "@/components/boards/RecapDayPicker";
import { RecapView } from "@/components/boards/RecapView";
import { recapEntities, recapsOf, recapState } from "@/lib/runs/recap";
import { previousWorkday, shiftWorkday, todayIso } from "@/lib/runs/recap-shared";
import { BoardView } from "@/components/boards/BoardView";
import { aiChoice } from "@/lib/ai";
import { AI_PROVIDER_INFO } from "@/lib/ai/shared";
import { boardRunState } from "@/lib/runs/run";
import { actionsDone } from "@/lib/runs/actions";
import { todoSources } from "@/lib/todos/sources";

import { WorkFollow } from "@/components/work/WorkFollow";
import { withAlternatives } from "@/lib/todos/alternatives";
import { activityNewsIds, todoActivity } from "@/lib/todos/activity";
import { boardTodos, doneTodos, doneTodoTickets, workerTodos } from "@/lib/todos/store";
import { lastGoodRun, latestRun } from "@/lib/runs/store";
import { gitlabCommentsByTicket } from "@/lib/gitlab/store";
import { mailsForTickets } from "@/lib/mail/store";
import { getTicketCards } from "@/lib/jira/store";
import { resolvedCommentIds } from "@/lib/resolved";
import { formatDayTime, formatLongDay, formatUsd } from "@/lib/format";
import { t } from "@/lib/i18n/server";


/** A run's time (stored as UTC "YYYY-MM-DD HH:MM:SS") in local words. */
const when = (utc: string | null) =>
  utc ? formatDayTime(`${utc.replace(" ", "T")}Z`) : "";
const minutes = (ms: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")} min` : "");

/**
 * Todos: your tickets on the boards chosen on the Jira tab, gone through the AI provider chosen
 * on the Settings page (Claude Code or Copilot CLI) — the lage, what happened on each, what's to
 * do (todos you tick off, and agents read through Zeff's MCP server), with the commands to go on
 * in Claude Code.
 */
export async function LagePage({ searchParams, part }: { searchParams: Promise<LageSearch>; /** Todos (the Todos plugin's tab) or Tickets (the Tickets plugin's): the same Lage, its two halves. */ part: "todos" | "tickets" }) {
  await connection();
  const sp = await searchParams;
  if (part === "todos" && (sp.view === "recap" || sp.view === "gestern")) return <RecapPage day={sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : previousWorkday()} />;
  const tab = sp.todos === "done" ? "done" : sp.todos === "activity" ? "activity" : sp.todos === "worker" ? "worker" : "open";
  const latest = latestRun();
  const live = boardRunState();
  // Running: the Lage being made, or (it's there already) the mails being related to its todos.
  const running = !!live && (latest?.status === "running" || (["mailtodos", "mails", "notetodos", "notes", "calendarmatch", "calendartodos", "documents", "docrelations", "knowledge", "briefingdb", "autoactions"].includes(live.phase) && live.id === latest?.id));
  const shown = latest?.status === "ok" ? latest : lastGoodRun();
  const failed = latest?.status === "error" ? latest : null;
  const keys = shown?.tickets.map((t) => t.key) ?? [];
  // With the todos on no ticket (from mails: a training, a form …).
  const todos = boardTodos([...keys, ""]);
  // (A live session waiting for you after its turn is idle: its todo is not "being worked on" - tick it off without stopping the session.)
  const busy = workingTodoIds();
  // The done ones whole only on their tab — the others count them (and their tickets for the cards).
  const doneSummary = doneTodoTickets();
  const done = tab === "done" ? doneTodos() : [];
  // The workers' own todos: counted always, whole on their tab.
  const worker = workerTodos();
  const ai = aiChoice();
  const aiLabel = `${AI_PROVIDER_INFO[ai.provider].label}${ai.model ? ` · ${ai.model}` : ""}`;
  // What "Jetzt auswerten" syncs first (Auswerten → Vorher synchronisieren), as installed.
  const pre = getContextPrefs().presync.sources;
  const presync = PRESYNC_ORDER.filter((k) => pre[k] && stepAvailable(k));
  const analyzed = shown?.tickets.filter((x) => x.analyzed).length ?? 0;

  return (
    <SidebarFrame
      storageKey="zeff-todos-sidebar"
      contentClassName="flex-col overflow-y-auto pr-1"
      sidebar={
        <>
          <WorkFollow active={busy.length > 0} />
          <ViewTabs view={part === "tickets" ? "tickets" : "lage"} />
          <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">{part === "tickets" ? t("Tickets") : t("Todos")}</h1>
          {shown && (
            <>
              <p className="text-xs text-zinc-500">{t("As of: {when}", { when: when(shown.finishedAt ?? shown.startedAt) })}</p>
              <p className="flex flex-wrap gap-1 text-[11px] text-zinc-500 max-sm:hidden dark:text-zinc-400">
                {[analyzed === 1 ? t("1 ticket analyzed") : t("{n} tickets analyzed", { n: analyzed }), shown.model, shown.durationMs ? minutes(shown.durationMs) : null, shown.costUsd != null ? `≈ ${formatUsd(shown.costUsd)}` : null]
                  .filter(Boolean)
                  .map((x) => (
                    <span key={x} className="rounded-md bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
                      {x}
                    </span>
                  ))}
              </p>
            </>
          )}
          </div>
          <BoardRunControls running={running} phase={live?.phase ?? null} since={live?.since ?? null} provider={live?.provider ?? aiLabel} presync={presync} />
          {/* The Lage's filter chips (from the tickets beside it) and its lede. */}
          {part === "tickets" && <div id="todos-filter-slot" />}
          {/* The briefing's text: on the Tickets tab only — the todos speak for themselves. */}
          {part === "tickets" && shown?.result?.lede && (
            <section className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
              <h2 className="mb-1 text-xs font-semibold tracking-wide text-zinc-500">{t("Briefing")}</h2>
              <p className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300">{shown.result.lede}</p>
              {/* What it may not know: the sources it read that weren't well as it ran. */}
              {!!shown.result.gaps?.length && (
                <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                  ⚠ {t("Not up to date when this ran:")}{" "}
                  {shown.result.gaps.map((g, i) => (
                    <span key={g.key}>
                      {i > 0 && ", "}
                      <a href={g.href} className="underline decoration-dotted hover:decoration-solid">
                        {g.label}
                      </a>{" "}
                      ({healthLabel(t, g.state as HealthState)})
                    </span>
                  ))}
                </p>
              )}
            </section>
          )}
          {failed && (
            <div role="alert" className="alert-error text-sm">
              {t("The last run ({when}) failed: {error}", { when: when(failed.startedAt), error: failed.error ?? "" })}
              {shown ? ` — ${t("this is the one before.")}` : ""}
            </div>
          )}
        </>
      }
    >

      {shown ? (
        <BoardView
          run={shown}
          todos={withAlternatives(todos)}
          // The done ones (and what they came from) only on their tab — the others just count them.
          done={done}
          worker={worker}
          doneCount={doneSummary.count}
          tab={tab}
          activity={tab === "activity" ? todoActivity() : []}
          activityIds={activityNewsIds()}
          cards={getTicketCards([...keys, ...doneSummary.tickets, ...(tab === "worker" ? worker.map((t) => t.ticket).filter(Boolean) : [])])}
          doneComments={[...resolvedCommentIds(shown.tickets.flatMap((t) => (t.recent ?? []).map((c) => c.id)))]}
          mails={mailsForTickets(keys)}
          gitlab={Object.fromEntries(
            Object.entries(gitlabCommentsByTicket(shown.tickets.filter((t) => t.analyzed).map((t) => t.key))).map(([k, list]) => [
              k,
              list.map((c) => ({ ...c, body: c.body.slice(0, 600) })),
            ]),
          )}
          sources={todoSources([...todos, ...done, ...(tab === "worker" ? worker : [])], shown.tickets)}
          actionsDone={actionsDone(shown.id)}
          runningTodos={busy}
          workOn={isInstalled("work")}
          showLede={false}
          filterSlot="todos-filter-slot"
          part={part}
        />
      ) : (
        !running && (
          <p className="card p-6 text-center text-sm text-zinc-500">
            {t("No briefing yet — “Run now” reads your tickets and has the AI ({ai}) write the briefing (takes a minute or two).", { ai: aiLabel })}
          </p>
        )
      )}
    </SidebarFrame>
  );
}

/** The Todos tab's views: the Ticket-Lage, the same per ticket (Tickets plugin), and the recap of what you did on a day. */
function ViewTabs({ view }: { view: "lage" | "tickets" | "recap" }) {
  return (
    <nav className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800" aria-label={t("Todos")}>
      {(
        [
          ["lage", t("Briefing"), "/todos"],
          ...(isInstalled("tickets") ? ([["tickets", t("Tickets"), "/todos?part=tickets"]] as const) : []),
          ["recap", t("Recap"), "/todos?view=recap"],
        ] as const
      ).map(([key, label, href]) => (
        <Link
          key={key}
          href={href}
          aria-current={view === key ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${view === key ? "border-indigo-600 text-zinc-900 dark:text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

const dayLabel = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return formatLongDay(new Date(y, m - 1, d));
};

/**
 * Recap: what you did on a day (the last workday unless another is picked — by the arrows or
 * the calendar) — a summary, then per ticket — written by the AI from your bookings, todos,
 * workers' runs, Jira, commits and GitLab. Made each workday morning for the day before, or by
 * hand; every one kept.
 */
function RecapPage({ day }: { day: string }) {
  const { latest, good } = recapsOf(day);
  const live = recapState();
  const running = !!live && live.day === day && latest?.status === "running";
  const shown = good;
  const failed = latest?.status === "error" ? latest : null;
  const ai = aiChoice();
  const aiLabel = `${AI_PROVIDER_INFO[ai.provider].label}${ai.model ? ` · ${ai.model}` : ""}`;
  const today = todayIso();
  const later = shiftWorkday(day, 1);
  return (
    <SidebarFrame
      storageKey="zeff-todos-sidebar"
      contentClassName="flex-col overflow-y-auto pr-1"
      sidebar={
        <>
          <ViewTabs view="recap" />
          <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href={`/todos?view=recap&day=${shiftWorkday(day, -1)}`} className="icon-btn" aria-label={t("Day before")} title={t("Day before")}>
              ←
            </Link>
            <h1 className="text-lg font-semibold">{dayLabel(day)}</h1>
            {later <= today && (
              <Link href={`/todos?view=recap&day=${later}`} className="icon-btn" aria-label={t("Day after")} title={t("Day after")}>
                →
              </Link>
            )}
            <RecapDayPicker day={day} max={today} />
          </div>
          {shown && (
            <p className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-zinc-400">
              <span>{t("As of: {when}", { when: when(shown.finishedAt ?? shown.startedAt) })}</span>
              {shown.model && <span>{shown.model}</span>}
              {shown.durationMs ? <span>{minutes(shown.durationMs)}</span> : null}
              {shown.costUsd != null && <span>≈ {formatUsd(shown.costUsd)}</span>}
            </p>
          )}
        </div>
          <RecapControls day={day} running={running} phase={running ? (live?.phase ?? null) : null} since={running ? (live?.since ?? null) : null} provider={live?.provider ?? aiLabel} again={!!shown} />
          {failed && (
            <div role="alert" className="alert-error text-sm">
              {t("Summarizing ({when}) failed: {error}", { when: when(failed.startedAt), error: failed.error ?? "" })}
              {shown ? ` — ${t("this is the one before.")}` : ""}
            </div>
          )}
        </>
      }
    >
      {shown ? (
        <RecapView recap={shown} cards={getTicketCards(shown.facts.tickets.map((t) => t.key))} entities={recapEntities(shown)} />
      ) : (
        !running && <p className="card p-6 text-center text-sm text-zinc-500">{t("No summary for this day yet — “Summarize” makes one (takes a minute).")}</p>
      )}
    </SidebarFrame>
  );
}
