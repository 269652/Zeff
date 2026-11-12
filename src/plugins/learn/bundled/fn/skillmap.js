// The skill map as the old Learn drew it: every skill with the skills it follows (its own requirements, else its phase's and year's; the first
// phase's skills are the foundations, learned one after another), its steps, the phases as bands, and the red thread - the skills walked
// (one of their steps begun or mastered), then the plan ahead: the foundations first, then what follows as soon as what it follows is on the way,
// the paths you care about most first.
// inputs: { course?: title }  ->  { nodes: [{ key, title, status, path, group, after, foundation, summary, steps }], groups: [{ key, title }], route: { keys, walked } }
const s = await zeff.call("learn-ext", "state", { course: inputs.course });
const nodes = s.nodes;
const byKey = new Map(nodes.map((n) => [n.key, n]));
const skills = nodes.filter((n) => n.kind === "skill");
const inside = (container) => skills.filter((k) => { for (let p = k.parent; p; p = byKey.get(p)?.parent ?? null) if (p === container) return true; return false; });
const lastOf = (container) => {
  const own = inside(container);
  const keys = new Set(own.map((x) => x.key));
  const required = new Set(own.flatMap((x) => x.requires.filter((r) => keys.has(r))));
  return own.filter((x) => !required.has(x.key)).map((x) => x.key);
};
const expand = (k) => {
  const n = byKey.get(k);
  if (!n) return [];
  if (n.kind === "skill") return [k];
  if (n.kind === "step") return n.parent && byKey.get(n.parent)?.kind === "skill" ? [n.parent] : [];
  return lastOf(k);
};
const firstPhase = nodes.find((n) => n.kind === "phase")?.key ?? null;
const foundations = firstPhase ? skills.filter((k) => k.parent === firstPhase).map((k) => k.key) : [];
const isFoundation = new Set(foundations);
const lastFoundation = foundations[foundations.length - 1];
const graphOf = (k) => {
  const phase = k.parent && byKey.get(k.parent)?.kind === "phase" ? k.parent : null;
  const siblings = new Set(phase ? inside(phase).map((x) => x.key) : []);
  const own = k.requires.flatMap(expand);
  const hasInPhase = own.some((x) => siblings.has(x));
  const inherited = [];
  if (!hasInPhase) for (let p = k.parent; p; p = byKey.get(p)?.parent ?? null) inherited.push(...(byKey.get(p)?.requires ?? []).flatMap(expand));
  return { key: k.key, phase, after: [...new Set([...own, ...inherited])].filter((x) => x !== k.key) };
};
const graph = skills.map((k) => {
  const g = graphOf(k);
  if (isFoundation.has(k.key)) return { ...g, after: g.after.filter((x) => !isFoundation.has(x)), foundation: true };
  if (!g.after.some((x) => isFoundation.has(x))) return g;
  return { ...g, after: [...new Set([...g.after.filter((x) => !isFoundation.has(x)), lastFoundation])] };
});
const kids = (key) => nodes.filter((n) => n.kind === "step" && n.parent === key);
const out = graph.map((g) => {
  const k = byKey.get(g.key);
  return { key: k.key, title: k.title, status: k.status, path: k.path, group: g.phase, after: g.after, foundation: !!g.foundation, summary: k.summary || "", steps: kids(k.key).map((x) => ({ key: x.key, title: x.title, status: x.status, minutes: x.minutes })) };
});
// The red thread.
const order = new Map(nodes.map((n, i) => [n.key, i]));
const begun = (key) => kids(key).some((x) => x.status === "mastered" || x.status === "active");
const walked = graph.filter((g) => begun(g.key)).sort((a, b) => order.get(a.key) - order.get(b.key)).map((g) => g.key);
const on = new Set(walked);
const keys = [...walked];
const weights = (s.course && s.course.interests) || {};
const weight = (key) => weights[byKey.get(key)?.path ?? ""] ?? 1;
const after = new Map(graph.map((g) => [g.key, g.after.filter((x) => x !== g.key)]));
const depth = new Map();
const deep = (key, seen = new Set()) => {
  if (depth.has(key)) return depth.get(key);
  if (seen.has(key)) return 0;
  seen.add(key);
  const d = (after.get(key) ?? []).filter((x) => after.has(x)).reduce((m, x) => Math.max(m, deep(x, seen) + 1), 0);
  depth.set(key, d);
  return d;
};
for (const g of [...graph].sort((a, b) => order.get(a.key) - order.get(b.key))) if (!after.get(g.key).length && !on.has(g.key)) { on.add(g.key); keys.push(g.key); }
for (;;) {
  const ready = graph.filter((g) => !on.has(g.key) && after.get(g.key).every((x) => on.has(x) || !after.has(x)));
  const pool = ready.length ? ready : graph.filter((g) => !on.has(g.key));
  if (!pool.length) break;
  pool.sort((a, b) => weight(b.key) - weight(a.key) || deep(a.key) - deep(b.key) || order.get(a.key) - order.get(b.key));
  on.add(pool[0].key);
  keys.push(pool[0].key);
}
return { course: s.course ? s.course.title : "", nodes: out, groups: nodes.filter((n) => n.kind === "phase").map((p) => ({ key: p.key, title: p.title })), route: { keys, walked: walked.length } };
