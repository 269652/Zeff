// Where a course stands: the skill tree (years → phases → skills → steps) with each node's status from what was mastered, the progress of the
// whole course and of each path, and what to do next. The rules of Zeff's Learn: a node's requirements are its own and its ancestors'; a step is
// mastered when you mastered it, a skill/phase/year when all its parts are; a step is available when everything it requires is mastered.
// inputs: { course?: title | id | "#id" }  ->  { course, nodes: [{ key, kind, parent, title, requires, path, points, minutes, status, row }], progress, paths, next: [keys], mastered: [keys] }
const STEPS = "@learn-ext.i3";
const COURSES = "@learn-ext.i2";
const DEFAULT_POINTS = { year: 500, phase: 150, skill: 50, step: 10 };
const yes = (v) => v === true || v === "Yes" || v === "yes" || v === "true";
const clean = (s) => String(s ?? "").split(",")[0].trim().replace(/^#/, "").toLowerCase();

const courses = await zeff.database(COURSES);
const cc = (n) => courses.cols.indexOf(n);
let ci = 0;
if (inputs.course !== undefined && inputs.course !== null && inputs.course !== "") {
  const want = clean(inputs.course);
  ci = courses.rows.findIndex((r, i) => String(courses.ids[i]) === want || String(r[0]).trim().toLowerCase() === want);
  if (ci < 0) throw new Error(`There is no course "${inputs.course}".`);
}
const course = courses.rows[ci] || null;
const courseKey = course ? [String(courses.ids[ci]), String(course[0]).trim().toLowerCase()] : [];
let interests = {};
try { interests = JSON.parse((course && course[cc("Interests")]) || "{}") || {}; } catch { interests = {}; }

const steps = await zeff.database(STEPS);
const sc = (n) => steps.cols.indexOf(n);
const rows = steps.rows
  .map((r, i) => ({ r, i }))
  .filter(({ r }) => !course || courseKey.includes(clean(r[sc("Course")])))
  .map(({ r, i }) => {
    const kind = String(r[sc("Kind")] || "step");
    return {
      row: steps.ids[i],
      key: String(r[sc("Key")] || steps.ids[i]),
      kind,
      parent: String(r[sc("Parent")] || "") || null,
      title: String(r[0]),
      summary: String(r[sc("Summary")] || ""),
      objectives: String(r[sc("Objectives")] || ""),
      requires: String(r[sc("Requires")] || "").split(",").map((x) => x.trim()).filter(Boolean),
      path: String(r[sc("Path")] || "") || null,
      points: Number(r[sc("Points")]) || DEFAULT_POINTS[kind] || 10,
      minutes: Number(r[sc("Minutes")]) || 0,
      mastered: yes(r[sc("Mastered")]),
      begun: yes(r[sc("Begun")]),
      order: Number(r[sc("Order")]) || i,
    };
  })
  .sort((a, b) => a.order - b.order);

const byKey = new Map(rows.map((n) => [n.key, n]));
const children = new Map();
for (const n of rows) if (n.parent && byKey.has(n.parent)) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
const effective = (n) => {
  const out = [...n.requires];
  const seen = new Set([n.key]);
  for (let p = n.parent ? byKey.get(n.parent) : undefined; p && !seen.has(p.key); p = p.parent ? byKey.get(p.parent) : undefined) {
    seen.add(p.key);
    out.push(...p.requires);
  }
  return out.filter((k) => byKey.has(k));
};
const pathOf = (n) => {
  for (let p = n; p; p = p.parent ? byKey.get(p.parent) : undefined) if (p.path) return p.path;
  return null;
};
const memo = new Map();
const isMastered = (key, guard = new Set()) => {
  if (memo.has(key)) return memo.get(key);
  if (guard.has(key)) return false;
  guard.add(key);
  const kids = children.get(key) ?? [];
  const m = kids.length ? kids.every((k) => isMastered(k.key, guard)) : byKey.get(key).mastered;
  memo.set(key, m);
  return m;
};
const status = new Map();
const statusOf = (n) => {
  if (status.has(n.key)) return status.get(n.key);
  let s;
  const kids = children.get(n.key) ?? [];
  if (isMastered(n.key)) s = "mastered";
  else if (!kids.length) s = !effective(n).every((r) => isMastered(r)) ? "locked" : n.begun ? "active" : "available";
  else {
    const ks = kids.map(statusOf);
    s = ks.includes("active") ? "active" : ks.includes("available") ? "available" : "locked";
  }
  status.set(n.key, s);
  return s;
};
for (const n of rows) statusOf(n);

const leaves = rows.filter((n) => !(children.get(n.key) ?? []).length);
const done = leaves.filter((n) => status.get(n.key) === "mastered");
const paths = {};
for (const n of leaves) {
  const p = pathOf(n);
  if (!p) continue;
  paths[p] = paths[p] ?? { steps: 0, mastered: 0 };
  paths[p].steps++;
  if (status.get(n.key) === "mastered") paths[p].mastered++;
}
const order = new Map(rows.map((n, i) => [n.key, i]));
const next = leaves
  .filter((n) => ["available", "active"].includes(status.get(n.key)))
  .sort((a, b) => Number(status.get(b.key) === "active") - Number(status.get(a.key) === "active") || (interests[pathOf(b) ?? ""] ?? 1) - (interests[pathOf(a) ?? ""] ?? 1) || order.get(a.key) - order.get(b.key))
  .slice(0, 8)
  .map((n) => n.key);
return {
  course: course ? { id: courses.ids[ci], title: String(course[0]), interests } : null,
  nodes: rows.map((n) => ({ key: n.key, kind: n.kind, parent: n.parent, title: n.title, requires: n.requires, summary: n.summary, objectives: n.objectives, path: pathOf(n), points: n.points, minutes: n.minutes, status: status.get(n.key), row: n.row, mastered: n.mastered })),
  progress: { steps: leaves.length, mastered: done.length, share: leaves.length ? done.length / leaves.length : 0, points: rows.filter((n) => status.get(n.key) === "mastered").reduce((s, n) => s + n.points, 0) },
  paths,
  next,
  mastered: rows.filter((n) => status.get(n.key) === "mastered").map((n) => n.key),
};
