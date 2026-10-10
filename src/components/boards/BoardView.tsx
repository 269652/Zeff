"use client";

import type { MailView } from "@/lib/mail/shared";
import { HoverCard } from "../HoverCard";
import { SourceBadge, SourceDetails } from "../SourceBadge";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { runTicketActionAction } from "@/plugins/todos/server-actions";
import { setJiraCommentResolvedAction } from "@/plugins/jira/server-actions";
import type { ActionDone } from "@/lib/boards/actions";
import {
  ATTENTION_LABELS,
  ATTENTIONS,
  type Attention,
  type BoardRunView,
  type BoardTicket,
  type TicketAction,
  type TodoSource,
  type TodoView,
} from "@/lib/boards/shared";
import { gitlabDone, type GitlabItemView } from "@/lib/gitlab/shared";
import type { TicketCard } from "@/lib/jira/ticket-card-shared";
import { GitlabResolve } from "../GitlabItemBadge";
import { ResolveToggle } from "../ResolveToggle";
import { toast } from "../Toaster";
import { TicketLink } from "../TicketLink";
import { PersistedDetails } from "../PersistedDetails";
import type { TodoEventView } from "@/lib/boards/activity-shared";
import { ActivityList } from "./ActivityList";
import { LinkPending } from "../LinkPending";
import { UnseenActivityBadge } from "./ActivitySeen";
import { FollowToggle } from "./FollowToggle";
import { TodoItem } from "./TodoItem";

/** Each attention's colours: its stripe, its chip, its share of the bar. */
const ATT: Record<Attention, { stripe: string; chip: string }> = {
  feedback: {
    stripe: "bg-orange-500",
    chip: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  },
  active: {
    stripe: "bg-teal-600",
    chip: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  },
  check: {
    stripe: "bg-indigo-500",
    chip: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  },
  spec: {
    stripe: "bg-purple-500",
    chip: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  },
  blocked: {
    stripe: "bg-zinc-400 dark:bg-zinc-500",
    chip: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  },
  ready: {
    stripe: "bg-slate-300 dark:bg-slate-600",
    chip: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  },
  stale: {
    stripe: "bg-stone-300 dark:bg-stone-700",
    chip: "bg-stone-100 text-stone-600 dark:bg-stone-900 dark:text-stone-300",
  },
};

const day = (iso: string | null | undefined) =>
  iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.` : "";
const ACTION_ICON: Record<TicketAction["type"], string> = {
  transition: "→",
  assign: "👤",
  comment: "💬",
};

/**
 * A change to the ticket the run suggests — "→ Testing", "Zuweisen: Christopher Lorenz", a
 * comment: asked once more (with the comment's text), then done in Jira through Zeff's Jira
 * connection. Done, it says what happened and when; failed, why (and it can be tried again).
 */
function TicketActionButton({
  runId,
  ticket,
  idx,
  action,
  done,
}: {
  runId: number;
  ticket: string;
  idx: number;
  action: TicketAction;
  done?: ActionDone;
}) {
  const [pending, start] = useTransition();
  if (done?.status === "done")
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
        <div className="font-medium">✓ {action.label}</div>
        <div className="text-emerald-800/70 dark:text-emerald-200/70">
          {done.detail} ·{" "}
          {new Date(done.at).toLocaleString("de-DE", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    );
  return (
    <div className="space-y-0.5">
      <button
        type="button"
        className="btn btn-sm w-full justify-start text-left"
        disabled={pending}
        title={
          action.comment ? `${action.why}\n\n${action.comment}` : action.why
        }
        onClick={() => {
          const ask =
            action.type === "comment"
              ? `Diesen Kommentar auf ${ticket} posten?\n\n${action.comment}`
              : `${ticket}: ${action.label}?\n\n${action.why}`;
          if (!window.confirm(ask)) return;
          start(async () => {
            const r = await runTicketActionAction(runId, ticket, idx);
            if (r?.ok) toast(r.message ?? `${ticket}: erledigt.`);
            else
              toast(r?.error ?? "Hat nicht geklappt.", {
                tone: "error",
                ms: 12000,
              });
          });
        }}
      >
        <span aria-hidden className="w-4 shrink-0 text-center">
          {ACTION_ICON[action.type]}
        </span>
        {pending ? "…" : action.label}
      </button>
      {action.why && (
        <p className="text-[11px] leading-snug text-zinc-400">{action.why}</p>
      )}
      {done?.status === "failed" && (
        <p className="text-[11px] leading-snug text-red-600 dark:text-red-400">
          Fehlgeschlagen: {done.detail}
        </p>
      )}
    </div>
  );
}

type Analysis = NonNullable<BoardRunView["result"]>["tickets"][number];

/** A comment's start, on one line. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * One ticket: what the run made of it — lead, the rest, flags, todos, what happened, the
 * comments (Jira's and on its merge requests, to mark done) — and how to go on with it.
 */
function TicketRow({
  facts,
  a,
  todos,
  cards,
  doneComments,
  gitlab,
  mails = [],
  sources,
  runningTodos,
  runId,
  actionsDone,
  workOn = true,
}: {
  /** The mails naming the ticket (inbox, notifications), newest first. */
  mails?: MailView[];
  facts: BoardTicket;
  a: Analysis | undefined;
  todos: TodoView[];
  cards: Record<string, TicketCard>;
  doneComments: Set<string>;
  gitlab: GitlabItemView[];
  sources: Record<string, TodoSource>;
  runningTodos: number[];
  runId: number;
  actionsDone: Record<string, ActionDone>;
  workOn?: boolean;
}) {
  const card = cards[facts.key];
  const recent = facts.recent ?? [];
  const attention = a?.attention ?? "ready";
  return (
    <article className="flex overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xs max-md:flex-col dark:border-zinc-800 dark:bg-zinc-900">
      <div
        className={`w-1 shrink-0 max-md:h-1 max-md:w-full ${ATT[attention].stripe}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-2.5 p-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <TicketLink
            ticket={facts.key}
            card={card}
            className="font-mono text-sm font-semibold text-indigo-700 dark:text-indigo-300"
          />
          <span className="font-medium">{facts.summary}</span>
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-zinc-600 uppercase dark:bg-zinc-800 dark:text-zinc-300">
            {facts.status}
          </span>
          {facts.followed && (
            <FollowToggle ticket={facts.key} followed={facts.followed} />
          )}
          {a && (
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ATT[attention].chip}`}
            >
              {ATTENTION_LABELS[attention]}
            </span>
          )}
        </div>
        {a ? (
          <p className="max-w-[75ch] text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            <strong className="text-zinc-900 dark:text-zinc-100">
              {a.lead}
            </strong>{" "}
            {a.summary}
          </p>
        ) : (
          <p className="text-sm text-zinc-400">
            Keine Auswertung in diesem Lauf.
          </p>
        )}
        {a && a.flags.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {a.flags.map((f) => (
              <span
                key={f}
                className="text-xs font-medium text-orange-700 dark:text-orange-400"
              >
                ⚑ {f}
              </span>
            ))}
          </div>
        )}
        {todos.some((t) => t.status === "open") && (
          <ul className="space-y-1 rounded-md bg-zinc-50 p-2 dark:bg-zinc-950/60">
            {todos
              .filter((t) => t.status === "open")
              .map((t) => (
                <TodoItem
                  workOn={workOn}
                  key={t.id}
                  t={t}
                  cards={cards}
                  sources={sources}
                  running={runningTodos.includes(t.id)}
                />
              ))}
          </ul>
        )}
        {/* Done and dismissed ones: folded away. */}
        {todos.some((t) => t.status !== "open") && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-zinc-500">
              Erledigt ({todos.filter((t) => t.status !== "open").length})
            </summary>
            <ul className="mt-1.5 space-y-1 rounded-md bg-zinc-50 p-2 dark:bg-zinc-950/60">
              {todos
                .filter((t) => t.status !== "open")
                .map((t) => (
                  <TodoItem
                  workOn={workOn}
                    key={t.id}
                    t={t}
                    cards={cards}
                    sources={sources}
                    running={runningTodos.includes(t.id)}
                  />
                ))}
            </ul>
          </details>
        )}
        {a && a.happened.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-zinc-500">
              Was passiert ist ({a.happened.length})
            </summary>
            <ul className="mt-1.5 space-y-0.5 text-zinc-600 dark:text-zinc-300">
              {a.happened.map((h, i) => (
                <li key={i}>
                  <span className="font-mono text-xs text-zinc-400">
                    {day(h.when)}
                  </span>{" "}
                  {h.who ? <span className="font-medium">{h.who}</span> : null}
                  {h.who ? " — " : ""}
                  {h.what}
                </li>
              ))}
            </ul>
          </details>
        )}
        {(recent.length > 0 || gitlab.length > 0) && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-zinc-500">
              Kommentare (
              {[
                recent.length
                  ? `Jira ${recent.length}${facts.comments > recent.length ? ` von ${facts.comments}` : ""}`
                  : "",
                gitlab.length ? `GitLab ${gitlab.length}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
              ) — erledigte fließen nicht in neue Todos
            </summary>
            {recent.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {recent.map((c) => (
                  <li key={c.id} className="flex items-start gap-2">
                    <ResolveToggle
                      done={doneComments.has(c.id)}
                      onChange={(next) =>
                        setJiraCommentResolvedAction(c.id, facts.key, next)
                      }
                      className="mt-0.5"
                    />
                    <span
                      className={`line-clamp-3 min-w-0 text-zinc-600 dark:text-zinc-300 ${doneComments.has(c.id) ? "opacity-60" : ""}`}
                    >
                      <span className="font-mono text-xs text-zinc-400">
                        {day(c.at)}
                      </span>{" "}
                      <span className="font-medium">{c.author}</span>:{" "}
                      {oneLine(c.text)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {gitlab.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {gitlab.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    <GitlabResolve item={c} className="mt-0.5" />
                    <span
                      className={`line-clamp-3 min-w-0 text-zinc-600 dark:text-zinc-300 ${gitlabDone(c) ? "opacity-60" : ""}`}
                    >
                      <span className="font-mono text-xs text-zinc-400">
                        {day(c.createdAt)}
                      </span>{" "}
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-orange-700 hover:underline dark:text-orange-300"
                        title={`Auf ${c.ref} ${c.title} — in GitLab öffnen`}
                      >
                        {c.ref}
                      </a>{" "}
                      <span className="font-medium">{c.author ?? "?"}</span>:{" "}
                      {oneLine(c.body)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
        {mails.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-zinc-500">
              Mails ({mails.length}{mails.some((m) => m.unread) ? `, ${mails.filter((m) => m.unread).length} ungelesen` : ""}) — die ersten Zeilen, wie Outlook sie listet
            </summary>
            <div className="mt-1.5 flex flex-col items-start gap-1">
              {mails.map((m) => (
                <HoverCard key={m.key} className="gap-1.5 sm:max-w-md" card={<SourceDetails entity={{ source: "mail", mail: m }} />}>
                  <SourceBadge entity={{ source: "mail", mail: m }} className="min-w-0" />
                </HoverCard>
              ))}
            </div>
          </details>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-zinc-400">
          {facts.issueType && <span>{facts.issueType}</span>}
          {facts.priority && <span>{facts.priority}</span>}
          <span>
            {facts.comments} Kommentar{facts.comments === 1 ? "" : "e"}
          </span>
          {facts.parent && <span>Parent {facts.parent}</span>}
          {facts.updatedAt && <span>zuletzt {day(facts.updatedAt)}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-zinc-200 p-3 md:w-60 md:border-l md:border-dashed max-md:border-t max-md:border-dashed dark:border-zinc-800">
        {facts.url && (
          <a
            href={facts.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-zinc-500 hover:text-indigo-600 hover:underline"
          >
            In Jira öffnen ↗
          </a>
        )}
        {a?.actions?.length ? (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-zinc-500 uppercase">
              Vorschläge
            </div>
            {a.actions.map((x, i) => (
              <TicketActionButton
                key={i}
                runId={runId}
                ticket={facts.key}
                idx={i}
                action={x}
                done={actionsDone[`${facts.key}#${i}`]}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-400">
            {a?.actions
              ? "Keine Änderung am Ticket vorgeschlagen."
              : "Vorschläge kommen mit der nächsten Auswertung."}
          </p>
        )}
        <Link
          href="/work"
          className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Todos im Work-Tab →
        </Link>
      </div>
    </article>
  );
}

/**
 * A run shown: the lage, the bar of attentions (a filter), your todos across tickets, each
 * ticket with what the run made of it, what left the list, what's only listed, todos done lately.
 */
export function BoardView({
  run,
  todos,
  done: doneList = [],
  doneCount,
  tab = "open",
  cards,
  doneComments = [],
  gitlab = {},
  mails = {},
  sources = {},
  actionsDone = {},
  runningTodos = [],
  activity = [],
  activityIds = [],
  workOn = true,
  showLede = true,
  filterSlot,
  part = "all",
}: {
  /** What of it: your todos (the Todos tab), the tickets with their Lage (the Tickets tab), or both. */
  part?: "todos" | "tickets" | "all";
  /** The element (its id) on the page's sidebar the Lage's filter chips go to. */
  filterSlot?: string;
  /** The Work plugin installed (the todos' ✨ instructions go to its workers). */
  workOn?: boolean;
  /** The Lage's lede on top (the Todos page has it in its sidebar). */
  showLede?: boolean;
  run: BoardRunView;
  todos: TodoView[];
  /** All done and dismissed todos (the "Erledigt" tab), latest first. */
  done?: TodoView[];
  /** How many there are (the tab's number) — the list itself only comes on its tab. */
  doneCount?: number;
  /** Which todos the card shows: open ones, or the done ones. */
  tab?: "open" | "done" | "activity";
  cards: Record<string, TicketCard>;
  doneComments?: string[];
  /** The comments on each ticket's merge requests, by ticket. */
  gitlab?: Record<string, GitlabItemView[]>;
  /** The mails naming each ticket, by ticket. */
  mails?: Record<string, MailView[]>;
  /** What the todos came from, by ref. */
  sources?: Record<string, TodoSource>;
  /** What was done with the run's suggested ticket changes, by "<ticket>#<index>". */
  actionsDone?: Record<string, ActionDone>;
  /** Todos a run has right now (queued or running). */
  runningTodos?: number[];
  /** What happened to the todos lately (the "Aktivität" tab). */
  activity?: TodoEventView[];
  /** The recent events that are news, for the unseen badge. */
  activityIds?: number[];
}) {
  const done = new Set(doneComments);
  // A link to one todo (a context badge's ↗): unfold what it's in, and bring it into view.
  useEffect(() => {
    const el = /^#todo-\d+$/.test(window.location.hash)
      ? document.getElementById(window.location.hash.slice(1))
      : null;
    if (!el) return;
    for (
      let d = el.closest("details");
      d;
      d = d.parentElement?.closest("details") ?? null
    )
      d.open = true;
    el.scrollIntoView({ block: "center" });
  }, []);
  const [filter, setFilter] = useState<Attention | "all">("all");
  // Where the filter chips go (the page's sidebar), found once it's there.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the slot exists only in the DOM
    if (filterSlot) setSlot(document.getElementById(filterSlot));
  }, [filterSlot]);
  const result = run.result;
  const facts = new Map(run.tickets.map((t) => [t.key, t]));
  const analysis = new Map((result?.tickets ?? []).map((t) => [t.key, t]));
  // The run's order (most urgent first), then analysed tickets it didn't speak to.
  const order = [
    ...(result?.tickets ?? []).map((t) => t.key),
    ...run.tickets
      .filter((t) => t.analyzed && !analysis.has(t.key))
      .map((t) => t.key),
  ].filter((k) => facts.has(k));
  const attentionOf = (key: string): Attention =>
    analysis.get(key)?.attention ?? "ready";
  const counts = ATTENTIONS.map((a) => ({
    a,
    n: order.filter((k) => attentionOf(k) === a).length,
  })).filter((x) => x.n > 0);
  const shown = order.filter(
    (k) => filter === "all" || attentionOf(k) === filter,
  );
  const open = todos.filter((t) => t.status === "open");
  // A ticket's todos: the open ones, then those done lately (struck through).
  // Flagged by you: on top; put down by you: below the rest (till they come back up).
  const down = (t: TodoView) => (t.flaggedAt ? -1 : t.deferred ? 1 : 0);
  // Linked todos (the same thing on two tickets) show on both.
  const onTicket = (t: TodoView, key: string) => t.ticket === key || t.alsoTickets.includes(key);
  const byTicket = (key: string) => [
    ...open.filter((t) => onTicket(t, key)).sort((x, y) => down(x) - down(y)),
    ...todos.filter((t) => onTicket(t, key) && t.status !== "open"),
  ];
  const rank = new Map(order.map((k, i) => [k, i]));
  const ranked = (list: TodoView[]) =>
    [...list].sort(
      (x, y) =>
        down(x) - down(y) || (rank.get(x.ticket) ?? 99) - (rank.get(y.ticket) ?? 99) || x.id - y.id,
    );
  const mine = ranked(open.filter((t) => t.owner === "me"));
  const waiting = ranked(open.filter((t) => t.owner === "other"));
  const left = run.tickets.filter((t) => t.left);
  const listed = run.tickets.filter((t) => !t.analyzed && !t.left);
  const leftNote = new Map((result?.left ?? []).map((l) => [l.key, l.note]));

  // The Lage's filter: its attentions as chips, each with how many — on the page's sidebar
  // (filterSlot: the element there), else above the list.
  const chips =
    order.length > 0 ? (
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Nach Lage filtern">
        {[{ a: "all" as const, n: order.length }, ...counts].map((c) => {
          const on = filter === c.a;
          return (
            <button
              key={c.a}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(c.a === "all" || on ? "all" : c.a)}
              className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-2 text-xs transition ${
                on
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              }`}
            >
              {c.a !== "all" && <span className={`size-2 shrink-0 rounded-full ${ATT[c.a].stripe}`} aria-hidden />}
              <span>{c.a === "all" ? "Alle" : ATTENTION_LABELS[c.a]}</span>
              <span className={on ? "opacity-70" : "text-zinc-400"}>{c.n}</span>
            </button>
          );
        })}
      </div>
    ) : null;
  return (
    <div className="space-y-8">
      {part !== "todos" && slot && chips && createPortal(chips, slot)}
      {showLede && result?.lede && (
        <p className="max-w-[80ch] text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
          {result.lede}
        </p>
      )}

      {part !== "todos" && !filterSlot && chips}

      {part !== "tickets" && (
      <section className="card space-y-3 p-4">
        <div
          className="flex flex-wrap items-center gap-1"
          role="tablist"
          aria-label="Todos"
        >
          {(
            [
              ["open", "Deine Todos", mine.length, "/todos"],
              ["done", "Erledigt", doneCount ?? doneList.length, "/todos?todos=done"],
              ["activity", "Aktivität", null, "/todos?todos=activity"],
            ] as const
          ).map(([key, label, n, href]) => (
            <Link
              key={key}
              href={href}
              scroll={false}
              role="tab"
              aria-selected={tab === key}
              className={`rounded-md px-2.5 py-1 text-sm font-semibold uppercase ${tab === key ? "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100" : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"}`}
            >
              {label}{" "}
              {n !== null && (
                <span className="font-normal normal-case text-zinc-400">
                  ({n})
                </span>
              )}
              {key === "activity" && tab !== "activity" && <UnseenActivityBadge ids={activityIds} className="ml-0.5 align-[1px]" />}
              <LinkPending />
            </Link>
          ))}
        </div>
        {tab === "activity" ? (
          <ActivityList events={activity} />
        ) : tab === "done" ? (
          doneList.length > 0 ? (
            <ul className="space-y-1">
              {doneList.map((t) => (
                <TodoItem
                  workOn={workOn}
                  key={t.id}
                  t={t}
                  showTicket
                  cards={cards}
                  sources={sources}
                  anchor
                  running={runningTodos.includes(t.id)}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">Noch nichts erledigt.</p>
          )
        ) : (
          <>
            {mine.length > 0 ? (
              <ul className="space-y-1">
                {mine.map((t) => (
                  <TodoItem
                  workOn={workOn}
                    key={t.id}
                    t={t}
                    showTicket
                    cards={cards}
                    sources={sources}
                    anchor
                    running={runningTodos.includes(t.id)}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">Nichts offen bei dir.</p>
            )}
            {waiting.length > 0 && (
              <PersistedDetails
                storageKey="boards-waiting"
                className="pt-1"
                summaryClassName="text-xs font-semibold text-zinc-500 uppercase"
                summary={`Wartet auf andere (${waiting.length})`}
              >
                <ul className="mt-1.5 space-y-1">
                  {waiting.map((t) => (
                    <TodoItem
                  workOn={workOn}
                      key={t.id}
                      t={t}
                      showTicket
                      cards={cards}
                      sources={sources}
                      anchor
                      running={runningTodos.includes(t.id)}
                    />
                  ))}
                </ul>
              </PersistedDetails>
            )}
          </>
        )}
      </section>

      )}

      {part !== "todos" && (
        <>
      <section className="space-y-3">
        {shown.map((key) => (
          <TicketRow
            key={key}
            facts={facts.get(key)!}
            a={analysis.get(key)}
            todos={byTicket(key)}
            cards={cards}
            doneComments={done}
            gitlab={gitlab[key] ?? []}
            mails={mails[key] ?? []}
            sources={sources}
            runningTodos={runningTodos}
            workOn={workOn}
            runId={run.id}
            actionsDone={actionsDone}
          />
        ))}
        {order.length === 0 && (
          <p className="card p-6 text-center text-sm text-zinc-500">
            Keine offenen Tickets auf den gewählten Boards.
          </p>
        )}
      </section>

      {left.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">
            Seit dem letzten Lauf nicht mehr auf der Liste
          </h2>
          <ul className="space-y-1.5 text-sm">
            {left.map((t) => (
              <li
                key={t.key}
                className="rounded-md border-l-2 border-indigo-400 bg-zinc-50 px-3 py-2 dark:bg-zinc-900"
              >
                <TicketLink
                  ticket={t.key}
                  card={cards[t.key]}
                  className="font-mono text-xs font-semibold text-indigo-700 dark:text-indigo-300"
                />{" "}
                <span className="text-zinc-500">({t.status})</span>{" "}
                {leftNote.get(t.key) ?? t.summary}{" "}
                <FollowToggle ticket={t.key} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {listed.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-500 uppercase">
            Nur gelistet{" "}
            <span className="font-normal normal-case text-zinc-400">
              — erledigt ohne Lösung oder seit Monaten unberührt (
              {listed.length})
            </span>
          </summary>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {listed.map((t) => (
                <tr
                  key={t.key}
                  className="border-t border-zinc-100 dark:border-zinc-800"
                >
                  <td className="py-1.5 pr-3 font-mono text-xs">
                    <TicketLink ticket={t.key} card={cards[t.key]} />
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-zinc-500">
                    {t.status}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs text-zinc-400">
                    {day(t.updatedAt)}
                  </td>
                  <td className="py-1.5 text-zinc-600 dark:text-zinc-300">
                    {t.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
        </>
      )}
    </div>
  );
}
