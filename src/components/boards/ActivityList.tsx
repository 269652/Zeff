"use client";

import { EmptyState } from "@/components/EmptyState";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { todoEventLabels, type TodoEventView } from "@/lib/boards/activity-shared";
import { todoRef } from "@/lib/boards/shared";
import { useRouter } from "next/navigation";
import { toast } from "@/components/Toaster";
import { undoLageRunAction } from "@/plugins/todos/server-actions";
import { markActivitySeen, readActivitySeen } from "./ActivitySeen";
import { TodoRefs } from "./TodoRefs";
import { formatLongDay, formatTime } from "@/lib/format";
import { useT } from "@/components/I18nProvider";
import { rich } from "@/lib/i18n/rich";
import type { T } from "@/lib/i18n/shared";

// What was seen when the tab opened — what came after stays marked new while you look.
let atOpen: number | null | undefined;
const seenAtOpen = () => (atOpen === undefined ? (atOpen = readActivitySeen()) : atOpen);
const noSubscribe = () => () => {};

const FILTERS = ["all", "closed", "created"] as const;
type Filter = (typeof FILTERS)[number];
const filterLabels = (t: T): Record<Filter, string> => ({ all: t("All"), closed: t("Closed"), created: t("New") });

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE");
function dayLabel(key: string, t: T): string {
  const today = new Date().toLocaleDateString("sv-SE");
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("sv-SE");
  if (key === today) return t("Today");
  if (key === yesterday) return t("Yesterday");
  return formatLongDay(key);
}

/**
 * What happened to the todos, newest first, by day: each one made, done, dropped or opened
 * again — by whom (the Ticket-Lage, a worker, an agent, Jira, you) and why. What's new since you
 * last looked is marked.
 */
export function ActivityList({ events }: { events: TodoEventView[] }) {
  const t = useT();
  const eventLabels = todoEventLabels(t);
  const labels = filterLabels(t);
  const seen = useSyncExternalStore(noSubscribe, seenAtOpen, () => null);
  const [filter, setFilter] = useState<Filter>("all");
  const max = events.length ? Math.max(...events.map((e) => e.id)) : 0;
  useEffect(() => {
    if (max) markActivitySeen(max);
  }, [max]);
  useEffect(
    () => () => {
      atOpen = undefined;
    },
    [],
  );

  const shown = events.filter((e) => (filter === "closed" ? e.event === "done" || e.event === "dismissed" : filter === "created" ? e.event === "created" : true));
  const days: [string, TodoEventView[]][] = [];
  for (const e of shown) {
    const k = dayKey(e.at);
    const last = days[days.length - 1];
    if (last?.[0] === k) last[1].push(e);
    else days.push([k, [e]]);
  }
  const unseen = seen === null ? 0 : events.filter((e) => e.id > seen && !e.mine).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={`rounded-full border px-2.5 py-0.5 ${filter === key ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}
          >
            {labels[key]}
          </button>
        ))}
        {unseen > 0 && <span className="ml-1 text-amber-700 dark:text-amber-300">{t("{n} new since you last looked", { n: unseen })}</span>}
      </div>
      {days.length === 0 && <EmptyState>{t("Nothing in the last two weeks.")}</EmptyState>}
      {days.map(([k, list]) => (
        <section key={k} className="space-y-1">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase">{dayLabel(k, t)}</h3>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {list.map((e) => {
              const L = eventLabels[e.event];
              const isNew = seen !== null && e.id > seen && !e.mine;
              return (
                <li key={e.id} className={`flex items-start gap-2 py-1.5 text-sm ${isNew ? "-mx-2 rounded bg-amber-50 px-2 dark:bg-amber-950/30" : ""}`}>
                  <span className="w-11 shrink-0 pt-px font-mono text-xs text-zinc-400 tabular-nums">
                    {formatTime(e.at)}
                  </span>
                  <span className={`w-24 shrink-0 text-xs font-semibold ${L.tone}`}>
                    {L.icon} {L.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      {isNew && <span className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-amber-500" aria-label={t("new")} />}
                      <span className={`min-w-0 ${e.event === "done" || e.event === "dismissed" ? "text-zinc-600 dark:text-zinc-300" : ""}`}>
                        <TodoRefs text={e.text} />
                      </span>
                    </div>
                    <div className="text-xs text-zinc-400">
                      <Link href={`/todos${e.openNow ? "" : "?todos=done"}#todo-${e.todoId}`} className="font-mono hover:text-indigo-600 hover:underline dark:hover:text-indigo-400">
                        {todoRef(e.todoId)}
                      </Link>
                      {" · "}
                      {e.ticket}
                      {" · "}
                      {rich(t("by <who>{name}</who>", { name: e.by.label }), {
                        who: (s) =>
                          e.by.href ? (
                            <Link href={e.by.href} title={e.by.title} className="text-zinc-500 hover:underline dark:text-zinc-300">
                              {s}
                            </Link>
                          ) : (
                            <span title={e.by.title} className="text-zinc-500 dark:text-zinc-300">
                              {s}
                            </span>
                          ),
                      })}
                      {e.event !== "created" && e.openNow && e.event !== "reopened" && e.event !== "merged" && <> · {t("reopened")}</>}
                      {/* A todo a Lage run made: that run taken back — its todos you haven't touched (run-undo.ts). */}
                      {e.event === "created" && e.by.run && <UndoRun run={e.by.run} />}
                    </div>
                    {e.note && <div className="mt-0.5 text-xs whitespace-pre-line text-zinc-500 dark:text-zinc-400"><TodoRefs text={e.event === "created" ? t("Source: {note}", { note: e.note }) : e.event === "merged" ? t("Merged duplicate, from: {note}", { note: e.note }) : e.note} /></div>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** "Take back this run": the Lage run's todos you haven't touched dismissed (asked first). */
function UndoRun({ run }: { run: number }) {
  const t = useT();
  const router = useRouter();
  return (
    <>
      {" · "}
      <button
        type="button"
        className="text-zinc-500 hover:text-red-600 hover:underline dark:text-zinc-400"
        title={t("Dismiss the todos this run made that you haven't touched — those you worked on stay")}
        onClick={async () => {
          if (!window.confirm(t("Take back run #{run}? Its todos you haven't touched are dismissed.", { run }))) return;
          const r = await undoLageRunAction(run);
          if (!r.ok) return void toast(r.error, { tone: "error" });
          toast(`${t("{n} todos of the run dismissed, {kept} kept (you worked on them).", { n: r.dismissed, kept: r.kept })}${r.claims ? ` ${t("{n} promises and facts it read removed.", { n: r.claims })}` : ""}`, { tone: "ok" });
          router.refresh();
        }}
      >
        {t("take back the run")}
      </button>
    </>
  );
}
