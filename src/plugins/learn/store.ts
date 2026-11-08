/**
 * The learning platform's data (the Learn plugin), in the account's database: courses, the nodes of their plan, what
 * you earned (events), the teacher's widgets and your cards. Tables made on first use, as the plugins do. Server only.
 */
import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { localDay } from "@/lib/dates";
import { checkWidgetHtml, xpForResult, WIDGET_LIBS, type WidgetMessage } from "@/lib/widgets/sandbox";
import { badgesFor, nextStreak, type BadgeId } from "./game";
import { normalizePlan } from "./plan";
import { review, newCard, type Grade } from "./srs";
import { computeTree, layers, nextSteps, type Tree, type TreeInput, type TreeNode } from "./tree";
import type { NodeKind, PlanSource } from "./shared";

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists learn_courses (id integer primary key autoincrement, topic text not null, goal text not null default '', level text not null default '', status text not null default 'researching', title text not null default '', summary text not null default '', years real not null default 0, sources text not null default '[]', problems text not null default '[]', error text, interests text not null default '{}', daily_goal integer not null default 50, xp integer not null default 0, streak integer not null default 0, last_day text, today text, today_xp integer not null default 0, badges text not null default '[]', created_at text not null, updated_at text not null);
    create table if not exists learn_nodes (id integer primary key autoincrement, course_id integer not null references learn_courses(id) on delete cascade, key text not null, kind text not null, parent_key text, title text not null, summary text not null default '', objectives text not null default '[]', requires text not null default '[]', path text, xp integer not null default 0, minutes integer, sources text not null default '[]', ord integer not null default 0, mastered_at text, active_since text, lesson_todo_id integer, unique (course_id, key));
    create table if not exists learn_events (id integer primary key autoincrement, course_id integer not null references learn_courses(id) on delete cascade, node_key text, kind text not null, xp integer not null default 0, detail text not null default '{}', at text not null);
    create index if not exists learn_events_course on learn_events (course_id, at);
    create table if not exists learn_widgets (id integer primary key autoincrement, course_id integer not null references learn_courses(id) on delete cascade, node_key text, run_id integer, title text not null, html text not null, libs text not null default '[]', best_score real, xp integer not null default 0, created_at text not null);
    create index if not exists learn_widgets_node on learn_widgets (course_id, node_key);
    create table if not exists learn_cards (id integer primary key autoincrement, course_id integer not null references learn_courses(id) on delete cascade, node_key text, front text not null, back text not null, reps integer not null default 0, lapses integer not null default 0, ease real not null default 2.5, interval integer not null default 0, due text not null, last text, created_at text not null);
    create index if not exists learn_cards_due on learn_cards (course_id, due);
  `);
  // Added later: a course's study times (schedule.ts) and the todo its reviews due are in.
  const cols = (d.prepare("pragma table_info(learn_courses)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("slots")) d.exec("alter table learn_courses add column slots text not null default '[]'");
  if (!cols.includes("review_todo_id")) d.exec("alter table learn_courses add column review_todo_id integer");
  return d;
}

const nowIso = () => new Date().toISOString();
const changed = () => emitChange("learn");
const json = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------------------------------------------------

export type CourseStatus = "researching" | "ready" | "failed";
import type { StudySlot } from "./schedule-shared";
export type { StudySlot };
export type Course = {
  id: number;
  topic: string;
  goal: string;
  level: string;
  status: CourseStatus;
  title: string;
  summary: string;
  years: number;
  sources: PlanSource[];
  problems: string[];
  error: string | null;
  interests: Record<string, number>;
  dailyGoal: number;
  xp: number;
  streak: number;
  lastDay: string | null;
  today: string | null;
  todayXp: number;
  badges: BadgeId[];
  slots: StudySlot[];
  reviewTodoId: number | null;
  createdAt: string;
};
type CourseRow = Record<string, unknown> & { id: number };

const toCourse = (r: CourseRow): Course => ({
  id: r.id,
  topic: String(r.topic),
  goal: String(r.goal ?? ""),
  level: String(r.level ?? ""),
  status: r.status as CourseStatus,
  title: String(r.title ?? "") || String(r.topic),
  summary: String(r.summary ?? ""),
  years: Number(r.years ?? 0),
  sources: json<PlanSource[]>(r.sources as string, []),
  problems: json<string[]>(r.problems as string, []),
  error: (r.error as string | null) ?? null,
  interests: json<Record<string, number>>(r.interests as string, {}),
  dailyGoal: Number(r.daily_goal ?? 50),
  xp: Number(r.xp ?? 0),
  streak: Number(r.streak ?? 0),
  lastDay: (r.last_day as string | null) ?? null,
  today: (r.today as string | null) ?? null,
  todayXp: Number(r.today_xp ?? 0),
  badges: json<BadgeId[]>(r.badges as string, []),
  slots: json<StudySlot[]>(r.slots as string, []),
  reviewTodoId: (r.review_todo_id as number | null) ?? null,
  createdAt: String(r.created_at),
});

export function createCourse(v: { topic: string; goal: string; level: string }): number {
  const topic = v.topic.trim().slice(0, 200);
  if (!topic) throw new Error("What do you want to learn?");
  const t = nowIso();
  const r = db()
    .prepare("insert into learn_courses (topic, goal, level, status, created_at, updated_at) values (?, ?, ?, 'researching', ?, ?)")
    .run(topic, v.goal.trim().slice(0, 1000), v.level.trim().slice(0, 300), t, t);
  changed();
  return Number(r.lastInsertRowid);
}

export function getCourse(id: number): Course | undefined {
  const r = db().prepare("select * from learn_courses where id = ?").get(id) as CourseRow | undefined;
  return r ? toCourse(r) : undefined;
}

export const listCourses = (): Course[] => (db().prepare("select * from learn_courses order by updated_at desc").all() as CourseRow[]).map(toCourse);

export function deleteCourse(id: number): void {
  const d = db();
  // (Each table by hand: the account's database may run without foreign keys.)
  for (const t of ["learn_cards", "learn_widgets", "learn_events", "learn_nodes"]) d.prepare(`delete from ${t} where course_id = ?`).run(id);
  d.prepare("delete from learn_courses where id = ?").run(id);
  changed();
}

/** The research's plan into the course (checked and repaired: plan.ts) — its nodes replace any before. */
export function savePlan(id: number, raw: unknown): { problems: string[] } {
  const { plan, problems } = normalizePlan(raw);
  if (!plan.nodes.length) {
    failResearch(id, problems[0] ?? "The plan has no steps.");
    return { problems };
  }
  const d = db();
  d.transaction(() => {
    d.prepare("delete from learn_nodes where course_id = ?").run(id);
    const ins = d.prepare(
      "insert into learn_nodes (course_id, key, kind, parent_key, title, summary, objectives, requires, path, xp, minutes, sources, ord) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    plan.nodes.forEach((n, i) =>
      ins.run(id, n.key, n.kind, n.parent, n.title, n.summary ?? "", JSON.stringify(n.objectives ?? []), JSON.stringify(n.requires ?? []), n.path ?? null, n.xp ?? 0, n.minutes ?? null, JSON.stringify(n.sources ?? []), i),
    );
    d.prepare("update learn_courses set status = 'ready', title = ?, summary = ?, years = ?, sources = ?, problems = ?, error = null, updated_at = ? where id = ?").run(
      plan.title,
      plan.summary,
      plan.years,
      JSON.stringify(plan.sources),
      JSON.stringify(problems),
      nowIso(),
      id,
    );
  })();
  changed();
  return { problems };
}

export function failResearch(id: number, error: string): void {
  db().prepare("update learn_courses set status = 'failed', error = ?, updated_at = ? where id = ?").run(error.slice(0, 2000), nowIso(), id);
  changed();
}

export function setResearching(id: number): void {
  db().prepare("update learn_courses set status = 'researching', error = null, updated_at = ? where id = ?").run(nowIso(), id);
  changed();
}

export function setInterests(id: number, weights: Record<string, number>): void {
  const clean = Object.fromEntries(Object.entries(weights).filter(([k, v]) => k.trim() && Number.isFinite(v) && v >= 0).map(([k, v]) => [k.trim().slice(0, 80), Math.min(10, v)]));
  db().prepare("update learn_courses set interests = ?, updated_at = ? where id = ?").run(JSON.stringify(clean), nowIso(), id);
  changed();
}

export function setCourseSlots(id: number, slots: StudySlot[]): void {
  db().prepare("update learn_courses set slots = ?, updated_at = ? where id = ?").run(JSON.stringify(slots), nowIso(), id);
  changed();
}

export function setReviewTodo(id: number, todoId: number | null): void {
  db().prepare("update learn_courses set review_todo_id = ? where id = ?").run(todoId, id);
}

export function setDailyGoal(id: number, xp: number): void {
  db().prepare("update learn_courses set daily_goal = ?, updated_at = ? where id = ?").run(Math.max(5, Math.min(1000, Math.round(xp))), nowIso(), id);
  changed();
}

// ---------------------------------------------------------------------------------------------------------------------
// Nodes and the tree
// ---------------------------------------------------------------------------------------------------------------------

export type CourseNode = TreeNode & {
  title: string;
  summary: string;
  objectives: string[];
  minutes: number | null;
  sources: string[];
  masteredAt: string | null;
  activeSince: string | null;
  lessonTodoId: number | null;
};
type NodeRow = Record<string, unknown> & { id: number; key: string };

const toNode = (r: NodeRow): CourseNode => ({
  id: r.id,
  key: r.key,
  kind: r.kind as NodeKind,
  parent: (r.parent_key as string | null) ?? null,
  requires: json<string[]>(r.requires as string, []),
  path: (r.path as string | null) ?? null,
  xp: Number(r.xp ?? 0),
  title: String(r.title),
  summary: String(r.summary ?? ""),
  objectives: json<string[]>(r.objectives as string, []),
  minutes: (r.minutes as number | null) ?? null,
  sources: json<string[]>(r.sources as string, []),
  masteredAt: (r.mastered_at as string | null) ?? null,
  activeSince: (r.active_since as string | null) ?? null,
  lessonTodoId: (r.lesson_todo_id as number | null) ?? null,
});

export const courseNodes = (courseId: number): CourseNode[] => (db().prepare("select * from learn_nodes where course_id = ? order by ord").all(courseId) as NodeRow[]).map(toNode);

export function getNode(courseId: number, key: string): CourseNode | undefined {
  const r = db().prepare("select * from learn_nodes where course_id = ? and key = ?").get(courseId, key) as NodeRow | undefined;
  return r ? toNode(r) : undefined;
}

const treeInput = (nodes: CourseNode[]): TreeInput => {
  const kids = new Set(nodes.map((n) => n.parent).filter(Boolean));
  // Only steps (leaves) are mastered by you; the rest roll up from them.
  return { nodes, mastered: new Set(nodes.filter((n) => n.masteredAt && !kids.has(n.key)).map((n) => n.key)), active: new Set(nodes.filter((n) => n.activeSince && !n.masteredAt).map((n) => n.key)) };
};

/** A course's nodes and its tree (statuses, progress, paths). */
export function courseTree(courseId: number): { nodes: CourseNode[]; tree: Tree } {
  const nodes = courseNodes(courseId);
  return { nodes, tree: computeTree(treeInput(nodes)) };
}

/** The tree's columns (src/plugins/learn/tree.ts layers) for these nodes of a course. */
export const nodeLayers = (nodes: CourseNode[]): Map<string, number> => layers(treeInput(nodes));

export function nextCourseSteps(courseId: number, limit = 8): CourseNode[] {
  const nodes = courseNodes(courseId);
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  return nextSteps(treeInput(nodes), getCourse(courseId)?.interests ?? {}, limit).map((n) => byKey.get(n.key)!);
}

/** A step's lesson began (it's "active" until mastered). */
export function startNode(courseId: number, key: string, lessonTodoId?: number): void {
  db()
    .prepare("update learn_nodes set active_since = coalesce(active_since, ?), lesson_todo_id = coalesce(?, lesson_todo_id) where course_id = ? and key = ?")
    .run(nowIso(), lessonTodoId ?? null, courseId, key);
  changed();
}

/**
 * A step mastered: its experience — and that of every skill, phase and year it completed (each once: what was
 * mastered before isn't counted again). A step whose requirements aren't mastered yet can't be.
 */
export function masterNode(courseId: number, key: string, at: Date = new Date(), note = ""): { xp: number; mastered: string[]; badges: BadgeId[] } {
  const before = courseTree(courseId);
  const node = before.nodes.find((n) => n.key === key);
  if (!node) throw new Error(`No step "${key}" in this course.`);
  const status = before.tree.status.get(key);
  if (status === "mastered") return { xp: 0, mastered: [], badges: [] };
  if (status === "locked") throw new Error(`"${node.title}" is still locked: what it requires isn't mastered yet.`);
  if (before.nodes.some((n) => n.parent === key)) throw new Error(`"${node.title}" is mastered through its steps.`);
  const d = db();
  d.prepare("update learn_nodes set mastered_at = ? where course_id = ? and key = ?").run(at.toISOString(), courseId, key);
  const after = courseTree(courseId);
  const newly = after.nodes.filter((n) => after.tree.status.get(n.key) === "mastered" && before.tree.status.get(n.key) !== "mastered");
  // Containers completed with it: marked too (their date of mastery).
  for (const n of newly) if (n.key !== key) d.prepare("update learn_nodes set mastered_at = ? where course_id = ? and key = ?").run(at.toISOString(), courseId, n.key);
  const xp = newly.reduce((s, n) => s + n.xp, 0);
  const badges = awardXp(courseId, xp, "mastered", { keys: newly.map((n) => n.key), note: note.slice(0, 500) }, at, key);
  return { xp, mastered: newly.map((n) => n.key), badges };
}

// ---------------------------------------------------------------------------------------------------------------------
// Experience, streak, badges
// ---------------------------------------------------------------------------------------------------------------------

/** Experience earned (logged): the course's total, today's, the streak — and the badges it earned now. */
export function awardXp(courseId: number, xp: number, kind: string, detail: Record<string, unknown>, at: Date = new Date(), nodeKey: string | null = null): BadgeId[] {
  const d = db();
  const c = getCourse(courseId);
  if (!c) throw new Error("No such course.");
  const day = localDay(at);
  d.prepare("insert into learn_events (course_id, node_key, kind, xp, detail, at) values (?, ?, ?, ?, ?, ?)").run(courseId, nodeKey, kind, xp, JSON.stringify(detail), at.toISOString());
  const s = nextStreak({ streak: c.streak, lastDay: c.lastDay }, day);
  const todayXp = (c.today === day ? c.todayXp : 0) + xp;
  const earned = badgesFor(stats(courseId, s.streak));
  const fresh = earned.filter((b) => !c.badges.includes(b));
  d.prepare("update learn_courses set xp = xp + ?, streak = ?, last_day = ?, today = ?, today_xp = ?, badges = ?, updated_at = ? where id = ?").run(
    xp,
    s.streak,
    s.lastDay,
    day,
    todayXp,
    JSON.stringify([...c.badges, ...fresh]),
    nowIso(),
    courseId,
  );
  changed();
  return fresh;
}

function stats(courseId: number, streak: number) {
  const { nodes, tree } = courseTree(courseId);
  const m = (k: NodeKind) => nodes.filter((n) => n.kind === k && tree.status.get(n.key) === "mastered").length;
  const d = db();
  const count = (sql: string) => Number((d.prepare(sql).get(courseId) as { n: number }).n);
  return {
    stepsMastered: m("step"),
    skillsMastered: m("skill"),
    phasesMastered: m("phase"),
    yearsMastered: m("year"),
    streak,
    reviews: count("select count(*) as n from learn_events where course_id = ? and kind = 'review'"),
    widgets: count("select count(*) as n from learn_widgets where course_id = ? and best_score is not null"),
    courseDone: tree.progress.steps > 0 && tree.progress.mastered === tree.progress.steps,
  };
}

/** What was earned lately (for the course page's log). */
export function recentEvents(courseId: number, limit = 30): { kind: string; xp: number; nodeKey: string | null; at: string; detail: Record<string, unknown> }[] {
  return (db().prepare("select kind, xp, node_key, at, detail from learn_events where course_id = ? order by id desc limit ?").all(courseId, limit) as Record<string, unknown>[]).map((r) => ({
    kind: String(r.kind),
    xp: Number(r.xp),
    nodeKey: (r.node_key as string | null) ?? null,
    at: String(r.at),
    detail: json<Record<string, unknown>>(r.detail as string, {}),
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------------------------------------------------

export type Widget = { id: number; courseId: number; nodeKey: string | null; runId: number | null; title: string; html: string; libs: string[]; bestScore: number | null; createdAt: string };
const toWidget = (r: Record<string, unknown>): Widget => ({
  id: Number(r.id),
  courseId: Number(r.course_id),
  nodeKey: (r.node_key as string | null) ?? null,
  runId: (r.run_id as number | null) ?? null,
  title: String(r.title),
  html: String(r.html),
  libs: json<string[]>(r.libs as string, []),
  bestScore: (r.best_score as number | null) ?? null,
  createdAt: String(r.created_at),
});

/** A widget the teacher made (checked: sandbox.ts) — its id, for the lesson to show it. */
export function addWidget(v: { courseId: number; nodeKey: string | null; title: string; html: string; libs?: string[]; runId?: number | null }): number {
  const ok = checkWidgetHtml(v.html);
  if (!ok.ok) throw new Error(`The widget can't be shown: ${ok.why}.`);
  const libs = (v.libs ?? []).filter((l) => Object.prototype.hasOwnProperty.call(WIDGET_LIBS, l));
  const r = db()
    .prepare("insert into learn_widgets (course_id, node_key, run_id, title, html, libs, created_at) values (?, ?, ?, ?, ?, ?, ?)")
    .run(v.courseId, v.nodeKey, v.runId ?? null, v.title.trim().slice(0, 200) || "Widget", v.html, JSON.stringify(libs), nowIso());
  changed();
  return Number(r.lastInsertRowid);
}

export function getWidget(id: number): Widget | undefined {
  const r = db().prepare("select * from learn_widgets where id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? toWidget(r) : undefined;
}

export const nodeWidgets = (courseId: number, nodeKey: string): Widget[] =>
  (db().prepare("select * from learn_widgets where course_id = ? and node_key = ? order by id").all(courseId, nodeKey) as Record<string, unknown>[]).map(toWidget);

/** A widget's result: kept as its best, worth experience only for doing better than before (5 at most per widget). */
export function widgetResult(id: number, r: Extract<WidgetMessage, { type: "result" }>, at: Date = new Date()): { xp: number; best: number } {
  const d = db();
  const w = d.prepare("select course_id, node_key, best_score, xp from learn_widgets where id = ?").get(id) as { course_id: number; node_key: string | null; best_score: number | null; xp: number } | undefined;
  if (!w) throw new Error("No such widget.");
  const best = Math.max(w.best_score ?? 0, r.score);
  const xp = Math.max(0, xpForResult({ type: "result", score: best }) - w.xp);
  d.prepare("update learn_widgets set best_score = ?, xp = xp + ? where id = ?").run(best, xp, id);
  awardXp(w.course_id, xp, "widget", { widget: id, score: r.score, ...(r.correct !== undefined ? { correct: r.correct, total: r.total } : {}), ...(r.note ? { note: r.note } : {}) }, at, w.node_key);
  return { xp, best };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cards (spaced repetition)
// ---------------------------------------------------------------------------------------------------------------------

export type Card = { id: number; courseId: number; nodeKey: string | null; front: string; back: string; reps: number; lapses: number; ease: number; interval: number; due: string; last: string | null };
const toCard = (r: Record<string, unknown>): Card => ({
  id: Number(r.id),
  courseId: Number(r.course_id),
  nodeKey: (r.node_key as string | null) ?? null,
  front: String(r.front),
  back: String(r.back),
  reps: Number(r.reps),
  lapses: Number(r.lapses),
  ease: Number(r.ease),
  interval: Number(r.interval),
  due: String(r.due),
  last: (r.last as string | null) ?? null,
});

/** Cards to review (a front and a back each), due at once. How many were added. */
export function addCards(courseId: number, nodeKey: string | null, cards: { front: string; back: string }[], now: Date = new Date()): number {
  const d = db();
  const ins = d.prepare("insert into learn_cards (course_id, node_key, front, back, due, created_at) values (?, ?, ?, ?, ?, ?)");
  let n = 0;
  for (const c of cards.slice(0, 100)) {
    const front = String(c.front ?? "").trim().slice(0, 2000);
    const back = String(c.back ?? "").trim().slice(0, 4000);
    if (!front || !back) continue;
    ins.run(courseId, nodeKey, front, back, newCard(now).due, nowIso());
    n++;
  }
  if (n) changed();
  return n;
}

export const dueCards = (courseId: number, now: Date = new Date(), limit = 200): Card[] =>
  (db().prepare("select * from learn_cards where course_id = ? and due <= ? order by due limit ?").all(courseId, now.toISOString(), limit) as Record<string, unknown>[]).map(toCard);

/** How many cards are due, per course. */
export const dueCount = (now: Date = new Date()): { courseId: number; due: number }[] =>
  (db().prepare("select course_id, count(*) as n from learn_cards where due <= ? group by course_id").all(now.toISOString()) as { course_id: number; n: number }[]).map((r) => ({ courseId: r.course_id, due: r.n }));

/** A card reviewed: its next date (srs.ts), a point of experience. */
export function reviewCard(cardId: number, grade: Grade, now: Date = new Date()): { xp: number; card: Card } {
  const d = db();
  const r = d.prepare("select * from learn_cards where id = ?").get(cardId) as Record<string, unknown> | undefined;
  if (!r) throw new Error("No such card.");
  const c = toCard(r);
  const next = review({ reps: c.reps, lapses: c.lapses, ease: c.ease, interval: c.interval, due: c.due, last: c.last }, grade, now);
  d.prepare("update learn_cards set reps = ?, lapses = ?, ease = ?, interval = ?, due = ?, last = ? where id = ?").run(next.reps, next.lapses, next.ease, next.interval, next.due, next.last, cardId);
  awardXp(c.courseId, 1, "review", { card: cardId, grade }, now, c.nodeKey);
  return { xp: 1, card: { ...c, ...next } };
}
