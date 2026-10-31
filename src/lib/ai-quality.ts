import { getSqlite } from "@/db";
import { listTodos } from "@/lib/todos/store";
import { duplicateTodo } from "@/lib/todos/similar";
import type { TodoView } from "@/lib/todos/shared";
import { pushTo } from "@/lib/collections";
import { t } from "@/lib/i18n/server";

/**
 * How well the AI steps did: per step that makes todos (the Ticket-Lage, the review of mails and
 * chats, of notes …), what became of its todos — done, dropped by you, taken back by the AI itself,
 * still open — read from the todos' history (todo_events: who made one, who closed it). What you
 * drop is the signal: a todo you didn't want. And: todos proposed again after you dropped one like it.
 */

export type Origin = "lage" | "mail" | "notes" | "work" | "plan" | "agent" | "you" | "unknown";

/** Each origin's name, in the account's language (asked at each call). */
export const originLabels = (): Record<Origin, string> => ({
  lage: t("Briefing"),
  mail: t("Mail & chat review"),
  notes: t("Note review"),
  work: t("Workers (follow-up steps)"),
  plan: t("Planned steps"),
  agent: t("Agents (MCP)"),
  you: t("By you"),
  unknown: t("Unknown"),
});

/** The steps whose todos the AI proposes by itself (the others come from you, or follow from a todo you did). */
export const AI_ORIGINS: Origin[] = ["lage", "mail", "notes", "work"];

/** Where a todo came from: its source (the reviews name themselves), else who made it. */
export function originOf(source: string | null, actor: string | null): Origin {
  if (source === "Mail-Durchsicht") return "mail";
  if (source === "Notiz-Durchsicht") return "notes";
  if (!actor) return "unknown";
  if (actor === "you") return "you";
  if (actor === "plan") return "plan";
  if (actor === "mail") return "mail";
  if (actor === "keep") return "notes";
  if (actor.startsWith("lage:")) return "lage";
  if (actor.startsWith("work:")) return "work";
  if (actor.startsWith("agent:")) return "agent";
  return "unknown";
}

export type QualityRow = {
  origin: Origin | "auto-actions";
  label: string;
  created: number;
  done: number;
  /** Dropped by you: a todo you didn't want. */
  dismissedByYou: number;
  /** Taken back by the AI itself (overtaken, says the next run) or another way taken. */
  withdrawn: number;
  /** Closed and then opened again by you: closed wrongly. */
  reopenedByYou: number;
  open: number;
  /** Open and untouched for STALE_DAYS or more. */
  stale: number;
  /** done / (done + dropped by you) — null below a handful. */
  hitRate: number | null;
  /** Median days from made to done. */
  medianDaysToDone: number | null;
};

export type Repeat = { id: number; ref: string; text: string; createdAt: string; like: { id: number; ref: string; text: string; droppedAt: string } };

export type AiQuality = { since: string | null; rows: QualityRow[]; repeats: Repeat[] };

export const STALE_DAYS = 14;
const MIN_FOR_RATE = 3;

type Row = { id: number; source: string | null; status: string; created_at: string; updated_at: string; done_at: string | null; auto_ops_why: string | null; made_by: string | null; closed_by: string | null; reopened: number };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const iso = (s: string) => (/^\d{4}-\d{2}-\d{2} /.test(s) ? `${s.replace(" ", "T")}Z` : s);

/** The quality of the todo-making steps, over the todos made in the last `days` (null: all). */
export function aiQuality(days: number | null, now = Date.now()): AiQuality {
  const since = days === null ? null : new Date(now - days * 864e5).toISOString();
  const rows = getSqlite()
    .prepare(
      `select t.id, t.source, t.status, t.created_at, t.updated_at, t.done_at, t.auto_ops_why,
         (select e.actor from todo_events e where e.todo_id = t.id and e.event = 'created' order by e.id limit 1) as made_by,
         (select e.actor from todo_events e where e.todo_id = t.id and e.event in ('done', 'dismissed') order by e.id desc limit 1) as closed_by,
         (select count(*) from todo_events e where e.todo_id = t.id and e.event = 'reopened' and e.actor = 'you') as reopened
       from todos t`,
    )
    .all() as Row[];
  const inWindow = rows.filter((r) => !since || iso(r.created_at) >= since);

  const tally = (origin: QualityRow["origin"], label: string, list: Row[]): QualityRow => {
    const done = list.filter((r) => r.status === "done");
    const dismissed = list.filter((r) => r.status === "dismissed");
    const dismissedByYou = dismissed.filter((r) => r.closed_by === "you").length;
    const open = list.filter((r) => r.status === "open");
    const days = done.filter((r) => r.done_at).map((r) => (Date.parse(iso(r.done_at!)) - Date.parse(iso(r.created_at))) / 864e5);
    const judged = done.length + dismissedByYou;
    return {
      origin,
      label,
      created: list.length,
      done: done.length,
      dismissedByYou,
      withdrawn: dismissed.length - dismissedByYou,
      reopenedByYou: list.filter((r) => r.reopened > 0).length,
      open: open.length,
      stale: open.filter((r) => now - Date.parse(iso(r.updated_at)) >= STALE_DAYS * 864e5).length,
      hitRate: judged >= MIN_FOR_RATE ? done.length / judged : null,
      medianDaysToDone: median(days.filter((d) => d >= 0)),
    };
  };

  const byOrigin = new Map<Origin, Row[]>();
  for (const r of inWindow) {
    const o = originOf(r.source, r.made_by);
    pushTo(byOrigin, o, r);
  }
  const order: Origin[] = ["lage", "mail", "notes", "work", "plan", "agent", "you", "unknown"];
  const labels = originLabels();
  const out = order.filter((o) => byOrigin.has(o)).map((o) => tally(o, labels[o], byOrigin.get(o)!));
  // Auto-Aktionen: the todos it put ready-made actions on (whoever made the todo).
  const auto = inWindow.filter((r) => r.auto_ops_why);
  if (auto.length) out.push(tally("auto-actions", t("Auto actions (todos with ready-made actions)"), auto));

  return { since, rows: out, repeats: repeats(rows, since) };
}

/**
 * Todos an AI step proposed again: made after you dropped one like it (the same words, the same
 * message to the same person — as the steps tell duplicates apart).
 */
function repeats(rows: Row[], since: string | null): Repeat[] {
  const dropped = rows.filter((r) => r.status === "dismissed" && r.closed_by === "you" && r.done_at);
  if (!dropped.length) return [];
  const all = new Map(listTodos({ status: "all" }).map((todo) => [todo.id, todo]));
  const out: Repeat[] = [];
  for (const r of rows) {
    if (since && iso(r.created_at) < since) continue;
    if (!AI_ORIGINS.includes(originOf(r.source, r.made_by))) continue;
    const todo = all.get(r.id);
    if (!todo) continue;
    const before: TodoView[] = dropped
      .filter((d) => d.id !== r.id && iso(d.done_at!) <= iso(r.created_at))
      .map((d) => all.get(d.id))
      .filter((d): d is TodoView => !!d);
    const like = duplicateTodo({ text: todo.text, ops: todo.ops }, before);
    if (like) out.push({ id: todo.id, ref: todo.ref, text: todo.text, createdAt: iso(r.created_at), like: { id: like.id, ref: like.ref, text: like.text, droppedAt: like.doneAt ?? "" } });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
