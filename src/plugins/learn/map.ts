/** The skill map's graph (pure, client-safe): the skills of a course and which come before each. */
import type { NodeKind } from "./shared";

type N = { key: string; kind: NodeKind; parent: string | null; requires: string[] };

/**
 * Each skill with the skills it follows: its own requirements, and — where it has none inside its phase — its phase's
 * and year's. A phase or year required stands for its last skills (those nothing else in it requires).
 */
export function skillGraph(nodes: N[]): { key: string; phase: string | null; after: string[]; foundation?: boolean }[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const skills = nodes.filter((n) => n.kind === "skill");
  const inside = (container: string): N[] => skills.filter((s) => {
    for (let p = s.parent; p; p = byKey.get(p)?.parent ?? null) if (p === container) return true;
    return false;
  });
  const lastOf = (container: string): string[] => {
    const own = inside(container);
    const keys = new Set(own.map((s) => s.key));
    const required = new Set(own.flatMap((s) => s.requires.filter((r) => keys.has(r))));
    return own.filter((s) => !required.has(s.key)).map((s) => s.key);
  };
  const expand = (k: string): string[] => {
    const n = byKey.get(k);
    if (!n) return [];
    if (n.kind === "skill") return [k];
    if (n.kind === "step") return n.parent && byKey.get(n.parent)?.kind === "skill" ? [n.parent] : [];
    return lastOf(k);
  };
  // The foundations (the first phase's skills, learned one after another): drawn down one column in the plan's order —
  // no lines between them here (the map joins them as a sequence) — and what builds on them follows only the last one.
  const firstPhase = nodes.find((n) => n.kind === "phase")?.key ?? null;
  const foundations = firstPhase ? skills.filter((s) => s.parent === firstPhase).map((s) => s.key) : [];
  const isFoundation = new Set(foundations);
  const lastFoundation = foundations[foundations.length - 1];
  return skills.map((s) => {
    const g = graphOf(s);
    if (isFoundation.has(s.key)) return { ...g, after: g.after.filter((k) => !isFoundation.has(k)), foundation: true };
    if (!g.after.some((k) => isFoundation.has(k))) return g;
    return { ...g, after: [...new Set([...g.after.filter((k) => !isFoundation.has(k)), lastFoundation])] };
  });
  function graphOf(s: N): { key: string; phase: string | null; after: string[] } {
    const phase = s.parent && byKey.get(s.parent)?.kind === "phase" ? s.parent : null;
    const siblings = new Set(phase ? inside(phase).map((x) => x.key) : []);
    const own = s.requires.flatMap(expand);
    const hasInPhase = own.some((k) => siblings.has(k));
    const inherited: string[] = [];
    if (!hasInPhase) for (let p = s.parent; p; p = byKey.get(p)?.parent ?? null) inherited.push(...(byKey.get(p)?.requires ?? []).flatMap(expand));
    return { key: s.key, phase, after: [...new Set([...own, ...inherited])].filter((k) => k !== s.key) };
  }
}

type RouteNode = { key: string; kind: NodeKind; parent: string | null; path: string | null; masteredAt: string | null; activeSince: string | null };

/**
 * The course's red thread: the skills in the order they're walked — first those begun (by when their first step was
 * begun or mastered), then the plan ahead: the foundations (skills that need nothing) one after another in the plan's
 * order, then the rest as soon as what they follow is on the way, the paths you care about most first (weights by path
 * name; others 1), else the plan's order. `walked`: how many of `keys` are begun. Pure.
 */
export function courseRoute(nodes: RouteNode[], graph: { key: string; after: string[] }[], weights: Record<string, number> = {}): { keys: string[]; walked: number } {
  const order = new Map(nodes.map((n, i) => [n.key, i]));
  const steps = new Map<string, RouteNode[]>();
  for (const n of nodes) if (n.kind === "step" && n.parent) steps.set(n.parent, [...(steps.get(n.parent) ?? []), n]);
  const pathOf = new Map(nodes.map((n) => [n.key, n.path]));
  const begun = (k: string) => {
    const at = (steps.get(k) ?? []).flatMap((s) => [s.activeSince, s.masteredAt].filter((x): x is string => !!x)).sort()[0];
    return at ?? null;
  };
  const walked = graph
    .map((g) => ({ key: g.key, at: begun(g.key) }))
    .filter((x): x is { key: string; at: string } => !!x.at)
    .sort((a, b) => a.at.localeCompare(b.at) || order.get(a.key)! - order.get(b.key)!)
    .map((x) => x.key);
  const on = new Set(walked);
  const keys = [...walked];
  const weight = (k: string) => weights[pathOf.get(k) ?? ""] ?? 1;
  const after = new Map(graph.map((g) => [g.key, g.after.filter((a) => a !== g.key)]));
  // How deep each lies (the longest way in): of two as wanted, the nearer one first — the thread goes on step by step.
  const depth = new Map<string, number>();
  const deep = (k: string, seen = new Set<string>()): number => {
    if (depth.has(k)) return depth.get(k)!;
    if (seen.has(k)) return 0;
    seen.add(k);
    const d = (after.get(k) ?? []).filter((a) => after.has(a)).reduce((m, a) => Math.max(m, deep(a, seen) + 1), 0);
    depth.set(k, d);
    return d;
  };
  // Foundations first, in the plan's order.
  for (const g of [...graph].sort((a, b) => order.get(a.key)! - order.get(b.key)!)) if (!after.get(g.key)!.length && !on.has(g.key)) (on.add(g.key), keys.push(g.key));
  // Then whatever can come next — the most wanted path first, else the plan's order.
  for (;;) {
    const ready = graph.filter((g) => !on.has(g.key) && after.get(g.key)!.every((a) => on.has(a) || !after.has(a)));
    const pool = ready.length ? ready : graph.filter((g) => !on.has(g.key)); // (a cycle: the plan's order breaks it)
    if (!pool.length) break;
    pool.sort((a, b) => weight(b.key) - weight(a.key) || deep(a.key) - deep(b.key) || order.get(a.key)! - order.get(b.key)!);
    on.add(pool[0].key);
    keys.push(pool[0].key);
  }
  return { keys, walked: walked.length };
}
