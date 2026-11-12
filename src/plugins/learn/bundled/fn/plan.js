// A course researched and planned: scholarly sources (OpenAlex, Semantic Scholar, arXiv) and what a web search found become, by the AI, a plan over
// years → phases → skills → steps; the plan is CHECKED and repaired (never trusted), sent back once if it is a chain instead of a tree, and stored as
// the course's steps. Modes: "create" (the default), "update" (the plan revised for the person's interests and a note - what is done stays),
// "anew" (from scratch: progress, exercises and cards start over).
// inputs: { course: title, topic?, goal?, known?, space?, sources?: web hits [{ title, url, snippet }], mode?, note? }   (needs the AI and the network)
const COURSES = "@learn-ext.i2";
const STEPS = "@learn-ext.i3";
const CARDS = "@learn-ext.i4";
const EXERCISES = "@learn-ext.i10";
const CONV = "@learn-ext.i9";
const KINDS = ["year", "phase", "skill", "step"];
const DEFAULT_POINTS = { year: 500, phase: 150, skill: 50, step: 10 };
const t0 = Date.now();
const mode = ["update", "anew"].includes(inputs.mode) ? inputs.mode : "create";
const title = String(inputs.course || inputs.topic || "").trim();
if (!title) throw new Error("Give the course a title or a topic.");

const PLAN_SCHEMA = {
  type: "object",
  required: ["title", "summary", "years", "sources", "nodes"],
  properties: {
    title: { type: "string" }, summary: { type: "string" }, years: { type: "number" },
    sources: { type: "array", items: { type: "object", required: ["id", "title"], properties: { id: { type: "string" }, title: { type: "string" }, authors: { type: "string" }, year: { type: "number" }, url: { type: "string" }, kind: { type: "string" } } } },
    nodes: { type: "array", items: { type: "object", required: ["key", "kind", "parent", "title"], properties: { key: { type: "string" }, kind: { type: "string", enum: KINDS }, parent: { type: ["string", "null"] }, title: { type: "string" }, summary: { type: "string" }, objectives: { type: "array", items: { type: "string" } }, requires: { type: "array", items: { type: "string" } }, path: { type: "string" }, xp: { type: "number" }, minutes: { type: "number" }, sources: { type: "array", items: { type: "string" } } } } },
  },
};

// ---- the plan made safe to store (the rules of Zeff's Learn)
const str = (v, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v, max = 20, len = 300) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : []);
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
function normalize(raw) {
  const problems = [];
  if (!raw || typeof raw !== "object") return { plan: { title: "", summary: "", years: 0, sources: [], nodes: [] }, problems: ["The research answered no plan."] };
  const sources = [];
  const ids = new Set();
  for (const s of Array.isArray(raw.sources) ? raw.sources : []) {
    const id = str(s && s.id, 60), t = str(s && s.title, 300);
    if (!id || !t || ids.has(id)) continue;
    ids.add(id);
    const url = str(s.url, 600);
    sources.push({ id, title: t, ...(str(s.authors) ? { authors: str(s.authors, 300) } : {}), ...(num(s.year) ? { year: Math.round(num(s.year)) } : {}), ...(/^https?:\/\//.test(url) ? { url } : {}) });
  }
  const nodes = [];
  const byKey = new Map();
  for (const r of Array.isArray(raw.nodes) ? raw.nodes : []) {
    const key = str(r && r.key, 80), t = str(r && r.title, 200);
    if (!key || !t) continue;
    if (!KINDS.includes(r.kind)) { problems.push(`"${t}": unknown kind ${JSON.stringify(r.kind)} - left out.`); continue; }
    if (byKey.has(key)) { problems.push(`"${key}" twice - the first kept.`); continue; }
    const n = { key, kind: r.kind, parent: str(r.parent, 80) || null, title: t, summary: str(r.summary, 1200), objectives: strs(r.objectives, 12), requires: strs(r.requires, 30, 80), path: str(r.path, 80), xp: num(r.xp), minutes: num(r.minutes), sources: strs(r.sources, 20, 60).filter((id) => ids.has(id)) };
    nodes.push(n);
    byKey.set(key, n);
  }
  for (const n of nodes) if (n.parent && !byKey.has(n.parent)) { problems.push(`"${n.title}": its parent "${n.parent}" isn't in the plan - put at the top.`); n.parent = null; }
  for (const n of nodes) {
    const seen = new Set([n.key]);
    for (let p = n.parent; p; p = (byKey.get(p) || {}).parent || null) {
      if (seen.has(p)) { problems.push(`"${n.title}": its parents go round in a circle - put at the top.`); n.parent = null; break; }
      seen.add(p);
    }
  }
  const ancestors = (key) => { const out = new Set(); for (let p = (byKey.get(key) || {}).parent || null; p && !out.has(p); p = (byKey.get(p) || {}).parent || null) out.add(p); return out; };
  for (const n of nodes) {
    const up = ancestors(n.key);
    const kept = [];
    for (const r of n.requires) {
      if (!byKey.has(r) || r === n.key || up.has(r)) { problems.push(`"${n.title}": requires "${r}", which ${byKey.has(r) ? "it is part of" : "isn't in the plan"} - dropped.`); continue; }
      if (!kept.includes(r)) kept.push(r);
    }
    n.requires = kept;
  }
  // The foundations - the first phase's skills - are learned one after another, in depth; what builds on them builds on the last one.
  const first = nodes.find((n) => n.kind === "phase");
  if (first) {
    const found = nodes.filter((n) => n.kind === "skill" && n.parent === first.key);
    const inFound = new Set(found.map((f) => f.key));
    found.forEach((f, i) => { const own = f.requires.filter((r) => !inFound.has(r)); f.requires = i ? [...own, found[i - 1].key] : own; });
    const last = found.length ? found[found.length - 1].key : null;
    if (last) for (const n of nodes) { if (inFound.has(n.key) || !n.requires.some((r) => inFound.has(r))) continue; n.requires = [...new Set([...n.requires.filter((r) => !inFound.has(r)), last])]; }
  }
  const state = new Map();
  const visit = (key) => {
    state.set(key, "open");
    const n = byKey.get(key);
    for (const r of [...n.requires]) {
      const s = state.get(r);
      if (s === "open") { n.requires = n.requires.filter((x) => x !== r); problems.push(`"${n.title}" and "${byKey.get(r).title}" require each other (a cycle) - that requirement dropped.`); }
      else if (!s) visit(r);
    }
    state.set(key, "done");
  };
  for (const n of nodes) if (!state.has(n.key)) visit(n.key);
  const years = num(raw.years);
  return { plan: { title: str(raw.title, 200), summary: str(raw.summary, 3000), years: years ? Math.min(10, years) : 0, sources, nodes }, problems };
}
function shapeOf(plan) {
  const skills = plan.nodes.filter((n) => n.kind === "skill");
  const paths = new Set(skills.map((s) => s.path).filter(Boolean)).size;
  const widths = [];
  for (const phase of plan.nodes.filter((n) => n.kind === "phase")) {
    const inPhase = skills.filter((s) => s.parent === phase.key);
    if (!inPhase.length) continue;
    const keys = new Set(inPhase.map((s) => s.key));
    const depth = new Map();
    const depthOf = (key, seen) => {
      if (depth.has(key)) return depth.get(key);
      if (seen.has(key)) return 0;
      seen.add(key);
      const d = inPhase.find((x) => x.key === key).requires.filter((r) => keys.has(r)).reduce((m, r) => Math.max(m, depthOf(r, seen) + 1), 0);
      depth.set(key, d);
      return d;
    };
    const count = new Map();
    for (const s of inPhase) { const d = depthOf(s.key, new Set()); count.set(d, (count.get(d) || 0) + 1); }
    widths.push(Math.max(...count.values()));
  }
  const after = widths.slice(1);
  const branching = after.filter((w) => w >= 2).length;
  return { linear: paths < 2 || (after.length > 0 && branching * 2 < after.length) };
}

// ---- the course and what it has now
const courses = await zeff.database(COURSES);
const cc = (n) => courses.cols.indexOf(n);
const at = courses.rows.findIndex((r) => String(r[0]).trim().toLowerCase() === title.toLowerCase());
if (mode !== "create" && at < 0) throw new Error(`There is no course "${title}".`);
const row = at >= 0 ? courses.rows[at] : null;
const topic = String(inputs.topic || (row && row[cc("Topic")]) || title);
const goal = String(inputs.goal || (row && row[cc("Goal")]) || "");
const known = String(inputs.known || (row && row[cc("Prior")]) || "");
let courseId;
if (row) {
  courseId = courses.ids[at];
  await zeff.updateRow(COURSES, courseId, { Status: "researching", Error: "" });
} else {
  courseId = (await zeff.addRow(COURSES, { Course: title, Topic: topic, Goal: goal, Prior: known, Space: String(inputs.space || ""), XP: 0, Level: 1, Streak: 0, TodayXP: 0, DailyGoal: 50, Status: "researching" })).id;
}
const fail = async (e) => { await zeff.updateRow(COURSES, courseId, { Status: "failed", Error: String(e && e.message ? e.message : e).slice(0, 1000) }); throw e; };

try {
  const state = mode === "create" ? null : await zeff.call("learn-ext", "state", { course: title });
  const stepsDb = await zeff.database(STEPS);
  const sc = (n) => stepsDb.cols.indexOf(n);
  const mine = stepsDb.rows.map((r, i) => ({ r, id: stepsDb.ids[i] })).filter(({ r }) => String(r[sc("Course")] || "").split(",")[0].trim().replace(/^#/, "") === String(courseId) || String(r[sc("Course")] || "").split(",")[0].trim().toLowerCase() === title.toLowerCase());

  // The sources: the literature, the web hits.
  const found = await zeff.call("learn-ext", "literature", { topic });
  const web = (Array.isArray(inputs.sources) ? inputs.sources : []).filter((s) => s && s.title).slice(0, 10);
  const list = found.length ? found.map((s) => `- [${s.id}] ${s.title}${s.authors ? ` — ${s.authors}` : ""}${s.year ? ` (${s.year})` : ""}${s.citations ? `, ${s.citations}× zitiert` : ""}${s.url ? ` <${s.url}>` : ""}`).join("\n") : "(Die Literaturdienste haben nichts geliefert — recherchiere selbst.)";
  const webList = web.length ? `\nWas eine Websuche zu Curricula und Lehrbüchern fand:\n${web.map((s) => `- ${s.title}${s.url ? ` <${s.url}>` : ""}${s.snippet ? ` — ${String(s.snippet).slice(0, 200)}` : ""}`).join("\n")}\n` : "";

  const RULES = `Baue daraus einen hierarchischen, mehrjährigen Plan:
- "year" → "phase" → "skill" → "step". Ein Step ist ein kleiner Trittstein (eine Lerneinheit von etwa 15–45 Minuten mit einem klaren, prüfbaren Lernziel). Jede Skill hat 3–8 Steps.
- Plane realistisch für jemanden, der neben dem Beruf lernt (etwa 3–5 Stunden pro Woche); setze "years" entsprechend (1–5).
- "requires": was vorher sitzen muss (Keys anderer Knoten — keine Zyklen). Was eine Phase voraussetzt, gilt für alles in ihr.
- "path": Gib den Skills Pfade — Richtungen, zwischen denen man wählen kann (z. B. "Grundlagen", "Riemannsche Geometrie", "Anwendungen in der Physik"; bei Sprachen "Konversation", "Grammatik", "Lesen"). Mindestens 3 Pfade im ganzen Plan; "Grundlagen" nur für das wirklich Gemeinsame.
- Der Plan ist ein Skill-Tree, ein Graph mit Breite — keine Kette: Jede Phase hat 4–8 Skills, davon stehen mehrere parallel (sie setzen dasselbe voraus, nicht einander). Ein Skill setzt nur voraus, was er wirklich braucht.
- Auch Steps eines Skills dürfen parallel stehen (nicht jeder Step braucht den vorigen).
- "objectives": 1–3 konkrete, prüfbare Lernziele je Knoten.
- "sources": Ids der passenden Quellen je Knoten. "minutes" je Step. "xp" kannst du weglassen.
- Keys sind kurz und eindeutig (y1, y1.p1, y1.p1.s1, y1.p1.s1.a …). Titel und Texte auf Deutsch (Fachbegriffe dürfen bleiben).`;
  let prompt;
  if (mode === "update" && state) {
    const levels = ["nicht jetzt", "ein wenig", "interessiert", "am meisten"];
    const wants = Object.entries(state.course.interests).map(([p, w]) => `- ${p}: ${levels[Math.max(0, Math.min(3, Math.round(w)))] ?? w}`);
    const doneKeys = state.nodes.filter((n) => n.kind === "step" && n.mastered).map((n) => n.key);
    const begun = state.nodes.filter((n) => n.kind === "step" && n.status === "active").map((n) => n.key);
    const plan0 = { title, nodes: mine.map(({ r }) => ({ key: String(r[sc("Key")]), kind: String(r[sc("Kind")]), parent: String(r[sc("Parent")] || "") || null, title: String(r[0]), summary: String(r[sc("Summary")] || ""), objectives: String(r[sc("Objectives")] || "").split("; ").filter(Boolean), requires: String(r[sc("Requires")] || "").split(",").map((x) => x.trim()).filter(Boolean), path: String(r[sc("Path")] || ""), minutes: Number(r[sc("Minutes")]) || undefined })) };
    prompt = `Du bist ein erfahrener Didaktiker. Überarbeite diesen bestehenden Lernplan — die Person lernt schon damit.\n\nThema: ${topic}\nZiel: ${goal || "das Thema gründlich verstehen und anwenden können"}\nVorwissen: ${known || "unbekannt"}\n${wants.length ? `Wie sehr sie die Pfade interessieren:\n${wants.join("\n")}\n` : ""}${String(inputs.note || "").trim() ? `Ihr Wunsch für die Überarbeitung: ${String(inputs.note).trim()}\n` : ""}\nBereits gemeistert (unverändert lassen — gleicher Key, gleicher Titel, gleicher Inhalt): ${doneKeys.join(", ") || "noch nichts"}\nBegonnen (ebenso unverändert lassen): ${begun.join(", ") || "nichts"}\n\nSo überarbeitest du:\n- Behalte alles Gemeisterte und Begonnene genau so (Key, Titel, Lernziele, Eltern) — es ist die Lerngeschichte der Person.\n- Pfade, die sie am meisten interessieren, bekommen mehr Tiefe und kommen früher; "nicht jetzt" wird knapper (nicht gestrichen, wenn andere darauf aufbauen).\n- Die erste Phase sind die Grundlagen: ihre Skills lernt man nacheinander, in die Tiefe. Was darauf aufbaut, setzt den letzten Grundlagen-Skill voraus; erst danach wird es breit.\n- Neue Knoten bekommen neue, eindeutige Keys im selben Schema; bestehende Keys bleiben für denselben Inhalt.\n${RULES}\n\nAntworte nur mit dem ganzen überarbeiteten Plan im verlangten JSON-Format.\n\nDer bisherige Plan:\n${JSON.stringify(plan0)}`;
  } else {
    prompt = `Du bist ein erfahrener Didaktiker und Fachexperte. Erstelle einen Lernplan, mit dem eine Person das folgende Thema von Grund auf erfassen und beherrschen lernt.\n\nThema: ${topic}\nZiel: ${goal || "das Thema gründlich verstehen und anwenden können"}\nVorwissen: ${known || "unbekannt — beginne bei den Grundlagen"}\n\nGefundene Fachliteratur (aus OpenAlex, Semantic Scholar, arXiv — nutze die Ids in eckigen Klammern):\n${list}\n${webList}\n${RULES}\n\nAntworte nur mit dem Plan im verlangten JSON-Format.`;
  }
  let raw = await zeff.ai(prompt, true, { schema: PLAN_SCHEMA, minutes: 8 });
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.nodes)) throw new Error("The research answered no plan.");
  // A chain is not a skill tree: sent back once to branch out (when there is time left); kept as it is when the rework fails or is not better.
  if (shapeOf(normalize(raw).plan).linear && Date.now() - t0 < 330000) {
    try {
      const again = await zeff.ai(`Der folgende Lernplan ist zu linear: Seine Skills bilden fast eine Kette auf einem Pfad. Baue ihn zu einem echten Skill-Tree um — behalte Inhalte, Keys, Steps und Quellen, ändere vor allem "requires" und "path":\n- mindestens 3 Pfade, "Grundlagen" nur für das wirklich Gemeinsame;\n- in jeder Phase mehrere Skills parallel (sie setzen dasselbe voraus, nicht einander), Zusammenführungen und Wahlpfade;\n- "requires" nur, wo es fachlich nötig ist — keine Kette.\n\nAntworte nur mit dem ganzen umgebauten Plan im verlangten JSON-Format.\n\n${JSON.stringify(raw)}`, true, { schema: PLAN_SCHEMA, minutes: 6 });
      if (again && Array.isArray(again.nodes) && !shapeOf(normalize(again).plan).linear) raw = { ...again, sources: [...(raw.sources || []), ...(again.sources || [])] };
    } catch { /* kept as it is */ }
  }
  // Whatever the answer did with the steps done, they are kept (their node as it was, if the answer left it out).
  if (mode === "update" && state) {
    const keys = new Set(raw.nodes.map((n) => n && n.key));
    for (const n of state.nodes) if ((n.mastered || n.status === "active") && !keys.has(n.key)) {
      const r = (mine.find((m) => String(m.r[sc("Key")]) === n.key) || {}).r;
      if (r) raw.nodes.push({ key: n.key, kind: n.kind, parent: n.parent, title: n.title, requires: n.requires, path: n.path || "", minutes: n.minutes });
    }
  }
  const { plan, problems } = normalize(raw);
  if (!plan.nodes.length) throw new Error("The plan has no steps - try again, or say the topic more exactly.");
  // The sources: what the services found (those the plan names first), and what the AI added.
  const named = new Set(plan.nodes.flatMap((n) => n.sources));
  const own = plan.sources.filter((s) => !found.some((f) => f.id === s.id));
  const sources = [...found.filter((f) => named.has(f.id)), ...own, ...found.filter((f) => !named.has(f.id)).slice(0, 10)].map((s) => `${s.id} | ${s.title}${s.authors ? ` - ${s.authors}` : ""}${s.year ? ` (${s.year})` : ""} | ${s.url || ""}`);

  if (mode === "anew") {
    // From scratch: the steps and everything that hangs on them go (to the trash).
    const titles = new Set(mine.map(({ r }) => String(r[0])));
    for (const [db, ref] of [[CARDS, "Step"], [EXERCISES, "Step"], [CONV, "Step"]]) {
      const d = await zeff.database(db);
      for (let i = 0; i < d.rows.length; i++) if (titles.has(String(d.rows[i][d.cols.indexOf(ref)]))) await zeff.deleteRow(db, d.ids[i]);
    }
    for (const { id } of mine) await zeff.deleteRow(STEPS, id);
    mine.length = 0;
  }
  const have = new Map(mine.map(({ r, id }) => [String(r[sc("Key")]), { r, id }]));
  const fields = (n, i) => ({ Step: n.title, Kind: n.kind, Key: n.key, Parent: n.parent || "", Requires: n.requires.join(", "), Summary: n.summary, Objectives: n.objectives.join("; "), Path: n.path, ...(n.xp !== undefined ? { Points: n.xp } : { Points: DEFAULT_POINTS[n.kind] }), ...(n.minutes !== undefined ? { Minutes: n.minutes } : {}), SourceIds: n.sources.join(", "), Order: i + 1 });
  let added = 0, changed = 0;
  for (const [i, n] of plan.nodes.entries()) {
    const had = have.get(n.key);
    if (had) { await zeff.updateRow(STEPS, had.id, fields(n, i)); changed++; have.delete(n.key); }
    else { await zeff.addRow(STEPS, { ...fields(n, i), Course: [courseId] }); added++; }
  }
  let removed = 0;
  for (const [, { r, id }] of have) {
    const keep = ["Yes", "yes", true].includes(r[sc("Mastered")]) || ["Yes", "yes", true].includes(r[sc("Begun")]);
    if (!keep) { await zeff.deleteRow(STEPS, id); removed++; }
  }
  await zeff.updateRow(COURSES, courseId, { Summary: plan.summary, Years: plan.years, Sources: sources.join("\n"), Problems: problems.join("\n"), Status: "ready", Error: "" });
  return { course: title, mode, steps: plan.nodes.length, added, changed, removed, repaired: problems.length, sources: sources.length, summary: plan.summary };
} catch (e) {
  await fail(e);
}
