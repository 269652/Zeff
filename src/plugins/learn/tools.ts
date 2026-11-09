/**
 * What the teacher can do (its MCP tools — mcp.ts registers them): the course's and the step's context, a widget for
 * the lesson, a step mastered, cards to review, the progress. Each answers in plain text for the agent. Server only.
 */
import { checkSpec, specHasMath, specHtml, type ExerciseSet } from "@/lib/widgets/spec";
import { levelOf } from "./game";
import { addCards, addWidget, courseTree, getCourse, getNode, masterNode, nextCourseSteps, nodeWidgets } from "./store";

const course = (id: number) => {
  const c = getCourse(Number(id));
  if (!c) throw new Error(`No course ${id}.`);
  return c;
};
const step = (courseId: number, key: string) => {
  const n = getNode(courseId, String(key));
  if (!n) throw new Error(`No step "${key}" in course ${courseId}.`);
  return n;
};

export function learnContext(a: { course_id: number; node_key?: string }): string {
  const c = course(a.course_id);
  const { nodes, tree } = courseTree(c.id);
  const lines = [`Kurs ${c.id}: ${c.title} — ${Math.round(tree.progress.share * 100)} % (${tree.progress.mastered}/${tree.progress.steps} Steps), ${c.xp} XP, Serie ${c.streak} Tage.`];
  if (a.node_key) {
    const n = step(c.id, a.node_key);
    lines.push(`Einheit "${n.key}": ${n.title} — ${tree.status.get(n.key)}.`, n.summary, ...n.objectives.map((o) => `Ziel: ${o}`));
    const before = n.requires.map((k) => nodes.find((x) => x.key === k)).filter(Boolean);
    if (before.length) lines.push(`Vorher: ${before.map((x) => `${x!.title} (${tree.status.get(x!.key)})`).join(", ")}`);
    const w = nodeWidgets(c.id, n.key);
    if (w.length) lines.push(`Widgets dieser Einheit: ${w.map((x) => `#${x.id} ${x.title}${x.bestScore !== null ? ` (bestes Ergebnis ${Math.round(x.bestScore * 100)} %)` : ""}`).join("; ")}`);
  }
  const mastered = nodes.filter((n) => tree.status.get(n.key) === "mastered" && n.kind === "step").slice(-12);
  if (mastered.length) lines.push(`Zuletzt gemeistert: ${mastered.map((n) => n.title).join(", ")}`);
  return lines.filter(Boolean).join("\n");
}

/**
 * A widget for the lesson: an exercise set (`spec` — the kit renders it: lib/widgets/spec.ts) or a widget of its own
 * (`html`). A set with mistakes is refused with each of them, so the agent fixes it at once.
 */
export function learnWidget(a: { course_id: number; node_key: string; title: string; html?: string; spec?: unknown; libs?: string[] }): string {
  const c = course(a.course_id);
  step(c.id, a.node_key);
  let libs = Array.isArray(a.libs) ? a.libs.map(String) : [];
  let html = String(a.html ?? "");
  let spec = a.spec;
  if (typeof spec === "string" && spec.trim()) {
    try {
      spec = JSON.parse(spec);
    } catch (e) {
      throw new Error(`spec isn't valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (spec !== undefined && spec !== null && spec !== "") {
    const problems = checkSpec(spec);
    if (problems.length) throw new Error(`The exercise set wasn't shown — fix these and send it again:\n- ${problems.join("\n- ")}`);
    const set = spec as ExerciseSet;
    html = specHtml({ ...set, title: set.title ?? String(a.title ?? "") });
    if (specHasMath(set)) libs = [...new Set([...libs, "katex"])];
  } else if (!html.trim()) throw new Error("Give either spec (an exercise set) or html (a widget of your own).");
  const id = addWidget({ courseId: c.id, nodeKey: String(a.node_key), title: String(a.title ?? ""), html, libs });
  return `Widget #${id} is shown in the lesson now. When it's finished its result comes to you as a message; if something breaks in it, you hear of that too — then send a fixed one.`;
}

export function learnMasterStep(a: { course_id: number; node_key: string; evidence?: string }): string {
  const c = course(a.course_id);
  const n = step(c.id, a.node_key);
  const r = masterNode(c.id, n.key, new Date(), String(a.evidence ?? ""));
  if (!r.mastered.length) return `"${n.title}" was mastered already.`;
  const done = r.mastered.filter((k) => k !== n.key).map((k) => getNode(c.id, k)?.title).filter(Boolean);
  return `"${n.title}" mastered: +${r.xp} XP${done.length ? ` (completed with it: ${done.join(", ")})` : ""}${r.badges.length ? `. New badges: ${r.badges.join(", ")}` : ""}.`;
}

export function learnAddCards(a: { course_id: number; node_key: string; cards: { front: string; back: string }[] }): string {
  const c = course(a.course_id);
  step(c.id, a.node_key);
  const n = addCards(c.id, String(a.node_key), Array.isArray(a.cards) ? a.cards : []);
  return `${n} card${n === 1 ? "" : "s"} added — they come back for review when they're due.`;
}

export function learnProgress(a: { course_id: number }): string {
  const c = course(a.course_id);
  const { tree } = courseTree(c.id);
  const l = levelOf(c.xp);
  const next = nextCourseSteps(c.id, 5);
  const paths = [...tree.paths.entries()].map(([p, v]) => `${p} ${v.mastered}/${v.steps}`).join(", ");
  return [
    `Level ${l.level} (${l.into}/${l.need} XP to the next), ${c.xp} XP in all, streak ${c.streak} days, today ${c.today ? c.todayXp : 0}/${c.dailyGoal} XP.`,
    `Progress: ${tree.progress.mastered}/${tree.progress.steps} steps${paths ? ` — paths: ${paths}` : ""}.`,
    next.length ? `Next: ${next.map((n) => `"${n.key}" ${n.title}${n.path ? ` [${n.path}]` : ""}`).join("; ")}` : "Nothing open — the course is done.",
  ].join("\n");
}
