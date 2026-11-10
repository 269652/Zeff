/**
 * The learning platform's data (the Learn plugin): courses, the nodes of their plan with your progress, what you earned
 * (activity), the teacher's widgets and your cards — kept in Learn's Workspace databases (dbs.ts), which are the source of
 * truth: read from there and written there through the Workspace's store, so what you change in them is what Learn goes on
 * with (a step ticked "Mastered", a title, a card's due date). Only the snapshots of exercises (HTML as it looked) stay in a
 * table of their own (learn_snapshots). Ids are the rows' ids; a row moved from Learn's old tables answers to its old id too
 * (`learnlegacy`: old links, old teacher sessions). Server only.
 */
import { courseRoute, skillGraph } from "./map";
import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { localDay } from "@/lib/dates";
import { checkWidgetHtml, xpForResult, WIDGET_LIBS, type WidgetMessage } from "@/lib/widgets/sandbox";
import { specHtml, type ExerciseSet } from "@/lib/widgets/spec";
import { addRow, archivePage, getPage, setCell, updatePage } from "@/plugins/workspace/store";
import type { Row } from "@/plugins/workspace/model";
import { badgesFor, nextStreak, type BadgeId } from "./game";
import { normalizePlan } from "./plan";
import { review, newCard, type Grade } from "./srs";
import { computeTree, layers, nextSteps, type Tree, type TreeInput, type TreeNode } from "./tree";
import { learnDbs, learnRows, memo, P } from "./dbs";
import type { NodeKind, PlanSource } from "./shared";
// (Learn's old tables moved into the databases the first time they're used: to-workspace.ts registers how.)
import "./to-workspace";

/** The snapshots of exercises (the HTML as it looked when you were done): blobs, kept in a table of their own. */
function snapshots() {
  const d = getSqlite();
  d.exec("create table if not exists learn_snapshots (id integer primary key autoincrement, course_id integer not null, widget_id integer not null, html text not null, at text not null)");
  return d;
}

const nowIso = () => new Date().toISOString();
const changed = () => emitChange("learn");
const json = <T>(s: unknown, fallback: T): T => {
  try {
    return typeof s === "string" && s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const ids = (v: unknown): number[] => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const first = (v: unknown): number | null => ids(v)[0] ?? null;
const inTx = <T>(fn: () => T): T => getSqlite().transaction(fn)();

const pad = (n: number) => String(n).padStart(2, "0");
/** A time as a date cell holds it: local, to the minute ("2026-11-08T11:00"). */
export function timeCell(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** A date cell's time (a day: its midnight, local) as an ISO time; null: none. */
export function cellTime(v: unknown): string | null {
  const s = typeof v === "string" ? v : v && typeof v === "object" && "start" in v ? str((v as { start: unknown }).start) : "";
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const dayCell = (v: unknown): string | null => {
  const s = typeof v === "string" ? v : v && typeof v === "object" && "start" in v ? str((v as { start: unknown }).start) : "";
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** Cells of a row set — only those that change (each through the Workspace's store: its log, search, routines). */
function setCells(row: Row | number, cells: Record<string, unknown>): void {
  const r = typeof row === "number" ? null : row;
  const id = typeof row === "number" ? row : row.id;
  const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
  for (const [k, v] of Object.entries(cells)) {
    const was = r ? r.cells[k] : undefined;
    if (r && (blank(v) ? blank(was) : JSON.stringify(was) === JSON.stringify(v))) continue;
    setCell(id, k, blank(v) ? null : v, { quiet: true });
  }
}

/** Only the cells with a value (for a new row). */
const filled = (cells: Record<string, unknown>) => Object.fromEntries(Object.entries(cells).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)));

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
  /** Its id in Learn's old tables (before the move into the Workspace) — null: made since. */
  legacyId: number | null;
};

const STATUSES: CourseStatus[] = ["researching", "ready", "failed"];

const toCourse = (r: Row): Course => {
  const c = r.cells;
  const topic = str(c[P.topic]) || r.title;
  return {
    id: r.id,
    topic,
    goal: str(c[P.goal]),
    level: str(c[P.level]),
    status: STATUSES.includes(c[P.status] as CourseStatus) ? (c[P.status] as CourseStatus) : "ready",
    title: r.title || topic,
    summary: str(c[P.summary]),
    years: num(c[P.years]),
    sources: json<PlanSource[]>(c[P.sources], []),
    problems: json<string[]>(c[P.problems], []),
    error: str(c[P.error]) || null,
    interests: json<Record<string, number>>(c[P.interests], {}),
    dailyGoal: num(c[P.dailyGoal], 50),
    xp: num(c[P.xp]),
    streak: num(c[P.streak]),
    lastDay: dayCell(c[P.lastDay]),
    today: dayCell(c[P.today]),
    todayXp: num(c[P.todayXp]),
    badges: (Array.isArray(c[P.badges]) ? (c[P.badges] as BadgeId[]) : []),
    slots: json<StudySlot[]>(c[P.slots], []),
    reviewTodoId: first(c[P.reviewTodo]),
    createdAt: r.createdAt,
    legacyId: c[P.legacy] !== undefined ? num(c[P.legacy]) : null,
  };
};

const courses = (): Course[] => memo("learn:courses", () => learnRows("courses").map(toCourse));

/** A course's row: by its id — or by the id it had before the move (an old link, an old session). */
function courseRow(id: number): Row | undefined {
  const rows = learnRows("courses");
  return rows.find((r) => r.id === id) ?? rows.find((r) => r.cells[P.legacy] !== undefined && num(r.cells[P.legacy]) === id);
}
/** The course's id now (the row's) — an old id followed; the id itself when there's no such course. */
const cid = (id: number): number => courseRow(Number(id))?.id ?? Number(id);

export function createCourse(v: { topic: string; goal: string; level: string }): number {
  const topic = v.topic.trim().slice(0, 200);
  if (!topic) throw new Error("What do you want to learn?");
  const id = addRow(learnDbs().courses, { title: topic, cells: filled({ [P.topic]: topic, [P.goal]: v.goal.trim().slice(0, 1000), [P.level]: v.level.trim().slice(0, 300), [P.status]: "researching", [P.dailyGoal]: 50, [P.xp]: 0, [P.streak]: 0 }) });
  changed();
  return id;
}

export function getCourse(id: number): Course | undefined {
  const r = courseRow(Number(id));
  return r ? courses().find((c) => c.id === r.id) : undefined;
}

export const listCourses = (): Course[] => [...courses()].sort((a, b) => {
  const ra = learnRows("courses").find((r) => r.id === a.id)!;
  const rb = learnRows("courses").find((r) => r.id === b.id)!;
  return rb.updatedAt.localeCompare(ra.updatedAt) || b.id - a.id;
});

/** Rows of a Learn database that belong to a course (its relation). */
const ofCourse = (which: "steps" | "exercises" | "activity" | "cards" | "messages", courseId: number): Row[] =>
  memo(`learn:of:${which}:${courseId}`, () => learnRows(which).filter((r) => ids(r.cells[P.course]).includes(courseId)));

/** A course gone — with its steps, exercises, activity, cards and conversations (to the Workspace's trash: they can come back). */
export function deleteCourse(id: number): void {
  const c = cid(id);
  inTx(() => {
    for (const w of ["messages", "cards", "activity", "exercises", "steps"] as const) for (const r of ofCourse(w, c)) archivePage(r.id);
    if (courseRow(c)) archivePage(c);
  });
  changed();
}

/** The research's plan into the course (checked and repaired: plan.ts) — its nodes replace any before. */
/** `keepProgress`: an updated plan (the same steps, revised) — what was done stays with each key it still has. */
export function savePlan(id: number, raw: unknown, opts: { keepProgress?: boolean } = {}): { problems: string[] } {
  const { plan, problems } = normalizePlan(raw);
  const courseId = cid(id);
  if (!plan.nodes.length) {
    failResearch(courseId, problems[0] ?? "The plan has no steps.");
    return { problems };
  }
  const dbs = learnDbs();
  inTx(() => {
    // Each key keeps its row (what links to it — its exercises, cards, conversation — stays linked); a key the plan
    // doesn't have any more goes to the trash. A new plan (not an update) starts without progress.
    const had = new Map<string, Row>();
    for (const r of ofCourse("steps", courseId)) {
      const k = str(r.cells[P.key]);
      if (k && !had.has(k)) had.set(k, r);
      else archivePage(r.id);
    }
    const rowOf = new Map<string, number>();
    plan.nodes.forEach((n, i) => {
      const cells: Record<string, unknown> = {
        [P.course]: [courseId],
        [P.key]: n.key,
        [P.kind]: n.kind,
        [P.summary]: n.summary ?? "",
        [P.objectives]: (n.objectives ?? []).join("\n"),
        [P.path]: n.path ?? "",
        [P.xp]: n.xp ?? 0,
        [P.minutes]: n.minutes ?? null,
        [P.sourceIds]: (n.sources ?? []).join(", "),
        [P.order]: i,
        ...(n.parent && rowOf.has(n.parent) ? { [P.parent]: [rowOf.get(n.parent)!] } : {}),
        ...(!opts.keepProgress ? { [P.mastered]: false, [P.masteredAt]: null, [P.activeSince]: null, [P.lessonTodo]: null } : {}),
      };
      const row = had.get(n.key);
      if (row) {
        if (row.title !== n.title) setCell(row.id, "title", n.title, { quiet: true });
        setCells(row, cells);
        rowOf.set(n.key, row.id);
      } else rowOf.set(n.key, addRow(dbs.steps, { title: n.title, cells: filled(cells) }));
    });
    for (const [k, r] of had) if (!rowOf.has(k)) archivePage(r.id);
    // What links the steps: each one's parent and what it requires (rows of this course).
    const now = new Map(learnRows("steps").map((r) => [r.id, r]));
    for (const n of plan.nodes) {
      const row = now.get(rowOf.get(n.key)!);
      if (!row) continue;
      setCells(row, { [P.parent]: n.parent && rowOf.has(n.parent) ? [rowOf.get(n.parent)!] : null, [P.requires]: (n.requires ?? []).filter((k) => rowOf.has(k)).map((k) => rowOf.get(k)!) });
    }
    const course = courseRow(courseId)!;
    if (course.title !== plan.title && plan.title) setCell(courseId, "title", plan.title, { quiet: true });
    setCells(courseRow(courseId)!, { [P.status]: "ready", [P.summary]: plan.summary, [P.years]: plan.years, [P.sources]: JSON.stringify(plan.sources), [P.problems]: JSON.stringify(problems), [P.error]: null });
  });
  changed();
  return { problems };
}

const setCourse = (id: number, cells: Record<string, unknown>) => {
  const r = courseRow(Number(id));
  if (!r) return;
  setCells(r, cells);
  changed();
};

export function failResearch(id: number, error: string): void {
  setCourse(id, { [P.status]: "failed", [P.error]: error.slice(0, 2000) });
}

export function setResearching(id: number): void {
  setCourse(id, { [P.status]: "researching", [P.error]: null });
}

export function setInterests(id: number, weights: Record<string, number>): void {
  const clean = Object.fromEntries(Object.entries(weights).filter(([k, v]) => k.trim() && Number.isFinite(v) && v >= 0).map(([k, v]) => [k.trim().slice(0, 80), Math.min(10, v)]));
  setCourse(id, { [P.interests]: JSON.stringify(clean) });
}

export function setCourseSlots(id: number, slots: StudySlot[]): void {
  setCourse(id, { [P.slots]: JSON.stringify(slots) });
}

export function setReviewTodo(id: number, todoId: number | null): void {
  const r = courseRow(Number(id));
  if (r) setCells(r, { [P.reviewTodo]: todoId ? [todoId] : null });
}

export function setDailyGoal(id: number, xp: number): void {
  setCourse(id, { [P.dailyGoal]: Math.max(5, Math.min(1000, Math.round(xp))) });
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

const KINDS: NodeKind[] = ["year", "phase", "skill", "step"];
/** A step's key: its own, or one made from its row (a step you added in the database by hand). */
const keyOf = (r: Row) => str(r.cells[P.key]).trim() || `r${r.id}`;

/** A course's nodes, in the plan's order — from its rows in Steps (read once until something changes). */
export const courseNodes = (courseId: number): CourseNode[] => {
  const c = cid(courseId);
  return memo(`learn:nodes:${c}`, () => {
    const rows = ofCourse("steps", c);
    const keyById = new Map(rows.map((r) => [r.id, keyOf(r)]));
    const at = new Map(rows.map((r, i) => [r.id, i]));
    const order = (r: Row) => (r.cells[P.order] !== undefined && r.cells[P.order] !== null ? num(r.cells[P.order]) : Number.MAX_SAFE_INTEGER);
    return [...rows]
      .sort((a, b) => order(a) - order(b) || at.get(a.id)! - at.get(b.id)!)
      .map((r): CourseNode => {
        const c = r.cells;
        const mastered = c[P.mastered] === true;
        return {
          id: r.id,
          key: keyOf(r),
          kind: KINDS.includes(c[P.kind] as NodeKind) ? (c[P.kind] as NodeKind) : "step",
          parent: ids(c[P.parent]).map((x) => keyById.get(x)).find(Boolean) ?? null,
          requires: ids(c[P.requires]).map((x) => keyById.get(x)).filter((x): x is string => !!x),
          path: str(c[P.path]) || null,
          xp: num(c[P.xp]),
          title: r.title,
          summary: str(c[P.summary]),
          objectives: str(c[P.objectives]).split("\n").map((x) => x.trim()).filter(Boolean),
          minutes: c[P.minutes] === undefined || c[P.minutes] === null ? null : num(c[P.minutes]),
          sources: str(c[P.sourceIds]).split(/[,\s]+/).filter(Boolean),
          // Ticked "Mastered" in the database is mastered (its time: when it was, else when the row was changed).
          masteredAt: mastered ? (cellTime(c[P.masteredAt]) ?? r.updatedAt) : null,
          activeSince: cellTime(c[P.activeSince]),
          lessonTodoId: first(c[P.lessonTodo]),
        };
      });
  });
};

export function getNode(courseId: number, key: string): CourseNode | undefined {
  return courseNodes(courseId).find((n) => n.key === key);
}

/** A step's row (by its key) in a course. */
const stepRow = (courseId: number, key: string | null): Row | undefined => {
  if (!key) return undefined;
  const id = getNode(courseId, key)?.id;
  return id ? learnRows("steps").find((r) => r.id === id) : undefined;
};

const treeInput = (nodes: CourseNode[]): TreeInput => {
  const kids = new Set(nodes.map((n) => n.parent).filter(Boolean));
  // Only steps (leaves) are mastered by you; the rest roll up from them.
  return { nodes, mastered: new Set(nodes.filter((n) => n.masteredAt && !kids.has(n.key)).map((n) => n.key)), active: new Set(nodes.filter((n) => n.activeSince && !n.masteredAt).map((n) => n.key)) };
};

/** A course's nodes and its tree (statuses, progress, paths). */
export function courseTree(courseId: number): { nodes: CourseNode[]; tree: Tree } {
  const c = cid(courseId);
  return memo(`learn:tree:${c}`, () => {
    const nodes = courseNodes(c);
    return { nodes, tree: computeTree(treeInput(nodes)) };
  });
}

/** The tree's columns (src/plugins/learn/tree.ts layers) for these nodes of a course. */
export const nodeLayers = (nodes: CourseNode[]): Map<string, number> => layers(treeInput(nodes));

export function nextCourseSteps(courseId: number, limit = 8): CourseNode[] {
  const nodes = courseNodes(courseId);
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const interests = getCourse(courseId)?.interests ?? {};
  // In the red thread's order (map.ts courseRoute): what you're in first, then the foundations one after another, then
  // the paths you care about most — the same way the skill map draws it.
  const route = courseRoute(nodes, skillGraph(nodes), interests).keys;
  const at = new Map(route.map((k, i) => [k, i]));
  const rank = (n: CourseNode) => at.get(n.parent ?? "") ?? Number.MAX_SAFE_INTEGER;
  const active = (n: CourseNode) => !!n.activeSince && !n.masteredAt;
  return nextSteps(treeInput(nodes), interests, 1000)
    .map((n) => byKey.get(n.key)!)
    .sort((a, b) => Number(active(b)) - Number(active(a)) || rank(a) - rank(b))
    .slice(0, limit);
}

/** A step's lesson began (it's "active" until mastered). */
export function startNode(courseId: number, key: string, lessonTodoId?: number): void {
  const r = stepRow(cid(courseId), key);
  if (!r) return;
  setCells(r, { ...(r.cells[P.activeSince] ? {} : { [P.activeSince]: timeCell(nowIso()) }), ...(lessonTodoId ? { [P.lessonTodo]: [lessonTodoId] } : {}) });
  changed();
}

/**
 * A step mastered: its experience — and that of every skill, phase and year it completed (each once: what was
 * mastered before isn't counted again). A step whose requirements aren't mastered yet can't be.
 */
export function masterNode(courseId: number, key: string, at: Date = new Date(), note = ""): { xp: number; mastered: string[]; badges: BadgeId[] } {
  const c = cid(courseId);
  const before = courseTree(c);
  const node = before.nodes.find((n) => n.key === key);
  if (!node) throw new Error(`No step "${key}" in this course.`);
  const status = before.tree.status.get(key);
  if (status === "mastered") return { xp: 0, mastered: [], badges: [] };
  if (status === "locked") throw new Error(`"${node.title}" is still locked: what it requires isn't mastered yet.`);
  if (before.nodes.some((n) => n.parent === key)) throw new Error(`"${node.title}" is mastered through its steps.`);
  return inTx(() => {
    const mark = (k: string) => {
      const r = stepRow(c, k);
      if (r) setCells(r, { [P.mastered]: true, [P.masteredAt]: timeCell(at.toISOString()) });
    };
    mark(key);
    const after = courseTree(c);
    const newly = after.nodes.filter((n) => after.tree.status.get(n.key) === "mastered" && before.tree.status.get(n.key) !== "mastered");
    // Containers completed with it: marked too (their date of mastery).
    for (const n of newly) if (n.key !== key) mark(n.key);
    const xp = newly.reduce((s, n) => s + n.xp, 0);
    const badges = awardXp(c, xp, "mastered", { keys: newly.map((n) => n.key), note: note.slice(0, 500) }, at, key);
    return { xp, mastered: newly.map((n) => n.key), badges };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Experience, streak, badges — each event a row of Activity
// ---------------------------------------------------------------------------------------------------------------------

/** What an Activity row says (its title). */
function eventTitle(kind: string, courseId: number, nodeKey: string | null, detail: Record<string, unknown>): string {
  const step = nodeKey ? (getNode(courseId, nodeKey)?.title ?? nodeKey) : "";
  if (kind === "mastered") return `✓ ${step}`;
  if (kind === "widget") return `${getWidget(Number(detail.widget))?.title ?? "Widget"} — ${Math.round(num(detail.score) * 100)} %`;
  if (kind === "review") return `↻ ${getCard(Number(detail.card))?.front.slice(0, 120) ?? ""}`;
  return kind;
}

/** Details kept as JSON in a cell (20 000 characters at most): long answers shortened rather than the JSON cut. */
function detailCell(detail: Record<string, unknown>): string {
  let s = JSON.stringify(detail);
  if (s.length <= 19000) return s;
  const answers = Array.isArray(detail.answers) ? (detail.answers as { q: string; a: string; ok?: boolean }[]).map((x) => ({ ...x, q: str(x.q).slice(0, 200), a: str(x.a).slice(0, 200) })) : undefined;
  s = JSON.stringify({ ...detail, ...(answers ? { answers } : {}), note: str(detail.note).slice(0, 500) });
  return s.length <= 19000 ? s : JSON.stringify({ ...detail, answers: undefined, note: str(detail.note).slice(0, 500) });
}

/** Experience earned (logged): the course's total, today's, the streak — and the badges it earned now. */
export function awardXp(courseId: number, xp: number, kind: string, detail: Record<string, unknown>, at: Date = new Date(), nodeKey: string | null = null): BadgeId[] {
  const c = getCourse(courseId);
  if (!c) throw new Error("No such course.");
  return inTx(() => {
    const day = localDay(at);
    const step = stepRow(c.id, nodeKey);
    addRow(learnDbs().activity, {
      title: eventTitle(kind, c.id, nodeKey, detail),
      cells: filled({
        [P.event]: kind,
        [P.at]: timeCell(at.toISOString()),
        [P.xp]: xp,
        [P.course]: [c.id],
        [P.step]: step ? [step.id] : null,
        [P.stepKey]: nodeKey ?? "",
        [P.exercise]: kind === "widget" && detail.widget ? [Number(detail.widget)] : null,
        [P.card]: kind === "review" && detail.card ? [Number(detail.card)] : null,
        [P.score]: typeof detail.score === "number" ? detail.score : null,
        [P.snapshot]: detail.snapshot ? Number(detail.snapshot) : null,
        [P.detail]: detailCell(detail),
      }),
    });
    const s = nextStreak({ streak: c.streak, lastDay: c.lastDay }, day);
    const todayXp = (c.today === day ? c.todayXp : 0) + xp;
    const earned = badgesFor(stats(c.id, s.streak));
    const fresh = earned.filter((b) => !c.badges.includes(b));
    setCells(courseRow(c.id)!, { [P.xp]: c.xp + xp, [P.streak]: s.streak, [P.lastDay]: s.lastDay, [P.today]: day, [P.todayXp]: todayXp, [P.badges]: [...c.badges, ...fresh] });
    changed();
    return fresh;
  });
}

function stats(courseId: number, streak: number) {
  const { nodes, tree } = courseTree(courseId);
  const m = (k: NodeKind) => nodes.filter((n) => n.kind === k && tree.status.get(n.key) === "mastered").length;
  return {
    stepsMastered: m("step"),
    skillsMastered: m("skill"),
    phasesMastered: m("phase"),
    yearsMastered: m("year"),
    streak,
    reviews: ofCourse("activity", courseId).filter((r) => r.cells[P.event] === "review").length,
    widgets: ofCourse("exercises", courseId).filter((r) => r.cells[P.best] !== undefined && r.cells[P.best] !== null).length,
    courseDone: tree.progress.steps > 0 && tree.progress.mastered === tree.progress.steps,
  };
}

type Event = { id: number; kind: string; xp: number; nodeKey: string | null; at: string; detail: Record<string, unknown> };

/** A course's activity, oldest first (as it was logged). */
function events(courseId: number): Event[] {
  const c = cid(courseId);
  return memo(`learn:events:${c}`, () => {
    const keyById = new Map(ofCourse("steps", c).map((r) => [r.id, keyOf(r)]));
    return ofCourse("activity", c)
      .map((r): Event => {
        const x = r.cells;
        const step = first(x[P.step]);
        return {
          id: r.id,
          kind: str(x[P.event]) || "other",
          xp: num(x[P.xp]),
          nodeKey: (step && keyById.get(step)) || str(x[P.stepKey]) || null,
          at: cellTime(x[P.at]) ?? r.createdAt,
          detail: json<Record<string, unknown>>(x[P.detail], {}),
        };
      })
      .sort((a, b) => a.id - b.id);
  });
}

/** What was earned lately (for the course page's log). */
export function recentEvents(courseId: number, limit = 30): { kind: string; xp: number; nodeKey: string | null; at: string; detail: Record<string, unknown> }[] {
  return [...events(courseId)].reverse().slice(0, limit).map(({ kind, xp, nodeKey, at, detail }) => ({ kind, xp, nodeKey, at, detail }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Widgets — rows of Exercises (an exercise set's spec in a cell, else the HTML on the row's page)
// ---------------------------------------------------------------------------------------------------------------------

export type Widget = { id: number; courseId: number; nodeKey: string | null; runId: number | null; title: string; html: string; libs: string[]; bestScore: number | null; createdAt: string };

/** A widget's HTML on its row's page: one code block (in pieces of 100 000 characters — what a text of a page holds). */
export function htmlDoc(html: string): unknown {
  const parts: { type: "text"; text: string }[] = [];
  for (let i = 0; i < html.length; i += 100000) parts.push({ type: "text", text: html.slice(i, i + 100000) });
  return { type: "doc", content: [{ type: "codeBlock", attrs: { language: "html" }, content: parts }] };
}
/** The HTML of a widget's page (its first code block). */
function pageHtml(id: number): string {
  const doc = getPage(id)?.content as { content?: { type: string; content?: { text?: string }[] }[] } | undefined;
  const block = doc?.content?.find((n) => n.type === "codeBlock");
  return (block?.content ?? []).map((t) => t.text ?? "").join("");
}

/** A widget from its row (`withHtml`: its HTML too — from the spec, else its page). */
function toWidget(r: Row, withHtml: boolean): Widget {
  const c = r.cells;
  const courseId = first(c[P.course]) ?? 0;
  const step = first(c[P.step]);
  const keyOf2 = step ? (ofCourse("steps", courseId).find((x) => x.id === step) ?? null) : null;
  let html = "";
  if (withHtml) {
    const spec = json<ExerciseSet | null>(c[P.spec], null);
    html = spec && Array.isArray(spec.items) ? specHtml({ ...spec, title: spec.title ?? r.title }) : pageHtml(r.id);
  }
  return {
    id: r.id,
    courseId,
    nodeKey: keyOf2 ? keyOf(keyOf2) : null,
    runId: c[P.run] === undefined ? null : num(c[P.run]),
    title: r.title || "Widget",
    html,
    libs: Array.isArray(c[P.libs]) ? (c[P.libs] as string[]) : [],
    bestScore: c[P.best] === undefined || c[P.best] === null ? null : num(c[P.best]),
    createdAt: r.createdAt,
  };
}

const widgetRow = (id: number): Row | undefined => {
  const rows = learnRows("exercises");
  return rows.find((r) => r.id === id) ?? rows.find((r) => r.cells[P.legacy] !== undefined && num(r.cells[P.legacy]) === id);
};

/** A widget the teacher made (checked: sandbox.ts) — its id, for the lesson to show it. `spec`: the exercise set it was made from. */
export function addWidget(v: { courseId: number; nodeKey: string | null; title: string; html: string; libs?: string[]; runId?: number | null; spec?: unknown }): number {
  const ok = checkWidgetHtml(v.html);
  if (!ok.ok) throw new Error(`The widget can't be shown: ${ok.why}.`);
  const libs = (v.libs ?? []).filter((l) => Object.prototype.hasOwnProperty.call(WIDGET_LIBS, l));
  const courseId = cid(v.courseId);
  const step = stepRow(courseId, v.nodeKey);
  const spec = v.spec && typeof v.spec === "object" ? JSON.stringify(v.spec) : "";
  return inTx(() => {
    const id = addRow(learnDbs().exercises, {
      title: v.title.trim().slice(0, 200) || "Widget",
      cells: filled({ [P.course]: [courseId], [P.step]: step ? [step.id] : null, [P.libs]: libs, [P.run]: v.runId ?? null, [P.spec]: spec.length <= 19000 ? spec : "" }),
    });
    // The HTML on its page (an exercise set's too: shown as it was made, should the set be changed into something unreadable).
    updatePage(id, { content: htmlDoc(v.html) });
    changed();
    return id;
  });
}

export function getWidget(id: number): Widget | undefined {
  const r = widgetRow(Number(id));
  return r ? toWidget(r, true) : undefined;
}

export const nodeWidgets = (courseId: number, nodeKey: string, opts: { html?: boolean } = {}): Widget[] => {
  const c = cid(courseId);
  const step = getNode(c, nodeKey)?.id;
  if (!step) return [];
  return ofCourse("exercises", c)
    .filter((r) => ids(r.cells[P.step]).includes(step))
    .sort((a, b) => a.id - b.id)
    .map((r) => toWidget(r, opts.html !== false));
};

/** A widget's result: kept as its best, worth experience only for doing better than before (5 at most per widget). */
export function widgetResult(id: number, r: Extract<WidgetMessage, { type: "result" }>, at: Date = new Date()): { xp: number; best: number } {
  const row = widgetRow(Number(id));
  if (!row) throw new Error("No such widget.");
  const w = toWidget(row, false);
  const best = Math.max(w.bestScore ?? 0, r.score);
  const xp = Math.max(0, xpForResult({ type: "result", score: best }) - num(row.cells[P.xp]));
  return inTx(() => {
    setCells(row, { [P.best]: best, [P.xp]: num(row.cells[P.xp]) + xp });
    // The widget as it looked (its drawing, what was typed): kept beside the event, its id in it.
    const snapshot = r.snapshot ? Number(snapshots().prepare("insert into learn_snapshots (course_id, widget_id, html, at) values (?, ?, ?, ?)").run(w.courseId, row.id, r.snapshot, at.toISOString()).lastInsertRowid) : null;
    awardXp(w.courseId, xp, "widget", { widget: row.id, score: r.score, ...(r.correct !== undefined ? { correct: r.correct, total: r.total } : {}), ...(r.note ? { note: r.note } : {}), ...(r.answers ? { answers: r.answers } : {}), ...(snapshot ? { snapshot } : {}) }, at, w.nodeKey);
    return { xp, best };
  });
}

/** Every result a step's exercises reported (each try, oldest first) — the lesson's timeline (timeline.ts). */
export function widgetResults(courseId: number, nodeKey: string): import("./timeline").TimelineResult[] {
  return events(courseId)
    .filter((e) => e.kind === "widget" && e.nodeKey === nodeKey)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
    .map((e) => {
      const d = e.detail as { widget?: number; score?: number; correct?: number; total?: number; note?: string; answers?: { q: string; a: string; ok?: boolean }[]; snapshot?: number };
      return { at: e.at, widget: Number(d.widget ?? 0), score: Number(d.score ?? 0), ...(d.correct !== undefined ? { correct: d.correct, total: d.total } : {}), ...(d.note ? { note: d.note } : {}), ...(d.answers ? { answers: d.answers } : {}), ...(d.snapshot ? { snapshotId: Number(d.snapshot) } : {}) };
    });
}

/** A try's snapshot: the widget's body as it looked, with its title and the libraries it was drawn with (null: none such). */
export function widgetSnapshot(id: number): { html: string; title: string; libs: string[]; at: string } | null {
  const s = snapshots().prepare("select html, at, widget_id from learn_snapshots where id = ?").get(id) as { html: string; at: string; widget_id: number } | undefined;
  if (!s) return null;
  // Its widget: the one whose result names this snapshot (Activity), else by the id it was kept with.
  const ev = learnRows("activity").find((r) => r.cells[P.snapshot] !== undefined && num(r.cells[P.snapshot]) === Number(id));
  const row = (ev && first(ev.cells[P.exercise]) ? widgetRow(first(ev.cells[P.exercise])!) : undefined) ?? widgetRow(s.widget_id);
  const w = row ? toWidget(row, false) : null;
  return { html: s.html, title: w?.title ?? "Widget", libs: w?.libs ?? [], at: s.at };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cards (spaced repetition) — rows of Cards
// ---------------------------------------------------------------------------------------------------------------------

export type Card = { id: number; courseId: number; nodeKey: string | null; front: string; back: string; reps: number; lapses: number; ease: number; interval: number; due: string; last: string | null };

const toCard = (r: Row): Card => {
  const c = r.cells;
  const courseId = first(c[P.course]) ?? 0;
  const step = first(c[P.step]);
  const sr = step ? ofCourse("steps", courseId).find((x) => x.id === step) : undefined;
  return {
    id: r.id,
    courseId,
    nodeKey: sr ? keyOf(sr) : null,
    front: str(c[P.front]) || r.title,
    back: str(c[P.back]),
    reps: num(c[P.reps]),
    lapses: num(c[P.lapses]),
    ease: num(c[P.ease], 2.5),
    interval: num(c[P.interval]),
    // (No due date: due now — a card you added by hand.)
    due: cellTime(c[P.due]) ?? r.createdAt,
    last: cellTime(c[P.last]),
  };
};

const cards = (): Card[] => memo("learn:cards", () => learnRows("cards").map(toCard));
const cardRow = (id: number): Row | undefined => {
  const rows = learnRows("cards");
  return rows.find((r) => r.id === id) ?? rows.find((r) => r.cells[P.legacy] !== undefined && num(r.cells[P.legacy]) === id);
};
const getCard = (id: number): Card | undefined => {
  const r = cardRow(id);
  return r ? cards().find((c) => c.id === r.id) : undefined;
};

/** Cards to review (a front and a back each), due at once. How many were added. */
export function addCards(courseId: number, nodeKey: string | null, list: { front: string; back: string }[], now: Date = new Date()): number {
  const c = cid(courseId);
  const step = stepRow(c, nodeKey);
  let n = 0;
  inTx(() => {
    for (const x of list.slice(0, 100)) {
      const front = String(x.front ?? "").trim().slice(0, 2000);
      const back = String(x.back ?? "").trim().slice(0, 4000);
      if (!front || !back) continue;
      const s = newCard(now);
      addRow(learnDbs().cards, {
        title: front.slice(0, 300),
        cells: filled({ [P.front]: front.length > 300 ? front : "", [P.back]: back, [P.due]: timeCell(s.due), [P.reps]: 0, [P.lapses]: 0, [P.ease]: s.ease, [P.interval]: 0, [P.course]: [c], [P.step]: step ? [step.id] : null }),
      });
      n++;
    }
  });
  if (n) changed();
  return n;
}

const isDueBy = (c: Card, now: Date) => Date.parse(c.due) <= now.getTime();

export const dueCards = (courseId: number, now: Date = new Date(), limit = 200): Card[] => {
  const c = cid(courseId);
  return cards()
    .filter((x) => x.courseId === c && isDueBy(x, now))
    .sort((a, b) => a.due.localeCompare(b.due) || a.id - b.id)
    .slice(0, limit);
};

/** How many cards are due, per course. */
export const dueCount = (now: Date = new Date()): { courseId: number; due: number }[] => {
  const by = new Map<number, number>();
  for (const c of cards()) if (c.courseId && isDueBy(c, now)) by.set(c.courseId, (by.get(c.courseId) ?? 0) + 1);
  return [...by].map(([courseId, due]) => ({ courseId, due }));
};

/** A card reviewed: its next date (srs.ts), a point of experience. */
export function reviewCard(cardId: number, grade: Grade, now: Date = new Date()): { xp: number; card: Card } {
  const row = cardRow(Number(cardId));
  if (!row) throw new Error("No such card.");
  const c = toCard(row);
  const next = review({ reps: c.reps, lapses: c.lapses, ease: c.ease, interval: c.interval, due: c.due, last: c.last }, grade, now);
  return inTx(() => {
    setCells(row, { [P.reps]: next.reps, [P.lapses]: next.lapses, [P.ease]: next.ease, [P.interval]: next.interval, [P.due]: timeCell(next.due), [P.last]: timeCell(next.last) });
    awardXp(c.courseId, 1, "review", { card: row.id, grade }, now, c.nodeKey);
    return { xp: 1, card: { ...c, ...next } };
  });
}

/**
 * What the person has shown in this course so far, outside one step — for the teacher of the next lesson, so it builds
 * on it instead of starting from zero: the steps mastered (with what showed it) and the exercises done (the newest, each
 * with its score and answers). Plain lines, German like the teacher's rules; at most ~3000 characters.
 */
export function courseHistory(courseId: number, exceptKey?: string): string[] {
  const rows = [...events(courseId)].reverse().filter((e) => e.kind === "mastered" || e.kind === "widget").slice(0, 60);
  const titles = new Map(courseNodes(courseId).map((n) => [n.key, n.title]));
  const out: string[] = [];
  let size = 0;
  for (const r of rows) {
    if (r.nodeKey && r.nodeKey === exceptKey) continue;
    const d = r.detail as { note?: string; score?: number; correct?: number; total?: number; answers?: { q: string; a: string; ok?: boolean }[] };
    const step = r.nodeKey ? `„${titles.get(r.nodeKey) ?? r.nodeKey}“ (${r.nodeKey})` : "";
    const line =
      r.kind === "mastered"
        ? `- Einheit ${step} gemeistert${d.note ? `: ${d.note}` : ""}`
        : `- Übung in ${step}${d.note ? ` (${d.note})` : ""}: ${Math.round((d.score ?? 0) * 100)} %${d.correct !== undefined && d.total ? ` (${d.correct}/${d.total})` : ""}${
            d.answers?.length ? ` — ${d.answers.slice(0, 6).map((x) => `${x.q.slice(0, 80)} → ${x.a.slice(0, 80)}${x.ok === true ? " ✓" : x.ok === false ? " ✗" : ""}`).join("; ")}` : ""
          }`;
    if (size + line.length > 3000) break;
    out.push(line);
    size += line.length;
  }
  return out.reverse();
}

/** A plan update that didn't work: the plan stays as it was (ready), the error said. */
export function failPlanUpdate(id: number, error: string): void {
  setCourse(id, { [P.status]: "ready", [P.error]: `Planung aktualisieren: ${error}`.slice(0, 2000) });
}

/** The step whose lesson is this todo (its course and key) — null: none. */
export function lessonOfTodo(todoId: number): { courseId: number; key: string } | null {
  const r = learnRows("steps").find((x) => ids(x.cells[P.lessonTodo]).includes(todoId));
  const courseId = r ? first(r.cells[P.course]) : null;
  return r && courseId ? { courseId, key: keyOf(r) } : null;
}
