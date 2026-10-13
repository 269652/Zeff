import { and, desc, gt, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { currentLocale } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import type { TodoEventKind, TodoEventView } from "./activity-shared";

const { todoEvents, todos, workRuns, boardRuns } = schema;

const lastId = () => getDb().select({ m: sql<number>`coalesce(max(${todoEvents.id}), 0)` }).from(todoEvents).get()?.m ?? 0;

/**
 * Who did what happens in `fn` to the todos (the triggers record it, this says who): "you",
 * "agent:<name>"… — where the triggers couldn't tell (a planned step it spawns stays the plan's).
 * Synchronous work only — what fn does, nothing else, is in between.
 */
export function attributed<T>(actor: string, fn: () => T): T {
  const before = lastId();
  try {
    return fn();
  } finally {
    getDb().update(todoEvents).set({ actor }).where(and(gt(todoEvents.id, before), isNull(todoEvents.actor))).run();
  }
}

const DAY = 86400000;

/** The workers' own todos are quiet: what happens to them is no activity and no news. */
const notWorkers = sql`${todoEvents.todoId} not in (select id from todos where by_worker = 1)`;

/** What happened to the todos in the last days, newest first. */
export function todoActivity(opts: { days?: number; limit?: number } = {}): TodoEventView[] {
  const since = new Date(Date.now() - (opts.days ?? 14) * DAY).toISOString();
  const rows = getDb()
    .select()
    .from(todoEvents)
    .where(and(gte(todoEvents.at, since), notWorkers))
    .orderBy(desc(todoEvents.at), desc(todoEvents.id))
    .limit(opts.limit ?? 400)
    .all();
  if (!rows.length) return [];
  const todoIds = [...new Set(rows.map((r) => r.todoId))];
  const openNow = new Set(
    getDb()
      .select({ id: todos.id })
      .from(todos)
      .where(and(inArray(todos.id, todoIds), sql`${todos.status} = 'open'`))
      .all()
      .map((r) => r.id),
  );
  const workIds = [...new Set(rows.map((r) => /^work:(\d+)$/.exec(r.actor ?? "")?.[1]).filter(Boolean).map(Number))];
  const work = new Map(
    workIds.length
      ? getDb()
          .select({ id: workRuns.id, provider: workRuns.provider, model: workRuns.model, mode: workRuns.mode })
          .from(workRuns)
          .where(inArray(workRuns.id, workIds))
          .all()
          .map((r) => [r.id, r])
      : [],
  );
  const lageIds = [...new Set(rows.map((r) => /^lage:(\d+)$/.exec(r.actor ?? "")?.[1]).filter(Boolean).map(Number))];
  const lage = new Map(
    lageIds.length
      ? getDb()
          .select({ id: boardRuns.id, startedAt: boardRuns.startedAt })
          .from(boardRuns)
          .where(inArray(boardRuns.id, lageIds))
          .all()
          .map((r) => [r.id, r.startedAt])
      : [],
  );
  const by = (actor: string | null): TodoEventView["by"] => {
    if (!actor) return { label: t("unknown"), title: t("Not attributed by Zeff (before the activity log, or a path without a sender)") };
    if (actor === "you") return { label: t("You") };
    if (actor === "jira") return { label: t("Jira sync"), title: t("The ticket is done in Jira") };
    if (actor === "merge") return { label: t("Duplicate sweep"), title: t("Duplicates among the open todos, merged into the oldest") };
    if (actor === "plan") return { label: t("Plan"), title: t("A planned step (after the todo before it, or another path was taken)") };
    const agent = /^agent:(.*)$/.exec(actor);
    if (agent) return { label: agent[1]?.trim() ? t("Agent {name}", { name: agent[1].trim() }) : t("Agent"), title: t("Through Zeff's MCP server") };
    const w = /^work:(\d+)$/.exec(actor);
    if (w) {
      const r = work.get(Number(w[1]));
      const who = r ? (r.provider === "agent" ? (r.model ?? t("Agent")) : r.provider === "zeff" ? t("Zeff (action)") : `${t("Worker")}${r.model ? ` · ${r.model}` : ""}`) : t("Worker");
      return { label: `W-${w[1]} · ${who}`, href: `/work?run=${w[1]}`, title: t("The run on the Work tab") };
    }
    const l = /^lage:(\d+)$/.exec(actor);
    if (l) {
      const started = lage.get(Number(l[1]));
      const when = started ? new Date(`${started.replace(" ", "T")}${started.includes("T") ? "" : "Z"}`).toLocaleString(currentLocale(), { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
      return { label: when ? t("Briefing ({when})", { when }) : t("Briefing"), href: "/todos", title: t("Briefing run #{n}", { n: l[1] }) };
    }
    return { label: actor };
  };
  return rows.map((r) => ({
    id: r.id,
    todoId: r.todoId,
    event: r.event as TodoEventKind,
    ticket: r.ticket,
    text: r.text,
    note: r.note,
    by: by(r.actor),
    mine: r.actor === "you",
    openNow: openNow.has(r.todoId),
    at: r.at,
  }));
}

/** The recent events that are news (not your own clicks): their ids, for the unseen badge. */
export function activityNewsIds(days = 14): number[] {
  const since = new Date(Date.now() - days * DAY).toISOString();
  return getDb()
    .select({ id: todoEvents.id })
    .from(todoEvents)
    .where(and(gte(todoEvents.at, since), notWorkers, or(isNull(todoEvents.actor), ne(todoEvents.actor, "you"))))
    .orderBy(desc(todoEvents.id))
    .limit(300)
    .all()
    .map((r) => r.id);
}

