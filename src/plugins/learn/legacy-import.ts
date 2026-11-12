/**
 * What the old Learn (a built-in plugin, replaced by the Learn in src/plugins/learn/bundled) kept: its courses, steps (years → phases → skills
 * → steps), exercises, cards, conversations and activity were ordinary Workspace databases with property ids of their own ("learntopic",
 * "learnkey" …). They are read from there and written into the databases of the new Learn's package — the old ones stay untouched. Each learning
 * space (a page holding the old databases) becomes a Space of the new courses. Once. Server only.
 */
import { getPref, setPref } from "@/lib/prefs";
import { cellText, type Property, type Row } from "@/plugins/workspace/model";
import { getInstalled } from "@/plugins/workspace/package-life";
import { LEARN_PLUGIN } from "./setup";
import { addRow, archivePage, getPage, rawRows, tree } from "@/plugins/workspace/store";

const DONE = "learn.legacyImported";
export const legacyDone = (): boolean => !!getPref<string>(DONE, "");

type Old = { id: number; props: Property[]; rows: Row[] };
type OldSpace = { folder: number | null; courses: Old; steps?: Old; cards?: Old; activity?: Old; messages?: Old; exercises?: Old };

/** The databases of the old Learn, found by the property ids it gave them (not by names, which a person may have changed). */
function legacySpaces(): OldSpace[] {
  const dbs = tree().filter((p) => p.kind === "database" && !getPage(p.id)?.archivedAt);
  const by = (...markers: string[]): Old[] =>
    dbs.flatMap((d) => {
      const props = getPage(d.id)?.schema?.properties ?? [];
      return markers.every((m) => props.some((p) => p.id === m)) ? [{ id: d.id, props, rows: rawRows(d.id) }] : [];
    });
  const parentOf = (id: number) => getPage(id)?.parentId ?? null;
  const courses = by("learntopic");
  const lists = { steps: by("learnkey"), cards: by("learnfront"), activity: by("learnevent"), messages: by("learntext"), exercises: by("learnspec") };
  return courses.map((c) => {
    const folder = parentOf(c.id);
    const near = (list: Old[]) => list.find((d) => parentOf(d.id) === folder);
    return { folder, courses: c, steps: near(lists.steps), cards: near(lists.cards), activity: near(lists.activity), messages: near(lists.messages), exercises: near(lists.exercises) };
  });
}

export function hasLegacyLearn(): boolean {
  try {
    return legacySpaces().some((s) => s.courses.rows.length > 0);
  } catch {
    return false;
  }
}

const levelCost = (level: number) => Math.round((100 * Math.pow(1.25, level - 1)) / 10) * 10;
function levelOf(xp: number): number {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (rest >= levelCost(level) && level < 999) rest -= levelCost(level++);
  return level;
}

const text = (props: Property[], row: Row, id: string): string => {
  const p = props.find((x) => x.id === id);
  return p ? cellText(p, row.cells[id]).trim() : "";
};
/** The id of the chosen option of a select cell (not its label, which a person may have translated: "Jahr", "Schritt" …). */
const sel = (row: Row, id: string): string => (typeof row.cells[id] === "string" ? (row.cells[id] as string) : "");
const num = (row: Row, id: string): number | undefined => (typeof row.cells[id] === "number" ? (row.cells[id] as number) : undefined);
const day = (s: string): string => s.slice(0, 10);
const ids = (row: Row, id: string): number[] => (Array.isArray(row.cells[id]) ? (row.cells[id] as unknown[]).map(Number).filter((n) => n > 0) : []);
const json = <T>(s: string, fallback: T): T => {
  try {
    return (JSON.parse(s) as T) ?? fallback;
  } catch {
    return fallback;
  }
};
/** The code a row's page holds (an old exercise of its own: a code block on the row's page). */
function pageCode(rowId: number): string {
  const doc = getPage(rowId)?.content as { content?: { type: string; content?: { text?: string }[] }[] } | undefined;
  const block = doc?.content?.find((n) => n.type === "codeBlock");
  return (block?.content ?? []).map((t) => t.text ?? "").join("");
}

export type LegacyImport = { courses: number; steps: number; cards: number; messages: number; activity: number; exercises: number };

/** The old data into the new databases (the package must be installed). Everything is copied; nothing in the old databases changes. */
export function importLegacyLearn(): LegacyImport {
  const inst = getInstalled(LEARN_PLUGIN);
  if (!inst) throw new Error("The new Learn is not installed yet.");
  const out: LegacyImport = { courses: 0, steps: 0, cards: 0, messages: 0, activity: 0, exercises: 0 };
  const into = { courses: inst.map.i2, steps: inst.map.i3, cards: inst.map.i4, activity: inst.map.i5, messages: inst.map.i9, exercises: inst.map.i10 };
  // The choices of the new databases, by option id (see learn.package.json).
  const STATUS: Record<string, string> = { ready: "o0", researching: "o1", failed: "o2" };
  const KIND: Record<string, string> = { year: "o0", phase: "o1", skill: "o2", step: "o3" };
  const ROLE: Record<string, string> = { teacher: "o0", you: "o1", system: "o2" };
  const MSGKIND: Record<string, string> = { message: "o0", exercise: "o1", mastered: "o2" };

  // The package's starter course ("Differential geometry", a few steps) is only there to show how it works: with courses of your own it goes.
  const seeded = rawRows(into.courses);
  if (seeded.length === 1 && seeded[0].title === "Differential geometry") {
    for (const db of Object.values(into)) for (const r of rawRows(db)) archivePage(r.id);
  }

  const spaces = legacySpaces();
  const several = spaces.length > 1;
  for (const space of spaces) {
    const c = space.courses;
    const spaceName = several ? (getPage(space.folder ?? 0)?.title ?? "").slice(0, 60) : "";
    const courseOf = new Map<number, { id: number; title: string }>();
    for (const r of c.rows) {
      const sources = json<{ id?: string; title?: string; authors?: string; year?: number; url?: string }[]>(text(c.props, r, "learnsources") || "[]", [])
        .filter((s) => s?.title)
        .map((s) => `${s.id ?? ""} | ${s.title}${s.authors ? ` - ${s.authors}` : ""}${s.year ? ` (${s.year})` : ""} | ${s.url ?? ""}`)
        .join("\n");
      const slots = json<{ day?: number; time?: string; minutes?: number }[]>(text(c.props, r, "learnslots") || "[]", [])
        .filter((s) => Number(s?.day) >= 1 && Number(s?.day) <= 7)
        .map((s) => ({ day: Number(s.day) - 1, time: s.time, minutes: s.minutes ?? 30 }));
      const problems = json<unknown[]>(text(c.props, r, "learnproblems") || "[]", []).map(String).join("\n");
      const xp = num(r, "learnxp") ?? 0;
      const newId = addRow(into.courses, {
        title: r.title,
        cells: {
          topic: text(c.props, r, "learntopic"),
          goal: text(c.props, r, "learngoal"),
          prior: text(c.props, r, "learnlevel"),
          space: spaceName,
          status: STATUS[sel(r, "learnstatus")] ?? "o0",
          error: text(c.props, r, "learnerror"),
          summary: text(c.props, r, "learnsummary"),
          years: num(r, "learnyears") ?? 0,
          sources,
          problems,
          interests: text(c.props, r, "learninterests") || "{}",
          dailygoal: num(r, "learndailygoal") ?? 50,
          slots: JSON.stringify(slots),
          xp,
          level: levelOf(xp),
          streak: num(r, "learnstreak") ?? 0,
          lastday: day(text(c.props, r, "learnlastday")),
          todayxp: num(r, "learntodayxp") ?? 0,
          badges: Array.isArray(r.cells["learnbadges"]) ? r.cells["learnbadges"] : [],
        },
      });
      courseOf.set(r.id, { id: newId, title: r.title });
      out.courses++;
    }
    // Steps: the plan as it was — kind, place (parent key), requirements (keys), path, points, sources, progress.
    const stepOf = new Map<number, { title: string; key: string }>();
    if (space.steps) {
      const s = space.steps;
      const keyOf = new Map(s.rows.map((r) => [r.id, text(s.props, r, "learnkey")]));
      for (const r of s.rows) {
        const key = text(s.props, r, "learnkey");
        const course = ids(r, "learncourse").map((o) => courseOf.get(o)?.id).filter((x): x is number => !!x);
        const mastered = r.cells["learnmastered"] === true;
        addRow(into.steps, {
          title: r.title,
          cells: {
            course,
            kind: KIND[sel(r, "learnkind")] ?? "o3",
            key,
            parent: ids(r, "learnparent").map((o) => keyOf.get(o) ?? "")[0] ?? "",
            requires: ids(r, "learnrequires").map((o) => keyOf.get(o) ?? "").filter(Boolean).join(", "),
            summary: text(s.props, r, "learnsummary"),
            objectives: text(s.props, r, "learnobjectives").replace(/^\[|\]$/g, "").replace(/","/g, "; ").replace(/"/g, ""),
            path: text(s.props, r, "learnpath"),
            points: num(r, "learnxp"),
            minutes: num(r, "learnminutes") ?? 0,
            sourceids: text(s.props, r, "learnsourceids"),
            order: num(r, "learnorder") ?? 0,
            mastered,
            masteredat: day(text(s.props, r, "learnmasteredat")),
            awarded: r.cells["learnawarded"] === true || mastered,
            begun: !!text(s.props, r, "learnactivesince") || mastered,
          },
        });
        stepOf.set(r.id, { title: r.title, key });
        out.steps++;
      }
    }
    const stepTitle = (r: Row) => stepOf.get(ids(r, "learnstep")[0])?.title ?? "";
    if (space.cards) {
      for (const r of space.cards.rows) {
        addRow(into.cards, { title: r.title, cells: { back: text(space.cards.props, r, "learnback"), step: stepTitle(r), reps: num(r, "learnreps") ?? 0, lapses: num(r, "learnlapses") ?? 0, ease: num(r, "learnease") ?? 2.5, interval: num(r, "learninterval") ?? 0, due: day(text(space.cards.props, r, "learndue")) || "2020-01-01", last: day(text(space.cards.props, r, "learnlast")) } });
        out.cards++;
      }
    }
    if (space.exercises) {
      // The exercises: an exercise set (JSON) for the kit, or code of its own (on the row's page) with its libraries; the best score and the points given.
      for (const r of space.exercises.rows) {
        const spec = text(space.exercises.props, r, "learnspec");
        const libs = Array.isArray(r.cells["learnlibs"]) ? (r.cells["learnlibs"] as string[]).join(",") : "";
        addRow(into.exercises, { title: r.title, cells: { step: stepTitle(r), html: spec ? "" : pageCode(r.id), spec, libs, best: num(r, "learnbest") ?? 0, xp: num(r, "learnxp") ?? 0 } });
        out.exercises++;
      }
    }
    if (space.messages) {
      for (const r of space.messages.rows) {
        const full = text(space.messages.props, r, "learntext") || r.title;
        addRow(into.messages, { title: r.title, cells: { text: full, step: stepTitle(r), role: ROLE[sel(r, "learnrole")] ?? "o2", kind: MSGKIND[sel(r, "learnmsgkind")] ?? "o0", run: num(r, "learnrun"), at: day(text(space.messages.props, r, "learnat")), order: num(r, "learnseq") ?? 0 } });
        out.messages++;
      }
    }
    if (space.activity) {
      for (const r of space.activity.rows) {
        addRow(into.activity, { title: text(space.activity.props, r, "learnevent") || r.title, cells: { at: day(text(space.activity.props, r, "learnat")), xp: num(r, "learnxp") ?? 0, detail: r.title } });
        out.activity++;
      }
    }
  }
  setPref(DONE, new Date().toISOString());
  return out;
}
