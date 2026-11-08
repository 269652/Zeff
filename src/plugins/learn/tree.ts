/**
 * The skill tree: where each node of a course stands, from what you mastered — and what to do next. Pure.
 *
 * - A node's requirements are its own and its ancestors' (a phase that requires another holds back all it contains).
 * - A step is mastered when you mastered it; a skill, phase or year when all its parts are.
 * - A step is available when everything it requires is mastered; active while you're in its lesson.
 * - A skill, phase or year is active / available while one of its parts is, else locked.
 */
import type { NodeKind, NodeStatus } from "./shared";

export type TreeNode = { id: number; key: string; kind: NodeKind; parent: string | null; requires: string[]; path: string | null; xp: number };
export type TreeInput = { nodes: TreeNode[]; mastered: Set<string>; active: Set<string> };
export type PathProgress = { steps: number; mastered: number };
export type Tree = {
  status: Map<string, NodeStatus>;
  progress: { steps: number; mastered: number; share: number; xp: number };
  /** Per path (a step belongs to the path of its nearest ancestor that has one). */
  paths: Map<string, PathProgress>;
};

function index(input: TreeInput) {
  const byKey = new Map(input.nodes.map((n) => [n.key, n]));
  const children = new Map<string, TreeNode[]>();
  for (const n of input.nodes) if (n.parent && byKey.has(n.parent)) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  /** Its own requirements and its ancestors'. */
  const effective = (n: TreeNode): string[] => {
    const out = [...n.requires];
    const seen = new Set<string>([n.key]);
    for (let p = n.parent ? byKey.get(n.parent) : undefined; p && !seen.has(p.key); p = p.parent ? byKey.get(p.parent) : undefined) {
      seen.add(p.key);
      out.push(...p.requires);
    }
    return out.filter((k) => byKey.has(k));
  };
  /** The path a node belongs to: its own, else its nearest ancestor's. */
  const pathOf = (n: TreeNode): string | null => {
    for (let p: TreeNode | undefined = n; p; p = p.parent ? byKey.get(p.parent) : undefined) if (p.path) return p.path;
    return null;
  };
  return { byKey, children, effective, pathOf };
}

export function computeTree(input: TreeInput): Tree {
  const { byKey, children, effective, pathOf } = index(input);
  const masteredMemo = new Map<string, boolean>();
  const isMastered = (key: string, guard = new Set<string>()): boolean => {
    if (masteredMemo.has(key)) return masteredMemo.get(key)!;
    if (guard.has(key)) return false;
    guard.add(key);
    const kids = children.get(key) ?? [];
    const m = kids.length ? kids.every((k) => isMastered(k.key, guard)) : input.mastered.has(key);
    masteredMemo.set(key, m);
    return m;
  };
  const status = new Map<string, NodeStatus>();
  const statusOf = (n: TreeNode): NodeStatus => {
    if (status.has(n.key)) return status.get(n.key)!;
    let s: NodeStatus;
    const kids = children.get(n.key) ?? [];
    if (isMastered(n.key)) s = "mastered";
    else if (!kids.length) {
      const open = effective(n).every((r) => isMastered(r));
      s = !open ? "locked" : input.active.has(n.key) ? "active" : "available";
    } else {
      const ks = kids.map(statusOf);
      s = ks.includes("active") ? "active" : ks.includes("available") ? "available" : "locked";
    }
    status.set(n.key, s);
    return s;
  };
  for (const n of input.nodes) statusOf(n);

  const steps = input.nodes.filter((n) => !(children.get(n.key) ?? []).length);
  const done = steps.filter((n) => status.get(n.key) === "mastered");
  const paths = new Map<string, PathProgress>();
  for (const n of steps) {
    const p = pathOf(n);
    if (!p) continue;
    const pp = paths.get(p) ?? { steps: 0, mastered: 0 };
    pp.steps++;
    if (status.get(n.key) === "mastered") pp.mastered++;
    paths.set(p, pp);
  }
  void byKey;
  return {
    status,
    progress: { steps: steps.length, mastered: done.length, share: steps.length ? done.length / steps.length : 0, xp: input.nodes.filter((n) => status.get(n.key) === "mastered").reduce((s, n) => s + n.xp, 0) },
    paths,
  };
}

/**
 * What to do next: the steps you can take now — the one you're in first, then those of the paths you care about most
 * (weights by path name; others count 1), in the plan's order.
 */
export function nextSteps(input: TreeInput, weights: Record<string, number> = {}, limit = 8): TreeNode[] {
  const t = computeTree(input);
  const { pathOf } = index(input);
  const order = new Map(input.nodes.map((n, i) => [n.key, i]));
  const kidsOf = new Set(input.nodes.map((n) => n.parent).filter(Boolean) as string[]);
  return input.nodes
    .filter((n) => !kidsOf.has(n.key) && (t.status.get(n.key) === "available" || t.status.get(n.key) === "active"))
    .sort((a, b) => {
      const act = Number(t.status.get(b.key) === "active") - Number(t.status.get(a.key) === "active");
      if (act) return act;
      const w = (weights[pathOf(b) ?? ""] ?? 1) - (weights[pathOf(a) ?? ""] ?? 1);
      return w || order.get(a.key)! - order.get(b.key)!;
    })
    .slice(0, limit);
}

/**
 * Columns for drawing the tree left to right: a node one column after the last column of anything it requires (all of
 * that thing — a phase's skills included). Steps don't spread their skill: they're drawn inside it.
 */
export function layers(input: TreeInput): Map<string, number> {
  const { byKey, children, effective } = index(input);
  const layer = new Map<string, number>();
  const busy = new Set<string>();
  const span = (key: string): number => {
    const n = byKey.get(key);
    if (!n) return 0;
    let s = layerOf(n);
    for (const k of children.get(key) ?? []) if (k.kind !== "step") s = Math.max(s, span(k.key));
    return s;
  };
  const layerOf = (n: TreeNode): number => {
    if (layer.has(n.key)) return layer.get(n.key)!;
    if (busy.has(n.key)) return 0;
    busy.add(n.key);
    const l = effective(n).reduce((m, r) => Math.max(m, span(r) + 1), 0);
    busy.delete(n.key);
    layer.set(n.key, l);
    return l;
  };
  for (const n of input.nodes) if (n.kind !== "step") layerOf(n);
  return layer;
}
