/**
 * Learn's data moved from its own tables (learn_courses, learn_nodes, learn_events, learn_widgets, learn_cards) into its
 * Workspace databases (dbs.ts) — once per account, at the server's start (instrumentation) or when Learn is first used, after a
 * copy of the account's database next to it (zeff-before-learn-move.db). Every course with everything it has: the plan's
 * nodes with your progress (mastered, begun, xp, the lesson's todo), what you earned (each event, as it was — the course's
 * xp, streak and badges are copied, never recomputed), the teacher's widgets with their best score, your cards with where
 * they stand (reps, ease, interval, due) — and the lessons' past conversations from their runs' logs. Each course moves in
 * one transaction (all of it or nothing: interrupted, it moves at the next try — never twice: learn_moved); the old tables
 * stay as they are (a fallback). Done: the pref learn.movedToWorkspace. Server only.
 */
import fs from "node:fs";
import path from "node:path";
import { getSqlite } from "@/db";
import { accountDir, currentAccountId } from "@/db/accounts";
import { getPref, setPref } from "@/lib/prefs";
import { addRow, setCell, updatePage } from "@/plugins/workspace/store";
import { copiesOf } from "@/plugins/workspace/links";
import { learnDbs, P, setMover } from "./dbs";
import { htmlDoc, timeCell } from "./store";
import { syncLesson } from "./conversation";

export const MOVED_FLAG = "learn.movedToWorkspace";
export const BACKUP_NAME = "zeff-before-learn-move.db";

type R = Record<string, unknown>;
const hasTable = (name: string) => !!getSqlite().prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name);
const json = <T>(s: unknown, fallback: T): T => {
  try {
    return typeof s === "string" && s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const n = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const filled = (cells: R) => Object.fromEntries(Object.entries(cells).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)));

function moved() {
  const d = getSqlite();
  d.exec("create table if not exists learn_moved (kind text not null, old_id integer not null, row_id integer not null, primary key (kind, old_id))");
  return d;
}
const movedRow = (kind: string, oldId: number): number | null => (moved().prepare("select row_id from learn_moved where kind = ? and old_id = ?").get(kind, oldId) as { row_id: number } | undefined)?.row_id ?? null;
const keep = (kind: string, oldId: number, rowId: number) => moved().prepare("insert or replace into learn_moved (kind, old_id, row_id) values (?, ?, ?)").run(kind, oldId, rowId);

/** The old tables' courses not moved yet. */
function waiting(): R[] {
  if (!hasTable("learn_courses")) return [];
  return (getSqlite().prepare("select * from learn_courses order by id").all() as R[]).filter((c) => movedRow("course", Number(c.id)) === null);
}

/** When each row was made (and the course last changed) — else everything would look made just now. */
function times(id: number, created: unknown, updated?: unknown) {
  const ok = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
  if (!ok(created) && !ok(updated)) return;
  getSqlite().prepare("update ws_pages set created_at = coalesce(?, created_at), updated_at = coalesce(?, updated_at) where id = ?").run(ok(created) ? created : null, ok(updated) ? updated : ok(created) ? created : null, id);
}

/**
 * One course moved with everything it has — in one transaction. Its row's id. (`interrupt`: for the tests — called half-way,
 * it throws like a crash would.)
 */
export function moveCourseToWorkspace(oldId: number, opts: { interrupt?: () => void } = {}): number {
  const d = getSqlite();
  moving++;
  try {
    return moveCourse(d, oldId, opts);
  } finally {
    moving--;
  }
}

/** Moving now (the databases' first use doesn't start another move meanwhile). */
let moving = 0;

function moveCourse(d: ReturnType<typeof getSqlite>, oldId: number, opts: { interrupt?: () => void }): number {
  // What the Workspace makes the first time it's needed — made before the transaction: a rolled-back first time would leave
  // the Workspace thinking its tables were there (links.ts keeps that in memory).
  learnDbs();
  copiesOf(0);
  moved();
  return d.transaction(() => {
    const done = movedRow("course", oldId);
    if (done !== null) return done;
    const c = d.prepare("select * from learn_courses where id = ?").get(oldId) as R | undefined;
    if (!c) throw new Error(`No course ${oldId} in the old tables.`);
    const dbs = learnDbs();
    const all = (table: string, order = "id") => (hasTable(table) ? (d.prepare(`select * from ${table} where course_id = ? order by ${order}`).all(oldId) as R[]) : []);

    // The course: as it was, xp, streak and badges copied (not worked out again).
    const courseId = addRow(dbs.courses, {
      title: str(c.title) || str(c.topic),
      cells: filled({
        [P.topic]: str(c.topic),
        [P.goal]: str(c.goal),
        [P.level]: str(c.level),
        [P.status]: str(c.status) || "ready",
        [P.summary]: str(c.summary),
        [P.years]: n(c.years),
        [P.sources]: str(c.sources) && c.sources !== "[]" ? str(c.sources) : "",
        [P.problems]: str(c.problems) && c.problems !== "[]" ? str(c.problems) : "",
        [P.error]: str(c.error),
        [P.interests]: str(c.interests) && c.interests !== "{}" ? str(c.interests) : "",
        [P.dailyGoal]: n(c.daily_goal) ?? 50,
        [P.xp]: n(c.xp) ?? 0,
        [P.streak]: n(c.streak) ?? 0,
        [P.lastDay]: str(c.last_day).slice(0, 10),
        [P.today]: str(c.today).slice(0, 10),
        [P.todayXp]: n(c.today_xp) ?? 0,
        [P.badges]: json<string[]>(c.badges, []),
        [P.slots]: str(c.slots) && c.slots !== "[]" ? str(c.slots) : "",
        [P.reviewTodo]: n(c.review_todo_id) ? [n(c.review_todo_id)] : null,
        [P.legacy]: oldId,
      }),
    });
    keep("course", oldId, courseId);

    // The plan's nodes, with your progress; then what links them.
    const nodes = all("learn_nodes", "ord, id");
    const stepOf = new Map<string, number>();
    for (const x of nodes) {
      const key = str(x.key);
      const rowId = addRow(dbs.steps, {
        title: str(x.title),
        cells: filled({
          [P.course]: [courseId],
          [P.key]: key,
          [P.kind]: str(x.kind),
          [P.summary]: str(x.summary),
          [P.objectives]: json<string[]>(x.objectives, []).join("\n"),
          [P.path]: str(x.path),
          [P.xp]: n(x.xp) ?? 0,
          [P.minutes]: n(x.minutes),
          [P.sourceIds]: json<string[]>(x.sources, []).join(", "),
          [P.order]: n(x.ord) ?? 0,
          [P.mastered]: x.mastered_at ? true : null,
          [P.masteredAt]: timeCell(str(x.mastered_at) || null),
          [P.activeSince]: timeCell(str(x.active_since) || null),
          [P.lessonTodo]: n(x.lesson_todo_id) ? [n(x.lesson_todo_id)] : null,
        }),
      });
      if (!stepOf.has(key)) stepOf.set(key, rowId);
      keep("node", Number(x.id), rowId);
    }
    for (const x of nodes) {
      const rowId = stepOf.get(str(x.key))!;
      const parent = x.parent_key ? stepOf.get(str(x.parent_key)) : undefined;
      const requires = json<string[]>(x.requires, []).map((k) => stepOf.get(k)).filter((v): v is number => !!v);
      if (parent) setCell(rowId, P.parent, [parent], { quiet: true });
      if (requires.length) setCell(rowId, P.requires, requires, { quiet: true });
    }

    opts.interrupt?.();

    // The teacher's widgets: their HTML on their pages, their best score and the xp they gave.
    const widgetOf = new Map<number, number>();
    for (const w of all("learn_widgets")) {
      const step = stepOf.get(str(w.node_key));
      const rowId = addRow(dbs.exercises, {
        title: str(w.title) || "Widget",
        cells: filled({ [P.course]: [courseId], [P.step]: step ? [step] : null, [P.libs]: json<string[]>(w.libs, []), [P.best]: n(w.best_score), [P.xp]: n(w.xp) ?? 0, [P.run]: n(w.run_id), [P.legacy]: Number(w.id) }),
      });
      updatePage(rowId, { content: htmlDoc(str(w.html)) });
      times(rowId, w.created_at);
      widgetOf.set(Number(w.id), rowId);
      keep("widget", Number(w.id), rowId);
    }

    // Your cards, where they stand.
    const cardOf = new Map<number, number>();
    for (const x of all("learn_cards")) {
      const step = stepOf.get(str(x.node_key));
      const front = str(x.front);
      const rowId = addRow(dbs.cards, {
        title: front.slice(0, 300),
        cells: filled({
          [P.front]: front.length > 300 ? front : "",
          [P.back]: str(x.back),
          [P.reps]: n(x.reps) ?? 0,
          [P.lapses]: n(x.lapses) ?? 0,
          [P.ease]: n(x.ease) ?? 2.5,
          [P.interval]: n(x.interval) ?? 0,
          [P.due]: timeCell(str(x.due) || null),
          [P.last]: timeCell(str(x.last) || null),
          [P.course]: [courseId],
          [P.step]: step ? [step] : null,
          [P.legacy]: Number(x.id),
        }),
      });
      times(rowId, x.created_at);
      cardOf.set(Number(x.id), rowId);
      keep("card", Number(x.id), rowId);
    }

    // What you earned, each event as it was (its widget and card by their rows now).
    const widgetTitle = new Map(all("learn_widgets").map((w) => [Number(w.id), str(w.title)]));
    const nodeTitle = new Map(nodes.map((x) => [str(x.key), str(x.title)]));
    for (const e of all("learn_events")) {
      const detail = json<R>(e.detail, {});
      const kind = str(e.kind);
      const oldWidget = kind === "widget" && detail.widget !== undefined ? Number(detail.widget) : null;
      const oldCard = kind === "review" && detail.card !== undefined ? Number(detail.card) : null;
      const widget = oldWidget !== null ? (widgetOf.get(oldWidget) ?? null) : null;
      const card = oldCard !== null ? (cardOf.get(oldCard) ?? null) : null;
      if (widget) detail.widget = widget;
      if (card) detail.card = card;
      const key = e.node_key ? str(e.node_key) : "";
      const step = key ? stepOf.get(key) : undefined;
      const title =
        kind === "mastered" ? `✓ ${nodeTitle.get(key) ?? key}` : kind === "widget" ? `${(oldWidget !== null && widgetTitle.get(oldWidget)) || "Widget"} — ${Math.round(Number(detail.score ?? 0) * 100)} %` : kind === "review" ? "↻" : kind;
      const s = JSON.stringify(detail);
      const rowId = addRow(dbs.activity, {
        title: str(title).slice(0, 200),
        cells: filled({
          [P.event]: kind,
          [P.at]: timeCell(str(e.at) || null),
          [P.xp]: n(e.xp) ?? 0,
          [P.course]: [courseId],
          [P.step]: step ? [step] : null,
          [P.stepKey]: key,
          [P.exercise]: widget ? [widget] : null,
          [P.card]: card ? [card] : null,
          [P.score]: typeof detail.score === "number" ? detail.score : null,
          [P.snapshot]: n(detail.snapshot),
          [P.detail]: s.length <= 19500 ? s : JSON.stringify({ ...detail, answers: undefined }),
        }),
      });
      times(rowId, e.at);
      keep("event", Number(e.id), rowId);
    }

    // The lessons' conversations, from their runs' logs (what each run said, one row per message).
    for (const x of nodes) if (n(x.lesson_todo_id)) syncLesson(n(x.lesson_todo_id)!, { spread: true });

    // When the course was made and last changed (its place among the courses).
    times(courseId, c.created_at, c.updated_at);
    return courseId;
  })();
}

/** A copy of the account's database next to it (the first one is kept: it is from before anything moved). */
function backup(): string {
  const file = path.join(accountDir(currentAccountId()), BACKUP_NAME);
  if (!fs.existsSync(file)) getSqlite().exec(`vacuum into '${file.replace(/'/g, "''")}'`);
  return file;
}

/**
 * Every course of the old tables not moved yet moves (after the backup) — null: nothing (left) to move. A course that fails
 * is logged and left for the next try (its part rolled back); the pref is set only when all are moved.
 */
export function moveLearnOnce(): { moved: number; failed: number; backup: string } | null {
  if (getPref<boolean>(MOVED_FLAG, false)) return null;
  const courses = waiting();
  if (!courses.length) {
    setPref(MOVED_FLAG, true);
    return null;
  }
  const file = backup();
  let failed = 0;
  moving++;
  try {
    for (const c of courses) {
      try {
        moveCourseToWorkspace(Number(c.id));
      } catch (e) {
        failed++;
        console.error(`[learn] moving course ${String(c.id)} “${str(c.title) || str(c.topic)}” into the Workspace failed`, e);
      }
    }
  } finally {
    moving--;
  }
  if (!failed) setPref(MOVED_FLAG, true);
  return { moved: courses.length - failed, failed, backup: file };
}

// (Learn used before the server's start moved it — the plugin installed later: moved when Learn is first used.)
setMover(() => {
  if (moving || getPref<boolean>(MOVED_FLAG, false) || getSqlite().inTransaction) return;
  try {
    moveLearnOnce();
  } catch (e) {
    console.error("[learn] moving Learn's data into the Workspace failed", e);
  }
});
