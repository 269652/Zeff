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

/** How to write exercise sets for the kit (lib/widgets/spec.ts) — part of the teacher's rules. */
export const KIT_GUIDE = `  Am besten als Übungssatz: spec = { title, intro?, items: [...] } — der eingebaute Baukasten zeigt eine Aufgabe nach der anderen, gibt sofort Rückmeldung, Tipp-Knopf (hint), zweiter Versuch, danach die Lösung und deine Erklärung (explain), am Ende Auswertung mit „Die falschen nochmal üben“, und meldet alles von selbst (Punkte, Antworten, fertig). Fehler im Satz kommen als Fehlermeldung mit jeder Stelle zurück — korrigieren und neu schicken. Text überall mit **fett**, \`Code\` und $Mathe$.
  Jede Aufgabe: { type, q: "die Aufgabe", hint?, explain?, media?: "<svg …>" (eigene Zeichnung, kein Netz), points? } und je nach type:
  · choice: options: [..], answer: 1 (Index) oder [0, 2] (mehrere richtig), why?: [Erklärung je Option]
  · number: answer: 9.81, tol?: 0.05 (absolut) oder rel?: 0.02 (2 %), unit?: "m/s^2", units?: { "cm/s^2": 0.01 } (umrechenbare Einheiten)
  · text: answer: "Photosynthese" oder ["…", "…"], match?: "loose" (Standard: Groß/klein, Akzente, ein Tippfehler) | "keywords" (alle Begriffe müssen vorkommen — für Erklärungen in eigenen Worten, long: true) | "regex" | "exact"
  · formula: answer: "2*x*cos(x^2)", vars?: ["x"] — als Funktion verglichen (2x·cos(x²) = cos(x^2)*2x zählt)
  · cloze: text: "Das {{Mitochondrium|Mitochondrion}} ist das Kraftwerk der {{[Wurzel|*Zelle|Blüte]}}."
  · order: items: [in richtiger Reihenfolge] (Abläufe: Arbeitsschritte auf der Baustelle, Notfallschema, Algorithmus, Unterrichtsphasen)
  · match: pairs: [["Eiche", "Quercus"], …]   · categorize: groups: { "Laubbaum": [..], "Nadelbaum": [..] }
  · hotspot: image: "<svg viewBox…>…</svg>", spots: [{ label: "Herzspitze", x: 40, y: 70 }] (x, y in % des Bildes) — Beschriften: Anatomie, Baumteile, Bauteile, Schaltplan
  · slider: min, max, answer, tol?, unit? (Schätzen)   · table: columns, rows mit Zellen { answer } zum Ausfüllen (Wertetabellen, Mengen, Kalkulation)
  · plot: fn: "a*sin(b*x)", params: { a: { min: 0, max: 3 }, b: {…} }, target?: { a: 2, b: 1 } (Kurve auf die gestrichelte bringen; ohne target: frei erkunden)
  · code: starter?: "function add(a, b) {\\n}", tests: [{ call: "add(2, 3)", expect: 5 }] (JavaScript, läuft sicher im Browser)
  · scenario: nodes: { start: { text, choices: [{ label, to: "b", feedback? }] }, …, gut: { text, end: true, score: 1 } } — Entscheidungen in echten Situationen: Klassenführung, Triage, Gefährdung im Wald, Arbeitsschutz
  · cards: cards: [{ front, back }] (Selbstabfrage)
  Wähle den Typ nach dem Fach: Rechnen → number/formula/table/plot; Begriffe → text/cloze/match/categorize; Abläufe → order; Zeichnungen → hotspot; Handeln und Entscheiden (Lehramt, Medizin, Handwerk, Forst) → scenario; Programmieren → code. Mische 4–8 Aufgaben, vom Leichten zum Schweren.`;

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
- Mach es anschaulich und interaktiv: Übungen und Veranschaulichungen sind Widgets — mcp__zeff__learn_widget (course_id ${c.id}, node_key "${n.key}"), sie erscheinen sofort in der Lerneinheit.
${KIT_GUIDE}
  Eigenes HTML (html statt spec) nur, wenn kein Aufgabentyp passt — eine Simulation, ein 3D-Modell, ein Experiment: ein HTML-Fragment mit <script>. Bibliotheken über "libs" (sonst nichts erreichbar, kein Netzwerk): ${libs}. ZeffKit ist auch dort da (ZeffKit.mount(el, set) für einen Satz darin, ZeffKit.fmt(text) für Text mit $Mathe$, ZeffKit.expr("a*x^2", ["a","x"]) wertet Formeln sicher aus, ZeffKit.check.number/text/formula prüfen Antworten). Melde Ergebnisse mit zeff.report({ score: 0..1, correct, total, answers: [{ q, a, ok }], done: true }) — answers stehen danach in der Zeitleiste. Fange Fehler selbst ab (try/catch); was doch durchrutscht, zeigt das Widget freundlich an.
  Ist eine Übung fertig, kommt das Ergebnis als Nachricht „[Übung … abgeschlossen: …]“ zu dir. Antworte ohne zu warten: kurz besprechen, was nicht saß, und von selbst weitermachen (Erklärung, nächste Übung oder Abschluss) — frag nicht erst, ob es weitergehen soll. Kommt „[Widget … hatte einen Fehler: …]“, entschuldige dich in einem Satz und schick sofort ein korrigiertes Widget.
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
