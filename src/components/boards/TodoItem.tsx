"use client";

import { actionHref } from "@/plugins/actions/catalog";
import { Fragment, useState, useTransition } from "react";
import { deferTodoAction, runTodoOpsAction, setTodoStatusAction, suggestTodoActionsAction } from "@/plugins/todos/server-actions";
import {
  agentInstruction,
  opLabel,
  opsButton,
  sourcesOf,
  TODO_KIND_LABELS,
  type TodoSource,
  type TodoLinks,
  type TodoStatus,
  type TodoView,
} from "@/lib/boards/shared";
import { OpChips } from "../work/WorkTodo";
import type { TicketCard } from "@/lib/jira/ticket-card-shared";
import { CopyButton } from "../CopyButton";
import { HoverCard } from "../HoverCard";
import { BookIcon, SparkIcon, ToBottomIcon, ToTopIcon } from "../icons";
import { usePluginOn } from "../PluginFlags";
import { TodoKnowledgeList, TodoKnowledgePreview } from "@/plugins/knowledge/TodoKnowledge";
import { DueBadge } from "./DueBadge";
import { FlagButton } from "./FlagButton";
import { TicketLink } from "../TicketLink";
import { toast } from "../Toaster";
import { TodoAlternatives } from "./TodoAlternatives";
import { AreaToggle, ContextList, ContextToggle, useContextItems } from "./TodoSources";
import { RunningSpinner } from "../RunningSpinner";
import { useAgentInstructions } from "../AgentInstructions";
import { TodoPlan } from "./TodoPlan";
import { TodoRefs } from "./TodoRefs";
import { LastError } from "./LastError";
import { TodoQuickButtons, TodoQuickPanel, type QuickPanel } from "./TodoQuick";
import { useTodoNew } from "./todo-seen";

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
            <TodoRefs key={j} text={q} />
          );
        })}
      </Fragment>
    ) : (
      <TodoRefs key={i} text={p} />
    ),
  );
}

/** A todo's merge requests, linked (in its meta line). */
export function TodoMrLinks({ mrs = [] }: { mrs?: TodoLinks["mrs"] }) {
  return mrs.map((m) => (
    <Fragment key={m.url}>
      {" · "}
      <a href={m.url} target="_blank" rel="noreferrer" className="font-mono text-indigo-600 hover:underline dark:text-indigo-400" title={`${m.title}${m.state ? ` (${m.state})` : ""} — in GitLab öffnen`}>
        MR {m.ref} ↗
      </a>
      {m.state && /merged|closed|approved/i.test(m.state) && <span className="ml-1 text-zinc-400">({/merged/i.test(m.state) ? "gemergt" : /closed/i.test(m.state) ? "geschlossen" : "approved"})</span>}
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
  t,
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
  // Shown at once; the server's say once it answers (and when it changes).
  const [status, setStatus] = useState<TodoStatus>(t.status);
  const [from, setFrom] = useState(t.status);
  if (from !== t.status) {
    setFrom(t.status);
    setStatus(t.status);
  }
  const [, start] = useTransition();
  const [doing, startDoing] = useTransition();
  const [quick, setQuick] = useState<QuickPanel>(null);
  const [showActions, setShowActions] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const knowledgeOn = usePluginOn("knowledge");
  // The knowledge the Wissens-Zuordnung picked for it (only what fits) — none: no toggle.
  const knowledge = knowledgeOn && t.knowledge && (t.knowledge.pages.length || t.knowledge.entities.length) ? { pages: t.knowledge.pages, entities: t.knowledge.entities } : null;
  const [, startDefer] = useTransition();
  const instructions = useAgentInstructions();
  const set = (next: TodoStatus) => {
    const before = status;
    setStatus(next);
    start(async () => {
      const r = await setTodoStatusAction(t.id, next);
      if (r && !r.ok) {
        setStatus(t.status);
        toast(r.error ?? `${t.ref} ließ sich nicht ändern.`, { tone: "error" });
        return;
      }
      toast(
        next === "open"
          ? `${t.ref} ist wieder offen.`
          : `${t.ref} ${next === "done" ? "erledigt" : "verworfen"}.`,
        {
          action: {
            label: "Rückgängig",
            run: () => setTodoStatusAction(t.id, before),
          },
        },
      );
    });
  };
  const closed = status !== "open";
  // Proposed by the auto-actions review: folded behind "Show actions (n)" — they're suggestions.
  const proposed = t.ops.length > 0 && !closed && !!t.autoOpsWhy;
  const cameFrom = sourcesOf(t.refs, sources);
  // Where a todo without a ticket came from: WhatsApp when its messages are all chats.
  const msgs = cameFrom.filter((s) => s.source === "mail");
  const origin = msgs.length && msgs.every((s) => s.source === "mail" && s.mail.folder === "WhatsApp") ? "WhatsApp" : "Mail";
  const context = useContextItems(cameFrom, [...t.userNotes, ...(t.relatedNotes ?? [])], t.id);
  // An agent on it asks you something and waits.
  const asking = !closed && t.needsInput ? t.needsInput : null;
  // A worker or agent says it's done: highlighted, still open - closing it is yours.
  const reported = !closed && !asking && !!t.workerDone;
  // What Zeff runs on a click — those that open in your browser (a mail draft, an appointment) are links of their own.
  const zeffOps = t.ops.filter((o) => !actionHref(o));
  // New since you last looked: lightly highlighted till the mouse passes over it.
  const [fresh, markSeen] = useTodoNew(t.id, t.createdAt);
  const isFresh = fresh && !closed && !asking && !running && !doing;
  return (
    <li
      id={anchor ? `todo-${t.id}` : undefined}
      className={`group flex scroll-mt-24 items-start gap-2 rounded target:bg-amber-50 dark:target:bg-amber-950/40 ${asking ? "-mx-2 bg-amber-50 px-2 py-1.5 ring-1 ring-amber-300 dark:bg-amber-950/40 dark:ring-amber-800" : reported ? "-mx-2 bg-emerald-50 px-2 py-1.5 ring-1 ring-emerald-300 dark:bg-emerald-950/30 dark:ring-emerald-800" : running || doing ? "-mx-2 bg-indigo-50 px-2 py-1.5 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:ring-indigo-900" : isFresh ? "-mx-2 bg-sky-50/80 px-2 py-1.5 ring-1 ring-sky-100 dark:bg-sky-950/30 dark:ring-sky-900/60" : t.deferred && !closed ? "opacity-60 hover:opacity-100" : ""}`}
      onMouseEnter={fresh ? markSeen : undefined}
      title={asking ? `Der Agent wartet auf dich: ${asking}` : running ? "Wird gerade bearbeitet (Worker oder Agent)" : undefined}
    >
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0 cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
        checked={closed}
        disabled={running || doing}
        title={running || doing ? "Wird gerade bearbeitet — erst wenn der Lauf fertig ist" : undefined}
        onChange={() => set(closed ? "open" : "done")}
        aria-label={`${t.ref} ${closed ? "wieder öffnen" : "erledigt"}`}
      />
      <div className="min-w-0 flex-1 text-sm" data-hover-column>
        <span
          className={
            closed
              ? "text-zinc-400 line-through"
              : t.owner === "other"
                ? "text-zinc-600 italic dark:text-zinc-300"
                : ""
          }
        >
          {asking && (
            <span className="mr-1 font-bold text-amber-600 not-italic dark:text-amber-400" title={`Der Agent wartet auf dich: ${asking}`} aria-label="Wartet auf dich">
              ❗
            </span>
          )}
          {(running || doing) && !closed && !asking && <RunningSpinner title={doing ? "Wird gestartet" : "Wird gerade bearbeitet (Worker oder Agent)"} />}
          {t.owner === "other" && !closed && !(running || doing) && (
            <span className="mr-1 not-italic" title="Wartet auf andere">
              ⏳
            </span>
          )}
          <Linked text={t.text} cards={cards} mrs={t.links?.mrs} />
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-zinc-400">
          <CopyButton text={agentInstruction(t, instructions)} className="font-mono hover:text-indigo-600 hover:underline dark:hover:text-indigo-400" title={`„${agentInstruction(t, instructions)}“ kopieren — für Copilot / Claude Code`}>
            {t.ref}
          </CopyButton>
          {/* Linked to more than one ticket (the same thing on both): all of them, the main one first. */}
          {!t.ticket && <> · <span title={`Aus ${origin === "WhatsApp" ? "WhatsApp" : "einer Mail"} — zu keinem Ticket`}>aus {origin}</span></>}
          {t.ticket && (showTicket || t.alsoTickets.length > 0) && (
            <>
              {" · "}
              <Ticket k={t.ticket} cards={cards} external />
              {t.alsoTickets.map((k) => (
                <span key={k} title="Verknüpftes Ticket — es geht um dasselbe">
                  {" + "}
                  <Ticket k={k} cards={cards} external />
                </span>
              ))}
            </>
          )}
          <TodoMrLinks mrs={t.links?.mrs} />
          {" "}· {TODO_KIND_LABELS[t.kind]}
          <DueBadge todoId={t.id} due={t.due} closed={closed} />
          {t.path && <> · Weg „{t.path}“</>}
          {t.flaggedAt && !closed && <span className="font-medium text-red-600 dark:text-red-400"> · wichtig</span>}
          {reported && t.workerDone && <span className="font-medium text-emerald-700 dark:text-emerald-400" title={`${t.workerDone.by} reports this done${t.workerDone.note ? `: ${t.workerDone.note}` : ""} - tick it off to close it`}> · ✓ {t.workerDone.by.split(" · ")[0]}: erledigt gemeldet</span>}
          {t.deferred && !closed && <span className="text-zinc-400"> · zurückgestellt</span>}
          {t.bubbledUp && !closed && <span className="text-amber-600 dark:text-amber-400" title="Du hattest es nach unten gestellt — es ist wieder oben"> · wieder oben: {t.bubbledUp}</span>}
          {!closed && <TodoQuickButtons todoId={t.id} panel={quick} onToggle={setQuick} canReply={t.owner === "me" && [...t.refs, ...t.mailRefs].some((r) => r.startsWith("mail:") || r.startsWith("teams:"))} aiDisabled={!workOn ? "Work ist nicht installiert (Menü → Plugins)" : running || doing ? "Wird gerade bearbeitet — erst wenn der Lauf fertig ist" : undefined} />}
        </span>
        <TodoQuickPanel todoId={t.id} todoRef={t.ref} panel={closed ? null : quick} onClose={() => setQuick(null)} />
        {t.note ? (
          <span className="block text-xs text-zinc-400">
            <TodoRefs text={t.note} />
          </span>
        ) : (
          t.source &&
          !cameFrom.length && (
            <span className="block text-xs text-zinc-400">
              Quelle: {t.source}
            </span>
          )
        )}
        {asking && (
          <span className="mt-1 block text-xs whitespace-pre-line text-amber-700 dark:text-amber-300">
            <strong>Wartet auf dich:</strong> {asking}
          </span>
        )}
        {t.lastError && !closed && !running && !doing && <LastError text={t.lastError} run={t.lastErrorRun} />}
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
                  <AreaToggle open={showActions} onToggle={() => setShowActions(!showActions)} label={`${showActions ? "Hide" : "Show"} actions (${t.ops.length})`} tone="violet">
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
                          <span>Vorgeschlagen: {t.autoOpsWhy}</span>
                        </p>
                        <ul className="space-y-1">
                          {t.ops.map((op, i) => (
                            <li key={i} className="break-words rounded border border-sky-200 bg-sky-50 px-2 py-1 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100">
                              ⚡ {opLabel(op)}
                            </li>
                          ))}
                        </ul>
                        <p className="text-zinc-500">Klicken: prüfen, anpassen, ausführen</p>
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
                  <AreaToggle open={showKnowledge} onToggle={() => setShowKnowledge(!showKnowledge)} label={`${showKnowledge ? "Hide" : "Show"} knowledge (${knowledge.pages.length + knowledge.entities.length})`} tone="emerald">
                    <BookIcon className="size-3.5" />
                  </AreaToggle>
                );
                return showKnowledge ? (
                  toggle
                ) : (
                  <HoverCard card={<TodoKnowledgePreview k={knowledge} />}>{toggle}</HoverCard>
                );
              })()}
          </span>
        )}
        {showKnowledge && knowledge && (
          <div className="mt-1.5">
            <TodoKnowledgeList k={knowledge} />
          </div>
        )}
        {showContext && context.items.length > 0 && (
          <span className="mt-1.5 block">
            <ContextList items={context.items} todoId={t.id} />
          </span>
        )}
        {t.ops.length > 0 && !closed && (!proposed || showActions) && (
          <span className="mt-1.5 flex flex-col gap-1.5">
            {/* Proposed by the auto-actions review: said so, and why. */}
            {proposed && (
              <span
                className="flex items-start gap-1 text-xs text-violet-700 dark:text-violet-300"
                title="Vom Auto-Aktionen-Schritt vorgeschlagen — prüfen, anpassen (✎), dann ausführen"
              >
                <SparkIcon className="mt-px size-3.5 shrink-0" />
                <span>Vorgeschlagen: {t.autoOpsWhy}</span>
                <ProposeAgain todoId={t.id} />
              </span>
            )}
            <span className="flex items-center gap-2 max-sm:flex-col max-sm:items-start">
              <OpChips
                ops={t.ops}
                className="min-w-0 flex-1 items-stretch"
                todoId={doing || running ? undefined : t.id}
                notes={t.links?.notes}
              />
              {zeffOps.length > 0 && <button
                type="button"
                className="btn btn-sm btn-primary shrink-0"
                disabled={doing || running || !!t.blockedBy}
                title={t.blockedBy ? `Wartet: ${t.blockedBy} — der GitLab-Sync merkt es, sobald es so weit ist` : `Zeff macht es selbst, ohne KI: ${zeffOps.map(opLabel).join(" · ")}`}
                onClick={() =>
                  startDoing(async () => {
                    // Zeff runs them right now (no worker, no Work tab).
                    const r = await runTodoOpsAction(t.id);
                    toast(r?.ok ? `${t.ref}: ${r.message}` : `${t.ref}: ${r?.error ?? "Ging nicht."}`, { tone: r?.ok ? "ok" : "error" });
                  })
                }
              >
                {doing || running ? "läuft…" : opsButton(zeffOps)}
              </button>}
            </span>
            <TodoAlternatives t={t} disabled={doing || running} />
          </span>
        )}
        {/* What comes after it — last, under its actions. */}
        <TodoPlan t={{ planned: t.planned, status }} />
      </div>
      {!closed && <FlagButton todoId={t.id} todoRef={t.ref} flagged={!!t.flaggedAt} />}
      {!closed && (
        <button
          type="button"
          className={`icon-btn ${t.deferred ? "text-indigo-600 opacity-100 dark:text-indigo-400" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
          onClick={() =>
            startDefer(async () => {
              const r = await deferTodoAction(t.id, !t.deferred);
              if (!r?.ok) toast(r?.error ?? "Ging nicht.", { tone: "error" });
            })
          }
          title={t.deferred ? "Wieder nach oben holen" : "Nach unten — vorerst zurückstellen (kommt wieder hoch, wenn sich etwas tut, spätestens in 3 Tagen)"}
          aria-label={t.deferred ? `${t.ref} wieder nach oben` : `${t.ref} nach unten`}
        >
          {t.deferred ? <ToTopIcon /> : <ToBottomIcon />}
        </button>
      )}
      {!closed && (
        <button
          type="button"
          className="icon-btn text-base opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => set("dismissed")}
          title="Verwerfen — gilt nicht"
          aria-label={`${t.ref} verwerfen`}
        >
          ×
        </button>
      )}
    </li>
  );
}

/** "Neu vorschlagen": the auto-actions look at this todo again (what it knows now — a chat's language, a new message) — no Work needed. */
function ProposeAgain({ todoId }: { todoId: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="ml-1 shrink-0 font-medium hover:underline disabled:opacity-50"
      disabled={pending}
      title="Die KI schlägt die Aktionen für dieses Todo neu vor — mit allem, was sie jetzt weiß"
      onClick={() =>
        start(async () => {
          const r = await suggestTodoActionsAction(todoId);
          toast(r?.ok ? (r.message ?? "Erledigt.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
        })
      }
    >
      {pending ? "schlägt vor …" : "↻ Neu vorschlagen"}
    </button>
  );
}
