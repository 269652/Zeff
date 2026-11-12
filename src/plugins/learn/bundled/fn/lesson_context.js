// What the teacher's rules say about this lesson (the values for {{ … }} in teacher.md), read fresh each time a session starts: the course, the
// lesson and its place in the plan, its goals, what it builds on, what the person has already shown in the course's other lessons, its sources.
// The lesson counts as begun from here on. inputs: { key: the step's title (or key) }
const STEPS = "@learn-ext.i3";
const COURSES = "@learn-ext.i2";
const EXERCISES = "@learn-ext.i10";
const steps = await zeff.database(STEPS);
const sc = (n) => steps.cols.indexOf(n);
const want = String(inputs.key).trim().replace(/^#/, "").toLowerCase();
const at = steps.rows.findIndex((r, i) => String(steps.ids[i]) === want || String(r[sc("Key")] || "").toLowerCase() === want || String(r[0]).trim().toLowerCase() === want);
if (at < 0) throw new Error(`There is no step "${inputs.key}".`);
const step = steps.rows[at];
const yes = (v) => v === true || v === "Yes" || v === "yes" || v === "true";
const byKey = new Map(steps.rows.map((r) => [String(r[sc("Key")]), r]));
const chain = [];
for (let p = byKey.get(String(step[sc("Parent")] || "")), n = 0; p && n < 8; p = byKey.get(String(p[sc("Parent")] || "")), n++) chain.unshift(String(p[0]));
const before = String(step[sc("Requires")] || "").split(",").map((k) => byKey.get(k.trim())).filter(Boolean).map((r) => String(r[0]));
const objectives = String(step[sc("Objectives")] || "").split(/;\s*|\n/).map((x) => x.trim()).filter(Boolean);

const courses = await zeff.database(COURSES);
const cc = (n) => courses.cols.indexOf(n);
const courseWant = String(step[sc("Course")] || "").split(",")[0].trim().replace(/^#/, "").toLowerCase();
const ci = Math.max(0, courses.rows.findIndex((r, i) => String(courses.ids[i]) === courseWant || String(r[0]).trim().toLowerCase() === courseWant));
const course = courses.rows[ci] || [];

// The sources of this lesson (their ids are in the step; the course keeps "id | title | url" lines).
const mine = new Set(String(step[sc("SourceIds")] || "").split(",").map((x) => x.trim()).filter(Boolean));
const lines = String(course[cc("Sources")] || "").split("\n").map((x) => x.trim()).filter(Boolean).map((l) => l.split("|").map((x) => x.trim()));
const sources = lines.filter((l) => !mine.size || mine.has(l[0])).slice(0, 12).map((l) => `- ${l[1] || l[0]}${l[2] ? ` <${l[2]}>` : ""}`);

// What the person has shown in the course's other lessons: steps mastered and exercises done (else every lesson's teacher starts from zero).
const history = [];
for (const r of steps.rows) if (r !== step && yes(r[sc("Mastered")]) && String(r[sc("Kind")]) === "step") history.push(`- Einheit „${r[0]}“ gemeistert`);
const ex = await zeff.database(EXERCISES);
for (const r of ex.rows) {
  const best = Number(r[ex.cols.indexOf("Best")]) || 0;
  if (best > 0 && String(r[ex.cols.indexOf("Step")]) !== String(step[0])) history.push(`- Übung „${r[0]}“ (Einheit „${r[ex.cols.indexOf("Step")]}“): ${Math.round(best * 100)} %`);
}
// The lesson begins: it is the one in progress (a tick of its own).
if (!yes(step[sc("Begun")])) await zeff.updateRow(STEPS, steps.ids[at], { Begun: true });
const guide = await zeff.api("workspace.widgets.guide");
const libs = Object.entries(guide.libs).map(([k, what]) => `"${k}" (${String(what).slice(0, 110)})`).join(", ");
return {
  course: String(course[0] || step[sc("Course")] || ""),
  goal: String(course[cc("Goal")] || "das Thema beherrschen"),
  prior: String(course[cc("Prior")] || "unbekannt"),
  chain: chain.length ? ` (in: ${chain.join(" › ")})` : "",
  summary: step[sc("Summary")] ? ` ${step[sc("Summary")]}` : "",
  objectivesBlock: objectives.length ? `Lernziele — am Ende kann die Person:\n${objectives.map((o) => `- ${o}`).join("\n")}` : "",
  beforeBlock: before.length ? `Vorausgesetzt (schon gelernt): ${before.join(", ")}.` : "",
  historyBlock: history.length ? `Was die Person in diesem Kurs schon gezeigt hat (frühere Einheiten und Übungen) — bau darauf auf: frag nicht noch einmal ab, was sie schon gekonnt hat, knüpf daran an (höchstens eine kurze Wiederholung, wo etwas nicht saß), und sag ihr ruhig, dass du es weißt:\n${history.join("\n")}` : "",
  sourcesBlock: sources.length ? `Quellen für diese Einheit:\n${sources.join("\n")}` : "",
  kitGuide: guide.exercises,
  libs,
  key: String(step[0]),
};
