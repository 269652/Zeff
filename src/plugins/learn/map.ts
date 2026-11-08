/** The skill map's graph (pure, client-safe): the skills of a course and which come before each. */
import type { NodeKind } from "./shared";

type N = { key: string; kind: NodeKind; parent: string | null; requires: string[] };

/**
 * Each skill with the skills it follows: its own requirements, and — where it has none inside its phase — its phase's
 * and year's. A phase or year required stands for its last skills (those nothing else in it requires).
 */
export function skillGraph(nodes: N[]): { key: string; phase: string | null; after: string[] }[] {
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
  return skills.map((s) => {
    const phase = s.parent && byKey.get(s.parent)?.kind === "phase" ? s.parent : null;
    const siblings = new Set(phase ? inside(phase).map((x) => x.key) : []);
    const own = s.requires.flatMap(expand);
    const hasInPhase = own.some((k) => siblings.has(k));
    const inherited: string[] = [];
    if (!hasInPhase) for (let p = s.parent; p; p = byKey.get(p)?.parent ?? null) inherited.push(...(byKey.get(p)?.requires ?? []).flatMap(expand));
    return { key: s.key, phase, after: [...new Set([...own, ...inherited])].filter((k) => k !== s.key) };
  });
}
