/**
 * Learn in the demo (src/lib/demo.ts): a course on differential geometry as it looks a week in — a branched skill tree
 * with the foundations mastered, a lesson under way (two exercises the teacher built, your tries with every answer, the
 * talk with the teacher), a streak, badges and cards to review. No AI runs: the lesson's talk is a kept log. Server only.
 */
import fs from "node:fs";
import path from "node:path";
import { setInstalled } from "@/plugins/state";
import { addTodoInstruction } from "@/lib/todos/store";
import { createRun, updateRun } from "@/lib/work/store";
import { logPath } from "@/lib/work/log";
import * as store from "./store";
import { addLessonTodo } from "./teacher";
import katex from "katex";

type Lang = "de" | "en";
type Text = Record<Lang, string>;

const daysAgo = (n: number, hh = 19, mm = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hh, mm, 0, 0);
  return d;
};

const step = (key: string, parent: string, title: Text, lang: Lang, extra: { requires?: string[]; minutes?: number; summary?: Text } = {}) => ({
  key,
  kind: "step",
  parent,
  title: title[lang],
  requires: extra.requires ?? [],
  minutes: extra.minutes ?? 30,
  ...(extra.summary ? { summary: extra.summary[lang] } : {}),
});

function plan(lang: Lang) {
  const L = (de: string, en: string): Text => ({ de, en });
  const s = (key: string, parent: string, title: Text, pathName: Text, requires: string[] = []) => ({ key, kind: "skill", parent, title: title[lang], path: pathName[lang], requires });
  const BASICS = L("Grundlagen", "Foundations");
  const SEE = L("Anschauung", "Intuition");
  const CALC = L("Rechnen", "Computation");
  const THEORY = L("Theorie", "Theory");
  const PHYS = L("Physik", "Physics");
  return {
    title: L("Differentialgeometrie: von Kurven zu Flächen", "Differential geometry: from curves to surfaces")[lang],
    summary: L(
      "Von den Grundlagen der linearen Algebra und Analysis über Kurven und Flächen bis zu Mannigfaltigkeiten — mit Anschauung, Rechnen und Theorie als Pfaden.",
      "From the foundations in linear algebra and calculus through curves and surfaces to manifolds — with intuition, computation and theory as paths.",
    )[lang],
    years: 2,
    sources: [
      { id: "s1", title: "Manfredo do Carmo — Differential Geometry of Curves and Surfaces", year: 1976, kind: "book" },
      { id: "s2", title: "Christian Bär — Elementare Differentialgeometrie", year: 2010, kind: "book" },
      { id: "s3", title: "John M. Lee — Introduction to Riemannian Manifolds", year: 2018, kind: "book" },
      { id: "s4", title: "Keenan Crane — Discrete Differential Geometry (CMU course notes)", year: 2023, kind: "course", url: "https://www.cs.cmu.edu/~kmcrane/Projects/DDG/" },
    ],
    nodes: [
      { key: "y1", kind: "year", parent: null, title: L("Jahr 1: Kurven und Flächen", "Year 1: curves and surfaces")[lang] },
      { key: "p1", kind: "phase", parent: "y1", title: L("Grundlagen", "Foundations")[lang], summary: L("Was man für alles Weitere braucht.", "What everything after needs.")[lang] },
      s("linalg", "p1", L("Lineare Algebra", "Linear algebra"), BASICS),
      step("linalg.a", "linalg", L("Vektorräume, Basis, Dimension", "Vector spaces, basis, dimension"), lang, { minutes: 40 }),
      step("linalg.b", "linalg", L("Lineare Abbildungen und Matrizen", "Linear maps and matrices"), lang, { minutes: 40, requires: ["linalg.a"] }),
      step("linalg.c", "linalg", L("Skalarprodukt und Orthogonalität", "Inner product and orthogonality"), lang, { requires: ["linalg.a"] }),
      s("calc", "p1", L("Analysis mehrerer Variablen", "Multivariable calculus"), BASICS),
      step("calc.a", "calc", L("Partielle Ableitungen", "Partial derivatives"), lang),
      step("calc.b", "calc", L("Kettenregel", "The chain rule"), lang, { requires: ["calc.a"] }),
      step("calc.c", "calc", L("Implizite Funktionen", "Implicit functions"), lang, { requires: ["calc.b"], minutes: 45 }),
      { key: "p2", kind: "phase", parent: "y1", title: L("Kurven", "Curves")[lang], requires: ["p1"], summary: L("Bogenlänge, Krümmung, Torsion.", "Arc length, curvature, torsion.")[lang] },
      s("plane", "p2", L("Ebene Kurven", "Plane curves"), SEE),
      step("plane.a", "plane", L("Parametrisierte Kurven", "Parametrised curves"), lang),
      step("plane.b", "plane", L("Bogenlänge", "Arc length"), lang, { requires: ["plane.a"] }),
      step("plane.c", "plane", L("Krümmung ebener Kurven", "Curvature of plane curves"), lang, {
        requires: ["plane.b"],
        minutes: 45,
        summary: L("Wie stark sich eine Kurve biegt: κ, der Schmiegekreis und warum eine Gerade κ = 0 hat.", "How much a curve bends: κ, the osculating circle and why a line has κ = 0."),
      }),
      s("space", "p2", L("Raumkurven", "Space curves"), SEE, ["plane"]),
      step("space.a", "space", L("Frenet-Rahmen", "The Frenet frame"), lang),
      step("space.b", "space", L("Torsion", "Torsion"), lang, { requires: ["space.a"] }),
      s("num", "p2", L("Kurven numerisch", "Curves numerically"), CALC),
      step("num.a", "num", L("Kurven diskretisieren", "Discretising curves"), lang),
      step("num.b", "num", L("Krümmung aus Messpunkten", "Curvature from data points"), lang, { requires: ["num.a"] }),
      { key: "p3", kind: "phase", parent: "y1", title: L("Flächen", "Surfaces")[lang], requires: ["p2"] },
      s("ff", "p3", L("Erste Fundamentalform", "First fundamental form"), THEORY),
      step("ff.a", "ff", L("Tangentialebene", "The tangent plane"), lang),
      step("ff.b", "ff", L("Längen und Winkel auf Flächen", "Lengths and angles on surfaces"), lang, { requires: ["ff.a"] }),
      s("gauss", "p3", L("Gaußkrümmung", "Gaussian curvature"), SEE, ["ff"]),
      step("gauss.a", "gauss", L("Hauptkrümmungen", "Principal curvatures"), lang),
      step("gauss.b", "gauss", L("Gaußkrümmung anschaulich", "Gaussian curvature, seen"), lang, { requires: ["gauss.a"] }),
      s("minimal", "p3", L("Minimalflächen", "Minimal surfaces"), PHYS, ["ff"]),
      step("minimal.a", "minimal", L("Seifenhäute", "Soap films"), lang),
      step("minimal.b", "minimal", L("Mittlere Krümmung null", "Zero mean curvature"), lang, { requires: ["minimal.a"] }),
      s("egregium", "p3", L("Theorema egregium", "Theorema egregium"), THEORY, ["gauss"]),
      step("egregium.a", "egregium", L("Gauß' erstaunlicher Satz", "Gauss's remarkable theorem"), lang, { minutes: 60 }),
      { key: "y2", kind: "year", parent: null, title: L("Jahr 2: Mannigfaltigkeiten", "Year 2: manifolds")[lang], requires: ["y1"] },
      { key: "p4", kind: "phase", parent: "y2", title: L("Glatte Mannigfaltigkeiten", "Smooth manifolds")[lang] },
      s("charts", "p4", L("Karten und Atlanten", "Charts and atlases"), THEORY),
      step("charts.a", "charts", L("Topologische Mannigfaltigkeiten", "Topological manifolds"), lang),
      step("charts.b", "charts", L("Glatte Strukturen", "Smooth structures"), lang, { requires: ["charts.a"] }),
      s("riemann", "p4", L("Riemannsche Metriken", "Riemannian metrics"), SEE, ["charts"]),
      step("riemann.a", "riemann", L("Metriken auf Mannigfaltigkeiten", "Metrics on manifolds"), lang),
    ],
  };
}

/** The first exercise: the curvature of circles — typed in, checked, every answer reported. */
const circleQuiz = (lang: Lang) => {
  const q = lang === "de" ? ["Radius 2", "Radius 0,5", "Gerade (Radius → ∞)"] : ["radius 2", "radius 0.5", "a line (radius → ∞)"];
  return `<div style="font:16px system-ui;padding:14px;line-height:1.5">
<p style="margin:0 0 8px">${lang === "de" ? "Die Krümmung eines Kreises mit Radius" : "The curvature of a circle of radius"} <span id="f"></span>. ${lang === "de" ? "Wie groß ist κ für …" : "What is κ for …"}</p>
<div id="qs"></div>
<button id="go" style="margin-top:10px;padding:8px 14px;border-radius:8px;border:0;background:#4f46e5;color:#fff;font:inherit">${lang === "de" ? "Prüfen" : "Check"}</button>
<p id="out" style="margin:10px 0 0;font-weight:600"></p>
<script>
katex.render("r:\\\\;\\\\kappa = \\\\tfrac{1}{r}", document.getElementById("f"));
var Q = ${JSON.stringify(q)}, A = [0.5, 2, 0];
var box = document.getElementById("qs");
Q.forEach(function (t, i) { box.insertAdjacentHTML("beforeend", '<label style="display:flex;gap:8px;align-items:center;margin:6px 0">' + t + ': κ = <input id="a' + i + '" size="6" style="font:inherit;padding:4px 6px;border:1px solid #ccc;border-radius:6px"></label>'); });
document.getElementById("go").onclick = function () {
  var answers = Q.map(function (t, i) { var v = document.getElementById("a" + i).value.trim(); var n = parseFloat(v.replace(",", ".")); return { q: t, a: v || "—", ok: Math.abs(n - A[i]) < 1e-6 }; });
  var right = answers.filter(function (x) { return x.ok; }).length;
  document.getElementById("out").textContent = right + " / " + Q.length;
  zeff.report({ correct: right, total: Q.length, answers: answers, note: "κ = 1/r", done: true });
};
</script></div>`;
};

/** How the quiz looked after a try (what its bridge would have kept): the formula typeset, the answers typed, the score. */
const quizSnapshot = (lang: Lang, typed: string[], right: number) => {
  const q = lang === "de" ? ["Radius 2", "Radius 0,5", "Gerade (Radius → ∞)"] : ["radius 2", "radius 0.5", "a line (radius → ∞)"];
  const formula = katex.renderToString("r:\\;\\kappa = \\tfrac{1}{r}", { throwOnError: false });
  return `<div style="font:16px system-ui;padding:14px;line-height:1.5"><p style="margin:0 0 8px">${lang === "de" ? "Die Krümmung eines Kreises mit Radius" : "The curvature of a circle of radius"} ${formula}. ${lang === "de" ? "Wie groß ist κ für …" : "What is κ for …"}</p><div>${q.map((t, i) => `<label style="display:flex;gap:8px;align-items:center;margin:6px 0">${t}: κ = <input size="6" value="${typed[i]}" style="font:inherit;padding:4px 6px;border:1px solid #ccc;border-radius:6px"></label>`).join("")}</div><button style="margin-top:10px;padding:8px 14px;border-radius:8px;border:0;background:#4f46e5;color:#fff;font:inherit">${lang === "de" ? "Prüfen" : "Check"}</button><p style="margin:10px 0 0;font-weight:600">${right} / 3</p></div>`;
};

/** The second: the osculating circle of a parabola, moved along it — JSXGraph. */
const osculating = (lang: Lang) => `<div style="font:15px system-ui;padding:10px">
<div id="box" style="width:100%;height:320px"></div>
<p id="k" style="margin:6px 0 0"></p>
<button id="done" style="margin-top:8px;padding:7px 12px;border-radius:8px;border:0;background:#4f46e5;color:#fff;font:inherit">${lang === "de" ? "Verstanden" : "Got it"}</button>
<script>
var b = JXG.JSXGraph.initBoard("box", { boundingbox: [-4.5, 5, 4.5, -1], keepaspectratio: true, axis: true, showCopyright: false, showNavigation: false });
var f = function (x) { return 0.5 * x * x; };
b.create("curve", [function (t) { return t; }, function (t) { return f(t); }, -3.2, 3.2], { strokeColor: "#4f46e5", strokeWidth: 3 });
var s = b.create("slider", [[-4, 4.5], [-0.8, 4.5], [-2, 0.8, 2]], { name: "t" });
var P = b.create("point", [function () { return s.Value(); }, function () { return f(s.Value()); }], { name: "P", color: "#ec4899" });
var kappa = function () { var x = s.Value(); return 1 / Math.pow(1 + x * x, 1.5); };
var C = b.create("point", [function () { var x = s.Value(); return x - x * (1 + x * x); }, function () { var x = s.Value(); return f(x) + (1 + x * x); }], { visible: false });
b.create("circle", [C, function () { return 1 / kappa(); }], { strokeColor: "#f59e0b", strokeWidth: 2, dash: 2 });
var show = function () { document.getElementById("k").textContent = "κ(" + s.Value().toFixed(2) + ") = " + kappa().toFixed(3) + "  ·  r = " + (1 / kappa()).toFixed(2); };
b.on("update", show); show();
document.getElementById("done").onclick = function () { zeff.report({ score: 1, note: "${lang === "de" ? "Schmiegekreis an der Parabel" : "osculating circle of a parabola"}", answers: [{ q: "κ(" + s.Value().toFixed(2) + ")", a: kappa().toFixed(3), ok: true }], done: true }); };
</script></div>`;

/** The lesson's talk, as the teacher's session would have logged it (stream-json lines). */
function lessonLog(lang: Lang, results: string[]): string {
  const say = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
  const tool = (name: string, id: string) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name: `mcp__zeff__${name}`, input: {} }] } });
  const you = (text: string) => ({ type: "user", isReplay: true, message: { content: text } });
  const de = lang === "de";
  const lines = [
    you(de ? "Lass uns anfangen: „Krümmung ebener Kurven“." : "Let's begin: “Curvature of plane curves”."),
    tool("learn_context", "c1"),
    say(
      de
        ? "Schön, dass du da bist! Heute geht es darum, **wie stark sich eine Kurve biegt**.\n\nFür eine nach Bogenlänge parametrisierte Kurve $\\gamma(s)$ ist die Krümmung\n\n$$\\kappa(s) = \\lVert \\gamma''(s) \\rVert .$$\n\nAm einfachsten sieht man es am Kreis: Je kleiner der Radius, desto stärker die Biegung — es gilt $\\kappa = \\tfrac{1}{r}$."
        : "Good to have you! Today is about **how much a curve bends**.\n\nFor a curve parametrised by arc length, $\\gamma(s)$, the curvature is\n\n$$\\kappa(s) = \\lVert \\gamma''(s) \\rVert .$$\n\nThe circle shows it best: the smaller the radius, the more it bends — $\\kappa = \\tfrac{1}{r}$.",
    ),
    tool("learn_widget", "w1"),
    say(de ? "Links steht eine kleine Übung: drei Kreise, rechne κ aus." : "There's a little exercise on the left: three circles, work out κ."),
    you(results[0]),
    say(
      de
        ? "Zwei von drei — gut! Die Gerade ist der Grenzfall: Ihr Radius geht gegen unendlich, also $\\kappa = \\lim_{r\\to\\infty} \\tfrac1r = 0$. Eine Gerade biegt sich gar nicht. Probier es noch einmal."
        : "Two out of three — good! The line is the limit case: its radius goes to infinity, so $\\kappa = \\lim_{r\\to\\infty} \\tfrac1r = 0$. A line doesn't bend at all. Give it another go.",
    ),
    you(results[1]),
    say(de ? "Alle richtig. 🎯" : "All right. 🎯"),
    you(de ? "Und bei einer Kurve, die kein Kreis ist?" : "And for a curve that isn't a circle?"),
    say(
      de
        ? "Dann nimmst du in jedem Punkt den **Schmiegekreis** — den Kreis, der sich dort am besten an die Kurve anschmiegt. Sein Radius ist $1/\\kappa$. Für die Parabel $y = \\tfrac12 x^2$ ergibt sich\n\n$$\\kappa(x) = \\frac{1}{(1+x^2)^{3/2}} .$$\n\nIm Scheitel ist sie am stärksten gebogen ($\\kappa = 1$), nach außen wird sie flacher."
        : "Then at each point you take the **osculating circle** — the circle that hugs the curve best there. Its radius is $1/\\kappa$. For the parabola $y = \\tfrac12 x^2$ that gives\n\n$$\\kappa(x) = \\frac{1}{(1+x^2)^{3/2}} .$$\n\nIt bends most at its vertex ($\\kappa = 1$) and flattens further out.",
    ),
    tool("learn_widget", "w2"),
    say(de ? "Zieh am Regler und sieh zu, wie der Schmiegekreis wächst, wenn die Parabel flacher wird." : "Drag the slider and watch the osculating circle grow as the parabola flattens."),
    you(results[2]),
    say(
      de
        ? "Genau: Im Scheitel ist $r = 1$, weiter außen wird der Kreis schnell größer. Als Nächstes schauen wir uns an, warum die Krümmung nicht von der Parametrisierung abhängt."
        : "Exactly: at the vertex $r = 1$, further out the circle grows fast. Next we'll see why curvature doesn't depend on the parametrisation.",
    ),
  ];
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

/** The demo's course, filled in as a week of learning (in the account the caller is in). Its id. */
export function seedLearnDemo(lang: Lang): number {
  setInstalled("learn", true);
  const id = store.createCourse({
    topic: lang === "de" ? "Differentialgeometrie" : "Differential geometry",
    goal: lang === "de" ? "Riemannsche Geometrie verstehen" : "Understand Riemannian geometry",
    level: lang === "de" ? "Abitur, etwas lineare Algebra" : "School maths, some linear algebra",
  });
  store.savePlan(id, plan(lang));
  store.setInterests(id, { [lang === "de" ? "Anschauung" : "Intuition"]: 3, [lang === "de" ? "Physik" : "Physics"]: 2 });

  // A week of learning: a step or two a day (the streak, the badges), the last one today.
  const done: [string, number][] = [
    // (The foundations one after another: linear algebra in depth first, then calculus.)
    ["linalg.a", 6], ["linalg.b", 6], ["linalg.c", 5], ["calc.a", 4], ["calc.b", 3], ["calc.c", 2], ["plane.a", 1], ["plane.b", 0],
  ];
  for (const [key, ago] of done) store.masterNode(id, key, daysAgo(ago, 19, 30), "");

  // The lesson under way: its exercises, your tries (every answer), the talk with the teacher.
  const lesson = "plane.c";
  const todoId = addLessonTodo(id, lesson);
  const w1 = store.addWidget({ courseId: id, nodeKey: lesson, title: lang === "de" ? "Krümmung von Kreisen" : "Curvature of circles", html: circleQuiz(lang), libs: ["katex"] });
  const w2 = store.addWidget({ courseId: id, nodeKey: lesson, title: lang === "de" ? "Der Schmiegekreis" : "The osculating circle", html: osculating(lang), libs: ["jsxgraph"] });
  const q = lang === "de" ? ["Radius 2", "Radius 0,5", "Gerade (Radius → ∞)"] : ["radius 2", "radius 0.5", "a line (radius → ∞)"];
  const t1 = daysAgo(0, 18, 12);
  const t2 = daysAgo(0, 18, 15);
  const t3 = daysAgo(0, 18, 24);
  store.widgetResult(w1, { type: "result", score: 2 / 3, correct: 2, total: 3, note: "κ = 1/r", answers: [{ q: q[0], a: "0.5", ok: true }, { q: q[1], a: "2", ok: true }, { q: q[2], a: "1", ok: false }], snapshot: quizSnapshot(lang, ["0.5", "2", "1"], 2) }, t1);
  store.widgetResult(w1, { type: "result", score: 1, correct: 3, total: 3, note: "κ = 1/r", answers: [{ q: q[0], a: "0.5", ok: true }, { q: q[1], a: "2", ok: true }, { q: q[2], a: "0", ok: true }], snapshot: quizSnapshot(lang, ["0.5", "2", "0"], 3) }, t2);
  store.widgetResult(w2, { type: "result", score: 1, note: lang === "de" ? "Schmiegekreis an der Parabel" : "osculating circle of a parabola", answers: [{ q: "κ(0)", a: "1.00", ok: true }] }, t3);
  const ex1 = lang === "de" ? "Krümmung von Kreisen" : "Curvature of circles";
  const ex2 = lang === "de" ? "Der Schmiegekreis" : "The osculating circle";
  const results = [`[Übung „${ex1}“ abgeschlossen: 2 von 3 richtig, 67 %.]`, `[Übung „${ex1}“ abgeschlossen: 3 von 3 richtig, 100 %.]`, `[Übung „${ex2}“ abgeschlossen: 100 %.]`];

  const run = createRun({ ticket: "", todoId, mode: "instruct", provider: "claude", model: "sonnet", permissionMode: "default", repo: null, prompt: lang === "de" ? "Lass uns anfangen." : "Let's begin." });
  const started = daysAgo(0, 18, 5);
  updateRun(run.id, { status: "done", startedAt: started.toISOString(), finishedAt: daysAgo(0, 18, 30).toISOString(), durationMs: 25 * 60_000 });
  fs.mkdirSync(path.dirname(logPath(run.id)), { recursive: true });
  fs.writeFileSync(logPath(run.id), lessonLog(lang, results));
  addTodoInstruction(todoId, lang === "de" ? "Lass uns anfangen: „Krümmung ebener Kurven“." : "Let's begin: “Curvature of plane curves”.", run.id);

  // Cards from the steps mastered, due to be reviewed.
  store.addCards(id, "linalg.a", [
    { front: lang === "de" ? "Was ist eine Basis eines Vektorraums?" : "What is a basis of a vector space?", back: lang === "de" ? "Ein linear unabhängiges Erzeugendensystem." : "A linearly independent spanning set." },
    { front: lang === "de" ? "Dimension des ℝ³?" : "Dimension of ℝ³?", back: "3" },
  ]);
  store.addCards(id, "plane.b", [
    { front: lang === "de" ? "Bogenlänge von γ auf [a, b]?" : "Arc length of γ on [a, b]?", back: "∫ₐᵇ ‖γ′(t)‖ dt" },
    { front: lang === "de" ? "Was heißt „nach Bogenlänge parametrisiert“?" : "What does “parametrised by arc length” mean?", back: "‖γ′(s)‖ = 1" },
  ]);
  return id;
}
