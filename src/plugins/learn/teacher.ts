/**
 * The teacher: a lesson is a chat (src/lib/chat.ts — a live Claude session, kind "learn") on one step of a course. The
 * agent teaches it — explains, asks, builds interactive widgets on the fly (learn_widget), decides when the step is
 * mastered (learn_master_step) and leaves cards to review (learn_add_cards). Its rules are made here from the course and
 * the step; it works in Zeff only, like every chat. Server only.
 */
import { getDb, getSqlite, schema } from "@/db";
import { CHAT_ALLOWED_TOOLS, CHAT_DISALLOWED_TOOLS, chatSource, registerChatProfile } from "@/lib/chat";
import { WIDGET_LIBS } from "@/lib/widgets/sandbox";
import { courseNodes, getCourse, getNode, startNode, type Course, type CourseNode } from "./store";

export const LEARN_KIND = "learn";
export const LEARN_SOURCE = chatSource(LEARN_KIND);

/** The tools a teacher has beside Zeff's own. */
export const LEARN_TOOLS = ["learn_context", "learn_widget", "learn_master_step", "learn_add_cards", "learn_progress"].map((t) => `mcp__zeff__${t}`);

/** The teacher's rules for a step of a course (German, as Zeff's prompts are). */
export function teacherRules(c: Course, n: CourseNode, preamble = ""): string {
  const nodes = courseNodes(c.id);
  const byKey = new Map(nodes.map((x) => [x.key, x]));
  const chain: string[] = [];
  for (let p = n.parent ? byKey.get(n.parent) : undefined; p; p = p.parent ? byKey.get(p.parent) : undefined) chain.unshift(p.title);
  const before = n.requires.map((k) => byKey.get(k)?.title).filter(Boolean);
  const sources = n.sources.map((id) => c.sources.find((s) => s.id === id)).filter(Boolean).map((s) => `- ${s!.title}${s!.url ? ` <${s!.url}>` : ""}`);
  const libs = Object.entries(WIDGET_LIBS).map(([k, v]) => `"${k}" (${v.what})`).join(", ");
  return [
    `Du bist ein geduldiger, begeisternder Lehrer in Zeff — ein Tutor für genau eine Person, die meist am Handy lernt. Kurs: „${c.title || c.topic}“ (Ziel: ${c.goal || "das Thema beherrschen"}; Vorwissen: ${c.level || "unbekannt"}).`,
    `Diese Lerneinheit: „${n.title}“${chain.length ? ` (in: ${chain.join(" › ")})` : ""}.${n.summary ? ` ${n.summary}` : ""}`,
    n.objectives.length ? `Lernziele — am Ende kann die Person:\n${n.objectives.map((o) => `- ${o}`).join("\n")}` : "",
    before.length ? `Vorausgesetzt (schon gelernt): ${before.join(", ")}.` : "",
    sources.length ? `Quellen für diese Einheit:\n${sources.join("\n")}` : "",
    `So unterrichtest du:
- In kleinen Schritten: erkläre kurz, dann lass die Person selbst denken (Fragen, kleine Aufgaben). Prüfe Verständnis, bevor du weitergehst. Knüpfe an das Vorwissen an.
- Antworten kurz und gut lesbar auf dem Handy. Formeln in LaTeX zwischen $…$ oder $$…$$.
- Mach es anschaulich und interaktiv: Baue für Übungen und Veranschaulichungen Widgets mit mcp__zeff__learn_widget (course_id ${c.id}, node_key "${n.key}") — ein vollständiges HTML-Fragment mit <script>, das sofort in der Lerneinheit erscheint. Zum Beispiel ein Quiz mit Rückmeldung, ein Funktionsgraph mit Schiebereglern, eine drehbare 3D-Fläche, Lückentexte, Karteikarten.
  Bibliotheken (über "libs" anfordern, nichts anderes ist erreichbar, kein Netzwerk): ${libs}.
  Melde Ergebnisse aus dem Widget mit zeff.report({ score: 0..1, correct, total, note, done }) — das gibt Punkte. Setze done: true, sobald die Übung fertig ist (alle Aufgaben beantwortet): Dann kommt das Ergebnis als Nachricht „[Übung … abgeschlossen: …]“ zu dir. Darauf antwortest du ohne zu warten: kurz besprechen, was nicht saß, und von selbst mit dem nächsten Teil weitermachen (Erklärung, nächste Übung oder Abschluss der Einheit) — frag nicht erst, ob es weitergehen soll. Halte Widgets klein, robust und schön (große Touch-Ziele).
- Wenn die Lernziele erreicht sind und die Person es gezeigt hat (nicht nur gelesen), schließe die Einheit mit mcp__zeff__learn_master_step (course_id ${c.id}, node_key "${n.key}", evidence: woran du es siehst) und lege 3–8 Wiederholungskarten mit mcp__zeff__learn_add_cards an. Sag dann, was als Nächstes kommen kann (mcp__zeff__learn_progress).
- mcp__zeff__learn_context zeigt dir den Stand des Kurses und dieser Einheit.
- Bleib bei diesem Thema; wenn die Person abschweift, hilf kurz und führe zurück. Schreib am Ende keinen JSON-Block.`,
    preamble,
  ]
    .filter((x) => x.trim())
    .join("\n\n");
}

/** The node a lesson's todo belongs to. */
function lessonOf(todoId: number): { course: Course; node: CourseNode } | null {
  try {
    const r = getSqlite().prepare("select course_id, key from learn_nodes where lesson_todo_id = ?").get(todoId) as { course_id: number; key: string } | undefined;
    if (!r) return null;
    const course = getCourse(r.course_id);
    const node = getNode(r.course_id, r.key);
    return course && node ? { course, node } : null;
  } catch {
    return null;
  }
}

registerChatProfile(LEARN_KIND, (todo, preamble) => {
  const l = lessonOf(todo.id);
  return {
    rules: l ? teacherRules(l.course, l.node, preamble) : `Du bist ein Lehrer in Zeff.\n\n${preamble}`,
    allowedTools: [...CHAT_ALLOWED_TOOLS, ...LEARN_TOOLS],
    disallowedTools: CHAT_DISALLOWED_TOOLS,
  };
});

/** A lesson's own todo (by a worker: not in your list), linked to its step. */
export function addLessonTodo(courseId: number, key: string): number {
  const node = getNode(courseId, key);
  if (!node) throw new Error(`No step "${key}" in this course.`);
  const now = new Date().toISOString();
  const row = getDb()
    .insert(schema.todos)
    .values({ ticket: "", text: `Lernen: ${node.title}`.slice(0, 200), kind: "other", owner: "me", status: "open", source: LEARN_SOURCE, refs: "[]", runId: null, byWorker: true, createdAt: now, updatedAt: now })
    .returning({ id: schema.todos.id })
    .get();
  startNode(courseId, key, row.id);
  return row.id;
}
