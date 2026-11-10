/**
 * Where Learn keeps its data: ordinary Workspace databases in a folder page "Learn" ("Lernen"), made once per account — Courses,
 * Steps (the plan's nodes with your progress), Exercises (the teacher's widgets), Activity (what you earned: mastered, exercises,
 * reviews), Cards (spaced repetition) and Conversations (each lesson's messages, one row per message). They are the source of truth:
 * the Learn pages read them, its tools write them, and what you change in them (a step ticked mastered, a title, a message
 * deleted) is what Learn goes on with. Their ids are kept in the pref `learn.databases`; their properties have fixed ids (learn…)
 * and are marked as the plugin's (schema.owner): you may add your own properties and views, not remove these. Server only.
 */
import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { WIDGET_LIBS } from "@/lib/widgets/sandbox";
import { createPage, getDatabase, getPage, rawRows, restorePage, setOwner, updateSchema } from "@/plugins/workspace/store";
import { newView, type DbSchema, type Property, type Row, type View } from "@/plugins/workspace/model";
import { BADGES } from "./game";

/** The property ids Learn relies on (the same id may be used in several of its databases). */
export const P = {
  // Links between the databases
  course: "learncourse",
  step: "learnstep",
  exercise: "learnexercise",
  card: "learncard",
  /** The id a row had in Learn's own tables before the move (old links, old sessions' course_id). */
  legacy: "learnlegacy",
  // Courses
  topic: "learntopic",
  goal: "learngoal",
  level: "learnlevel",
  status: "learnstatus",
  summary: "learnsummary",
  years: "learnyears",
  sources: "learnsources",
  problems: "learnproblems",
  error: "learnerror",
  interests: "learninterests",
  dailyGoal: "learndailygoal",
  xp: "learnxp",
  streak: "learnstreak",
  lastDay: "learnlastday",
  today: "learntoday",
  todayXp: "learntodayxp",
  badges: "learnbadges",
  slots: "learnslots",
  reviewTodo: "learnreviewtodo",
  // Steps
  key: "learnkey",
  kind: "learnkind",
  parent: "learnparent",
  requires: "learnrequires",
  objectives: "learnobjectives",
  path: "learnpath",
  minutes: "learnminutes",
  sourceIds: "learnsourceids",
  order: "learnorder",
  mastered: "learnmastered",
  masteredAt: "learnmasteredat",
  activeSince: "learnactivesince",
  lessonTodo: "learnlessontodo",
  // Exercises
  spec: "learnspec",
  libs: "learnlibs",
  best: "learnbest",
  run: "learnrun",
  // Activity
  event: "learnevent",
  at: "learnat",
  score: "learnscore",
  detail: "learndetail",
  snapshot: "learnsnapshot",
  stepKey: "learnstepkey",
  // Cards
  front: "learnfront",
  back: "learnback",
  reps: "learnreps",
  lapses: "learnlapses",
  ease: "learnease",
  interval: "learninterval",
  due: "learndue",
  last: "learnlast",
  // Conversations
  role: "learnrole",
  msgKind: "learnmsgkind",
  text: "learntext",
  seq: "learnseq",
} as const;

export type LearnDbs = { folder: number; courses: number; steps: number; exercises: number; activity: number; cards: number; messages: number };
type Which = Exclude<keyof LearnDbs, "folder">;
const PREF = "learn.databases";

const opt = (id: string, name: string, color = "gray") => ({ id, name, color });
const prop = (id: string, name: string, type: Property["type"], more: Partial<Property> = {}): Property => ({ id, name, type, ...more });

/** Each database's properties (relations point at the databases by name, filled in when they're made). */
function specs(): Record<Which, { title: string; icon: string; titleName: string; props: (Property & { to?: Which })[]; hidden: string[]; sort?: { prop: string; dir: "asc" | "desc" } }> {
  const rel = (id: string, name: string, to: Which) => ({ ...prop(id, name, "relation"), to });
  const when = (id: string, name: string) => prop(id, name, "date", { includeTime: true });
  const course = rel(P.course, t("Course"), "courses");
  const step = rel(P.step, t("Step"), "steps");
  const legacy = prop(P.legacy, t("Old id"), "number");
  return {
    courses: {
      title: t("Courses"),
      icon: "🎓",
      titleName: t("Course"),
      props: [
        prop(P.topic, t("Topic"), "text"),
        prop(P.goal, t("Goal"), "text"),
        prop(P.level, t("Prior knowledge"), "text"),
        prop(P.status, t("Status"), "select", { options: [opt("researching", t("researching"), "yellow"), opt("ready", t("ready"), "green"), opt("failed", t("failed"), "red")] }),
        prop(P.summary, t("Summary"), "text"),
        prop(P.years, t("Years"), "number"),
        prop(P.xp, t("XP"), "number"),
        prop(P.streak, t("Streak (days)"), "number"),
        prop(P.lastDay, t("Last day learned"), "date"),
        prop(P.today, t("Today"), "date"),
        prop(P.todayXp, t("XP today"), "number"),
        prop(P.dailyGoal, t("Daily goal (XP)"), "number"),
        prop(P.badges, t("Badges"), "multi_select", { options: BADGES.map((b) => opt(b.id, b.id, "purple")) }),
        prop(P.interests, t("Interests (JSON)"), "text"),
        prop(P.slots, t("Study times (JSON)"), "text"),
        prop(P.sources, t("Sources (JSON)"), "text"),
        prop(P.problems, t("Plan notes (JSON)"), "text"),
        prop(P.error, t("Error"), "text"),
        prop(P.reviewTodo, t("Review todo"), "todo"),
        legacy,
      ],
      hidden: [P.interests, P.slots, P.sources, P.problems, P.error, P.reviewTodo, P.legacy, P.today, P.todayXp],
    },
    steps: {
      title: t("Steps"),
      icon: "🪜",
      titleName: t("Step"),
      props: [
        course,
        prop(P.kind, t("Kind"), "select", { options: [opt("year", t("year"), "purple"), opt("phase", t("phase"), "blue"), opt("skill", t("skill"), "orange"), opt("step", t("step"), "gray")] }),
        prop(P.mastered, t("Mastered"), "checkbox"),
        when(P.masteredAt, t("Mastered at")),
        when(P.activeSince, t("Begun at")),
        prop(P.key, t("Key"), "text"),
        rel(P.parent, t("Part of"), "steps"),
        rel(P.requires, t("Requires"), "steps"),
        prop(P.summary, t("Summary"), "text"),
        prop(P.objectives, t("Objectives"), "text"),
        prop(P.path, t("Path"), "text"),
        prop(P.xp, t("XP"), "number"),
        prop(P.minutes, t("Minutes"), "number"),
        prop(P.sourceIds, t("Sources"), "text"),
        prop(P.order, t("Order"), "number"),
        prop(P.lessonTodo, t("Lesson todo"), "todo"),
      ],
      hidden: [P.key, P.order, P.sourceIds, P.lessonTodo],
      sort: { prop: P.order, dir: "asc" },
    },
    exercises: {
      title: t("Exercises"),
      icon: "🧩",
      titleName: t("Exercise"),
      props: [
        course,
        step,
        prop(P.best, t("Best score"), "number", { format: "percent" }),
        prop(P.xp, t("XP"), "number"),
        prop(P.libs, t("Libraries"), "multi_select", { options: Object.keys(WIDGET_LIBS).map((k) => opt(k, k, "blue")) }),
        prop(P.spec, t("Exercise set (JSON)"), "text"),
        prop(P.run, t("Session"), "number"),
        legacy,
      ],
      hidden: [P.spec, P.run, P.legacy],
    },
    activity: {
      title: t("Activity"),
      icon: "📈",
      titleName: t("What"),
      props: [
        prop(P.event, t("Kind"), "select", { options: [opt("mastered", t("mastered"), "green"), opt("widget", t("exercise"), "blue"), opt("review", t("review"), "orange")] }),
        when(P.at, t("When")),
        prop(P.xp, t("XP"), "number"),
        course,
        step,
        rel(P.exercise, t("Exercise"), "exercises"),
        rel(P.card, t("Card"), "cards"),
        prop(P.score, t("Score"), "number", { format: "percent" }),
        prop(P.stepKey, t("Step key"), "text"),
        prop(P.snapshot, t("Snapshot"), "number"),
        prop(P.detail, t("Details (JSON)"), "text"),
        legacy,
      ],
      hidden: [P.stepKey, P.snapshot, P.detail, P.legacy],
      sort: { prop: P.at, dir: "desc" },
    },
    cards: {
      title: t("Cards"),
      icon: "🗂️",
      titleName: t("Front"),
      props: [
        prop(P.back, t("Back"), "text"),
        when(P.due, t("Due")),
        course,
        step,
        prop(P.reps, t("Reviews"), "number"),
        prop(P.lapses, t("Lapses"), "number"),
        prop(P.ease, t("Ease"), "number"),
        prop(P.interval, t("Interval (days)"), "number"),
        when(P.last, t("Last reviewed")),
        prop(P.front, t("Front (long)"), "text"),
        legacy,
      ],
      hidden: [P.front, P.legacy, P.ease],
      sort: { prop: P.due, dir: "asc" },
    },
    messages: {
      title: t("Conversations"),
      icon: "💬",
      titleName: t("Message"),
      props: [
        prop(P.role, t("Who"), "select", { options: [opt("you", t("you"), "blue"), opt("teacher", t("teacher"), "green"), opt("system", t("system"), "gray")] }),
        prop(P.text, t("Text"), "markdown"),
        when(P.at, t("Time")),
        course,
        step,
        prop(P.msgKind, t("Kind"), "select", { options: [opt("message", t("message")), opt("exercise", t("exercise"), "blue"), opt("mastered", t("mastered"), "green")] }),
        rel(P.exercise, t("Exercise"), "exercises"),
        prop(P.run, t("Session"), "number"),
        prop(P.seq, t("Order"), "number"),
      ],
      hidden: [P.run, P.seq, P.exercise],
      sort: { prop: P.at, dir: "asc" },
    },
  };
}

const ORDER: Which[] = ["courses", "steps", "exercises", "activity", "cards", "messages"];

// ---------------------------------------------------------------------------------------------------------------------
// Reading the databases' rows: once per change of the account's database (not per node, per call)
// ---------------------------------------------------------------------------------------------------------------------

type Memo = Map<string, { stamp: string; value: unknown }>;
const memos = new WeakMap<object, Memo>();

/** What changed in the account's database since: this connection's writes (total_changes) and others' (data_version). */
function stamp(): { d: ReturnType<typeof getSqlite>; s: string } {
  const d = getSqlite();
  const n = (d.prepare("select total_changes() as n").get() as { n: number }).n;
  const v = d.pragma("data_version", { simple: true }) as number;
  return { d, s: `${n}:${v}` };
}

/** `fn`'s value kept until anything in the account's database changes (computed once per page, not per node). */
export function memo<T>(key: string, fn: () => T): T {
  const { d, s } = stamp();
  let m = memos.get(d);
  if (!m) memos.set(d, (m = new Map()));
  const hit = m.get(key);
  if (hit && hit.stamp === s) return hit.value as T;
  const value = fn();
  // (Made something itself — the databases: the stamp after it, else the next read would compute it once more.)
  m.set(key, { stamp: stamp().s, value });
  return value;
}

/** A Learn database's rows (as stored; read once until something changes). Don't change what comes back. */
export const learnRows = (which: Which): Row[] => {
  const id = learnDbs()[which];
  return memo(`rows:${id}`, () => rawRows(id));
};

// ---------------------------------------------------------------------------------------------------------------------
// Made once per account (and repaired: a property of a newer version added, a database gone made again)
// ---------------------------------------------------------------------------------------------------------------------

const known = new WeakMap<object, LearnDbs>();

/** The databases (made the first time they're needed; checked to be there at each call — one query). */
export function learnDbs(): LearnDbs {
  const d = getSqlite();
  const k = known.get(d);
  if (k) {
    const ids = [k.folder, ...ORDER.map((w) => k[w])];
    const n = (d.prepare(`select count(*) as n from ws_pages where archived_at is null and id in (${ids.map(() => "?").join(",")})`).get(...ids) as { n: number }).n;
    if (n === ids.length) return k;
  }
  const v = ensureLearnDatabases();
  known.set(d, v);
  return v;
}

/** The ids kept (null: not made yet in this account). */
export const knownLearnDbs = (): LearnDbs | null => getPref<LearnDbs | null>(PREF, null);

const live = (id: number | undefined): boolean => {
  if (!id) return false;
  const p = getPage(id);
  if (!p) return false;
  if (p.archivedAt) restorePage(id); // (trashed while the plugin was off: back — it holds your progress)
  return true;
};

export function ensureLearnDatabases(): LearnDbs {
  const had = knownLearnDbs();
  const s = specs();
  const ids: Partial<LearnDbs> = {};
  ids.folder = had && live(had.folder) ? had.folder : createPage({ title: t("Learn"), icon: "🎓" });
  for (const w of ORDER) {
    const id = had?.[w];
    ids[w] = id && live(id) && getDatabase(id) ? id : createPage({ parentId: ids.folder, kind: "database", title: s[w].title, icon: s[w].icon, schema: { titleName: s[w].titleName, properties: [], views: [newView(t("Table"), "table")] } as DbSchema });
  }
  const all = ids as LearnDbs;
  if (!had || ORDER.some((w) => had[w] !== all[w]) || had.folder !== all.folder) setPref(PREF, all);
  // Each database's properties: the plugin's (with their relations' targets), the ones you added after them; its mark.
  for (const w of ORDER) {
    const spec = s[w];
    const cur = getDatabase(all[w])!.schema;
    const want = spec.props.map(({ to, ...p }) => (to ? { ...p, relationDb: all[to] } : p));
    let changed = false;
    const props = [...cur.properties];
    for (const p of want) {
      const at = props.findIndex((x) => x.id === p.id);
      if (at < 0) {
        props.push(p);
        changed = true;
        continue;
      }
      const x = props[at];
      // (Options of a newer version — a badge, a library — added; yours kept. A relation pointing at the database it should.)
      const missing = (p.options ?? []).filter((o) => !x.options?.some((y) => y.id === o.id));
      const relFix = p.type === "relation" && x.relationDb !== p.relationDb;
      if (missing.length || relFix || x.type !== p.type) {
        props[at] = { ...x, type: p.type, ...(missing.length ? { options: [...(x.options ?? []), ...missing] } : {}), ...(p.type === "relation" ? { relationDb: p.relationDb } : {}) };
        changed = true;
      }
    }
    let views = cur.views;
    const fresh = !cur.properties.length;
    if (fresh) {
      const v: View = { ...newView(t("Table"), "table"), hidden: spec.hidden, ...(spec.sort ? { sorts: [spec.sort] } : {}) };
      views = [v];
    }
    if (changed || fresh) updateSchema(all[w], { ...cur, titleName: fresh ? spec.titleName : cur.titleName, properties: props, views, dayList: false });
    const owner = getDatabase(all[w])!.schema.owner;
    const propIds = spec.props.map((p) => p.id);
    if (!owner || owner.plugin !== "learn" || propIds.some((id) => !owner.props.includes(id))) setOwner(all[w], { plugin: "learn", props: propIds });
  }
  return all;
}
