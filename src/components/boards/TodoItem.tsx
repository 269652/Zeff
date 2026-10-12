"use client";

import { actionHref } from "@/plugins/actions/catalog";
import { useT } from "@/components/I18nProvider";
import { Fragment, useState, useTransition } from "react";
import { deferTodoAction, runTodoOpsAction, setTodoStatusAction, suggestTodoActionsAction } from "@/plugins/todos/server-actions";
import {
  opsButton,
  opTitle,
  sourcesOf,
  todoKindLabels,
  type TodoSource,
  type TodoLinks,
  type TodoStatus,
  type TodoView,
} from "@/lib/boards/shared";
import { OpChips } from "./OpChips";
import type { TicketCard } from "@/lib/jira/ticket-card-shared";
import { isChatFolder } from "@/lib/mail/shared";
import { CopyButton } from "../CopyButton";
import { HoverCard } from "../HoverCard";
import { BookIcon, SparkIcon, ToBottomIcon, ToTopIcon } from "../icons";
import { usePluginOn } from "../PluginFlags";
import { entitiesFor, pagesFor } from "@/plugins/knowledge/shared";
import { TodoKnowledgeList, TodoKnowledgePreview } from "@/plugins/knowledge/TodoKnowledge";
import { DueBadge } from "./DueBadge";
import { FlagButton } from "./FlagButton";
import { TicketLink } from "../TicketLink";
import { toast } from "../Toaster";
import { TodoAlternatives } from "./TodoAlternatives";
import { AreaToggle, ContextList, ContextToggle, useContextItems } from "./TodoSources";
import { RunningSpinner } from "../RunningSpinner";
import { TodoPlan } from "./TodoPlan";
import { TodoRefs } from "./TodoRefs";
import { PersonText } from "@/plugins/people/PersonMention";
import { LastError } from "./LastError";
import { TodoQuickButtons, TodoQuickPanel, type QuickPanel } from "./TodoQuick";
import { useTodoNew } from "./todo-seen";
import { formatMinutes } from "@/lib/work/shared";

const TICKET_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
const LINK =
  "font-mono text-indigo-700 not-italic hover:underline dark:text-indigo-300";

/** A ticket key as a link: with its hover card when synced, else to Jira by the address the others have. */
function Ticket({
  k,
  cards,
  external = false,
}: {
  k: string;
  cards: Record<string, TicketCard>;
  /** With ↗ (in the meta line, like the merge request's link). */
  external?: boolean;
}) {
  const card = cards[k];
  if (card?.url) return <TicketLink ticket={k} card={card} className={LINK} external={external} />;
  const base = Object.values(cards)
    .find((c) => c.url)
    ?.url?.replace(/\/browse\/[^/]+$/, "/browse/");
  return base ? (
    <a href={`${base}${k}`} target="_blank" rel="noreferrer" className={LINK}>
      {k}
      {external && " ↗"}
    </a>
  ) : (
    <span className="font-mono">{k}</span>
  );
}

/** A todo's text with the ticket keys in it as links. */
export function Linked({
  text,
  cards,
  mrs = [],
}: {
  text: string;
  cards: Record<string, TicketCard>;
  /** Merge requests it names ("!168"), as links. */
  mrs?: TodoLinks["mrs"];
}) {
  const parts = text.split(TICKET_KEY);
  return parts.map((p, i) =>
    i % 2 ? (
      <Ticket key={i} k={p} cards={cards} />
    ) : mrs.length ? (
      <Fragment key={i}>
        {p.split(/((?<![\w/])!\d+\b)/).map((q, j) => {
          const mr = j % 2 ? mrs.find((m) => m.ref === q) : undefined;
          return mr ? (
            <a key={j} href={mr.url} target="_blank" rel="noreferrer" className={LINK} title={`${mr.ref}: ${mr.title}${mr.state ? ` (${mr.state})` : ""}`}>
              {q}
            </a>
          ) : (
            <PersonText key={j} text={q} render={(s) => <TodoRefs text={s} />} />
          );
        })}
      </Fragment>
    ) : (
      <PersonText key={i} text={p} render={(s) => <TodoRefs text={s} />} />
    ),
  );
}

/** A todo's merge requests, linked (in its meta line). */
export function TodoMrLinks({ mrs = [] }: { mrs?: TodoLinks["mrs"] }) {
  const t = useT();
  return mrs.map((m) => (
    <Fragment key={m.url}>
      {" · "}
      <a href={m.url} target="_blank" rel="noreferrer" className="font-mono text-indigo-600 hover:underline dark:text-indigo-400" title={t("{title} — open in GitLab", { title: `${m.title}${m.state ? ` (${m.state})` : ""}` })}>
        MR {m.ref} ↗
      </a>
      {m.state && /merged|closed|approved/i.test(m.state) && <span className="ml-1 text-zinc-400">({/merged/i.test(m.state) ? t("merged") : /closed/i.test(m.state) ? t("closed") : t("approved")})</span>}
    </Fragment>
  ));
}

/**
 * One todo: tick it done (or open again), dismiss it when it doesn't apply, copy its reference
 * ("T-12 (PROJ-364): …") to hand to an agent. Someone else's move is shown as waited for; ticket
 * keys are links to Jira; what it came from (`sources`, by ref) shows as badges with hover
 * cards. `anchor`: the one a link to it (/boards#todo-12) goes to.
 */
export function TodoItem({
  t: todo,
  showTicket = false,
  cards = {},
  sources = {},
  anchor = false,
  running = false,
  workOn = true,
}: {
  /** The Work plugin installed — else no ✨ instruction (no worker to take it). */
  workOn?: boolean;
  t: TodoView;
  showTicket?: boolean;
  cards?: Record<string, TicketCard>;
  sources?: Record<string, TodoSource>;
  anchor?: boolean;
  /** A run has it (queued or running): its operations are being done. */
  running?: boolean;
}) {
  const t = useT();
  // Shown at once; the server's say once it answers (and when it changes).
  const [status, setStatus] = useState<TodoStatus>(todo.status);
  const [from, setFrom] = useState(todo.status);
  if (from !== todo.status) {
    setFrom(todo.status);
    setStatus(todo.status);
  }
  const [, start] = useTransition();
  const [doing, startDoing] = useTransition();
  const [quick, setQuick] = useState<QuickPanel>(null);
  const [showActions, setShowActions] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const knowledgeOn = usePluginOn("knowledge");
  // The knowledge the Wissens-Zuordnung picked for it (only what fits) — none: no toggle.
  const knowledgePages = todo.knowledge ? pagesFor(todo.knowledge.pages, todo.id) : [];
  const knowledgeEntities = todo.knowledge ? entitiesFor(todo.knowledge.entities, knowledgePages) : [];
  const knowledge = knowledgeOn && (knowledgePages.length || knowledgeEntities.length) ? { pages: knowledgePages, entities: knowledgeEntities } : null;
  const [, startDefer] = useTransition();
  const set = (next: TodoStatus) => {
    const before = status;
    setStatus(next);
    start(async () => {
      const r = await setTodoStatusAction(todo.id, next);
      if (r && !r.ok) {
        setStatus(todo.status);
        toast(r.error ?? t("{ref} couldn't be changed.", { ref: todo.ref }), { tone: "error" });
        return;
      }
      toast(
        next === "open"
          ? t("{ref} is open again.", { ref: todo.ref })
          : next === "done"
            ? t("{ref} done.", { ref: todo.ref })
            : t("{ref} dismissed.", { ref: todo.ref }),
        {
          action: {
            label: t("Undo"),
            run: () => setTodoStatusAction(todo.id, before),
          },
        },
      );
    });
  };
  const closed = status !== "open";
  // Proposed by the auto-actions review: folded behind "Show actions (n)" — they're suggestions.
  const proposed = todo.ops.length > 0 && !closed && !!todo.autoOpsWhy;
  const cameFrom = sourcesOf(todo.refs, sources);
  // Where a todo without a ticket came from: WhatsApp (Signal) when its messages are all that app's chats.
  const msgs = cameFrom.filter((s) => s.source === "mail");
  const apps = [...new Set(msgs.map((s) => (s.source === "mail" ? s.mail.folder : "")))];
  const origin = msgs.length && apps.length === 1 && isChatFolder(apps[0]) ? apps[0] : "Mail";
  const context = useContextItems(cameFrom, [...todo.userNotes, ...(todo.relatedNotes ?? [])], todo.id);
  // An agent on it asks you something and waits.
  const asking = !closed && todo.needsInput ? todo.needsInput : null;
  // A worker or agent says it's done: highlighted, still open - closing it is yours.
  const reported = !closed && !asking && !!todo.workerDone;
  // What Zeff runs on a click — those that open in your browser (a mail draft, an appointment) are links of their own.
  const zeffOps = todo.ops.filter((o) => !actionHref(o));
  // New since you last looked: lightly highlighted till the mouse passes over it.
  const [fresh, markSeen] = useTodoNew(todo.id, todo.createdAt);
  // (A worker's own todo is quiet: never "new".)
  const isFresh = fresh && !todo.byWorker && !closed && !asking && !running && !doing;
  return (
    <li
      id={anchor ? `todo-${todo.id}` : undefined}
      className={`group flex scroll-mt-24 items-start gap-2 rounded target:bg-amber-50 dark:target:bg-amber-950/40 ${asking ? "-mx-2 bg-amber-50 px-2 py-1.5 ring-1 ring-amber-300 dark:bg-amber-950/40 dark:ring-amber-800" : reported ? "-mx-2 bg-emerald-50 px-2 py-1.5 ring-1 ring-emerald-300 dark:bg-emerald-950/30 dark:ring-emerald-800" : running || doing ? "-mx-2 bg-indigo-50 px-2 py-1.5 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:ring-indigo-900" : isFresh ? "-mx-2 bg-sky-50/80 px-2 py-1.5 ring-1 ring-sky-100 dark:bg-sky-950/30 dark:ring-sky-900/60" : todo.deferred && !closed ? "opacity-60 hover:opacity-100" : ""}`}
      onMouseEnter={fresh ? markSeen : undefined}
      title={asking ? t("The agent is waiting for you: {question}", { question: asking }) : running ? t("Being worked on (worker or agent)") : undefined}
    >
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0 cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
        checked={closed}
        disabled={running || doing}
        title={running || doing ? t("Being worked on — once the run is done") : undefined}
        onChange={() => set(closed ? "open" : "done")}
        aria-label={closed ? t("{ref} open again", { ref: todo.ref }) : t("{ref} done", { ref: todo.ref })}
      />
      <div className="min-w-0 flex-1 text-sm" data-hover-column>
        <span
          className={
            closed
              ? "text-zinc-400 line-through"
              : todo.owner === "other"
                ? "text-zinc-600 italic dark:text-zinc-300"
                : ""
          }
        >
          {asking && (
            <span className="mr-1 font-bold text-amber-600 not-italic dark:text-amber-400" title={t("The agent is waiting for you: {question}", { question: asking })} aria-label={t("Waiting for you")}>
              ❗
            </span>
          )}
          {(running || doing) && !closed && !asking && <RunningSpinner title={doing ? t("Starting") : t("Being worked on (worker or agent)")} />}
          {todo.owner === "other" && !closed && !(running || doing) && (
            <span className="mr-1 not-italic" title={t("Waiting for others")}>
              ⏳
            </span>
          )}
          <Linked text={todo.text} cards={cards} mrs={todo.links?.mrs} />
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-zinc-400">
          <CopyButton text={todo.ref} className="font-mono hover:text-indigo-600 hover:underline dark:hover:text-indigo-400" title={t("Copy “{text}” — for Copilot / Claude Code", { text: todo.ref })}>
            {todo.ref}
          </CopyButton>
          {/* Linked to more than one ticket (the same thing on both): all of them, the main one first. */}
          {!todo.ticket && <> · <span title={origin === "WhatsApp" ? t("From WhatsApp — no ticket") : origin === "Signal" ? t("From Signal — no ticket") : t("From a mail — no ticket")}>{origin === "WhatsApp" ? t("from WhatsApp") : origin === "Signal" ? t("from Signal") : t("from Mail")}</span></>}
          {todo.ticket && (showTicket || todo.alsoTickets.length > 0) && (
            <>
              {" · "}
              <Ticket k={todo.ticket} cards={cards} external />
              {todo.alsoTickets.map((k) => (
                <span key={k} title={t("Linked ticket — it's about the same thing")}>
                  {" + "}
                  <Ticket k={k} cards={cards} external />
                </span>
              ))}
            </>
          )}
          <TodoMrLinks mrs={todo.links?.mrs} />
          {" "}· {todoKindLabels(t)[todo.kind]}
          <DueBadge todoId={todo.id} due={todo.due} closed={closed} />
          {/* The time reported on it (agents', yours): a click opens the records. */}
          {!!todo.time?.length && (
            <>
              {" · "}
              <button type="button" className="hover:text-indigo-600 hover:underline dark:hover:text-indigo-400" onClick={() => setQuick(quick === "time" ? null : "time")} title={t("{n} time record(s) — click for them", { n: todo.time.length })}>
                ⏱ {formatMinutes(todo.time.reduce((a, r) => a + r.minutes, 0))}
              </button>
            </>
          )}
          {todo.path && <> · {t("Path “{path}”", { path: todo.path })}</>}
          {todo.flaggedAt && !closed && <span className="font-medium text-red-600 dark:text-red-400"> · {t("important")}</span>}
          {reported && todo.workerDone && (
            <span
              className="font-medium text-emerald-700 dark:text-emerald-400"
              title={todo.workerDone.note ? t("{by} reports this done: {note} — tick it off to close it", { by: todo.workerDone.by, note: todo.workerDone.note }) : t("{by} reports this done — tick it off to close it", { by: todo.workerDone.by })}
            >
              {" "}
              · ✓ {t("{by}: reported done", { by: todo.workerDone.by.split(" · ")[0] })}
            </span>
          )}
          {todo.deferred && !closed && <span className="text-zinc-400"> · {t("deferred")}</span>}
          {todo.bubbledUp && !closed && <span className="text-amber-600 dark:text-amber-400" title={t("You had moved it down — it's back on top")}> · {t("back on top: {why}", { why: todo.bubbledUp })}</span>}
          {!closed && <TodoQuickButtons todoId={todo.id} panel={quick} onToggle={setQuick} canReply={todo.owner === "me" && [...todo.refs, ...todo.mailRefs].some((r) => r.startsWith("mail:") || r.startsWith("teams:"))} aiDisabled={!workOn ? t("Work isn't installed (Menu → Plugins)") : running || doing ? t("Being worked on — once the run is done") : undefined} />}
        </span>
        <TodoQuickPanel todoId={todo.id} todoRef={todo.ref} panel={closed && quick !== "time" ? null : quick} onClose={() => setQuick(null)} time={todo.time} />
        {todo.note ? (
          <span className="block text-xs text-zinc-400">
            <TodoRefs text={todo.note} />
          </span>
        ) : (
          todo.source &&
          !cameFrom.length && (
            <span className="block text-xs text-zinc-400">
              {t("Source: {source}", { source: todo.source })}
            </span>
          )
        )}
        {asking && (
          <span className="mt-1 block text-xs whitespace-pre-line text-amber-700 dark:text-amber-300">
            <strong>{t("Waiting for you:")}</strong> {asking}
          </span>
        )}
        {todo.lastError && !closed && !running && !doing && <LastError text={todo.lastError} run={todo.lastErrorRun} />}
        {/* Its toggles in one row — context, proposed actions; each unfolds its area below the row, stacked. */}
        {(context.items.length > 0 || proposed || knowledge) && (
          <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <ContextToggle
              items={context.items}
              unread={context.unread}
              open={showContext}
              onToggle={() => {
                if (!showContext) context.markSeen();
                setShowContext(!showContext);
              }}
            />
            {proposed &&
              (() => {
                const toggle = (
                  <AreaToggle open={showActions} onToggle={() => setShowActions(!showActions)} label={showActions ? t("Hide actions ({n})", { n: todo.ops.length }) : t("Show actions ({n})", { n: todo.ops.length })} tone="violet">
                    <SparkIcon className="size-3.5" />
                  </AreaToggle>
                );
                // Closed: hover it for what they'd do, and why.
                return showActions ? (
                  toggle
                ) : (
                  <HoverCard
                    card={
                      <div className="space-y-1.5 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 text-xs">
                        <p className="flex items-start gap-1 text-violet-700 dark:text-violet-300">
                          <SparkIcon className="mt-px size-3.5 shrink-0" />
                          <span>{t("Suggested: {why}", { why: todo.autoOpsWhy })}</span>
                        </p>
                        <ul className="space-y-1">
                          {todo.ops.map((op, i) => (
                            <li key={i} className="break-words rounded border border-sky-200 bg-sky-50 px-2 py-1 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100">
                              ⚡ {opTitle(op, t)}
                            </li>
                          ))}
                        </ul>
                        <p className="text-zinc-500">{t("Click: review, adjust, run")}</p>
                      </div>
                    }
                  >
                    {toggle}
                  </HoverCard>
                );
              })()}
            {/* What the knowledge base has on it — as the Wissens-Zuordnung picked it. */}
            {knowledge &&
              (() => {
                const toggle = (
                  <AreaToggle open={showKnowledge} onToggle={() => setShowKnowledge(!showKnowledge)} label={showKnowledge ? t("Hide knowledge ({n})", { n: knowledge.pages.length + knowledge.entities.length }) : t("Show knowledge ({n})", { n: knowledge.pages.length + knowledge.entities.length })} tone="emerald">
                    <BookIcon className="size-3.5" />
                  </AreaToggle>
                );
                return showKnowledge ? (
                  toggle
                ) : (
                  <HoverCard width={560} card={<TodoKnowledgePreview k={knowledge} todoId={todo.id} />}>
                    {toggle}
                  </HoverCard>
                );
              })()}
          </span>
        )}
        {showKnowledge && knowledge && (
          <div className="mt-1.5">
            <TodoKnowledgeList k={knowledge} todoId={todo.id} />
          </div>
        )}
        {showContext && context.items.length > 0 && (
          <span className="mt-1.5 block">
            <ContextList items={context.items} todoId={todo.id} />
          </span>
        )}
        {todo.ops.length > 0 && !closed && (!proposed || showActions) && (
          <span className="mt-1.5 flex flex-col gap-1.5">
            {/* Proposed by the auto-actions review: said so, and why. */}
            {proposed && (
              <span
                className="flex items-start gap-1 text-xs text-violet-700 dark:text-violet-300"
                title={t("Suggested by the auto-actions step — review, adjust (✎), then run")}
              >
                <SparkIcon className="mt-px size-3.5 shrink-0" />
                <span>{t("Suggested: {why}", { why: todo.autoOpsWhy })}</span>
                <ProposeAgain todoId={todo.id} />
              </span>
            )}
            <span className="flex items-center gap-2 max-sm:flex-col max-sm:items-start">
              <OpChips
                ops={todo.ops}
                className="min-w-0 flex-1 items-stretch"
                todoId={doing || running ? undefined : todo.id}
                notes={todo.links?.notes}
              />
              {zeffOps.length > 0 && <button
                type="button"
                className="btn btn-sm btn-primary shrink-0"
                disabled={doing || running || !!todo.blockedBy}
                title={todo.blockedBy ? t("Waiting: {what} — the GitLab sync notices once it's ready", { what: todo.blockedBy }) : t("Zeff does it itself, no AI: {ops}", { ops: zeffOps.map((o) => opTitle(o, t)).join(" · ") })}
                onClick={() =>
                  startDoing(async () => {
                    // Zeff runs them right now (no worker, no Work tab).
                    const r = await runTodoOpsAction(todo.id);
                    toast(r?.ok ? `${todo.ref}: ${r.message}` : `${todo.ref}: ${r?.error ?? t("Didn't work.")}`, { tone: r?.ok ? "ok" : "error" });
                  })
                }
              >
                {doing || running ? t("running…") : opsButton(zeffOps, t)}
              </button>}
            </span>
            <TodoAlternatives t={todo} disabled={doing || running} />
          </span>
        )}
        {/* What comes after it — last, under its actions. */}
        <TodoPlan t={{ planned: todo.planned, status }} />
      </div>
      {!closed && <FlagButton todoId={todo.id} todoRef={todo.ref} flagged={!!todo.flaggedAt} />}
      {!closed && (
        <button
          type="button"
          className={`icon-btn ${todo.deferred ? "text-indigo-600 opacity-100 dark:text-indigo-400" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
          onClick={() =>
            startDefer(async () => {
              const r = await deferTodoAction(todo.id, !todo.deferred);
              if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
            })
          }
          title={todo.deferred ? t("Bring back to the top") : t("Move down — set aside for now (comes back up when something happens, in 3 days at the latest)")}
          aria-label={todo.deferred ? t("Move {ref} back up", { ref: todo.ref }) : t("Move {ref} down", { ref: todo.ref })}
        >
          {todo.deferred ? <ToTopIcon /> : <ToBottomIcon />}
        </button>
      )}
      {!closed && (
        <button
          type="button"
          className="icon-btn text-base opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => set("dismissed")}
          title={t("Dismiss — doesn't apply")}
          aria-label={t("Dismiss {ref}", { ref: todo.ref })}
        >
          ×
        </button>
      )}
    </li>
  );
}

/** "Neu vorschlagen": the auto-actions look at this todo again (what it knows now — a chat's language, a new message) — no Work needed. */
function ProposeAgain({ todoId }: { todoId: number }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="ml-1 shrink-0 font-medium hover:underline disabled:opacity-50"
      disabled={pending}
      title={t("The AI suggests the actions for this todo again — with everything it knows now")}
      onClick={() =>
        start(async () => {
          const r = await suggestTodoActionsAction(todoId);
          toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
        })
      }
    >
      {pending ? t("suggesting …") : `↻ ${t("Suggest again")}`}
    </button>
  );
}
