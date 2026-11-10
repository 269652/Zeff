/**
 * A researched plan made safe to store: what the research step answers is checked and repaired, never trusted —
 * unknown kinds and nodes without a title go, duplicate keys keep the first, a node whose parent isn't there moves to
 * the top, requirements on missing nodes (or on the node's own ancestors — those come first anyway) go, and a cycle
 * of requirements or parents is broken where it closes. Every repair is noted (the course page shows them). Pure.
 */
import { DEFAULT_XP, NODE_KINDS, type NodeKind, type Plan, type PlanNode, type PlanSource } from "./shared";

const str = (v: unknown, max = 400): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, max = 20, len = 300): string[] => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : []);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

export function normalizePlan(raw: unknown): { plan: Plan; problems: string[] } {
  const problems: string[] = [];
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o) return { plan: { title: "", summary: "", years: 0, sources: [], nodes: [] }, problems: ["The research answered no plan."] };

  // The sources: an id and a title each.
  const sources: PlanSource[] = [];
  const sourceIds = new Set<string>();
  for (const s of Array.isArray(o.sources) ? o.sources : []) {
    const r = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
    const id = str(r.id, 60);
    const title = str(r.title, 300);
    if (!id || !title || sourceIds.has(id)) continue;
    sourceIds.add(id);
    const year = num(r.year);
    const url = str(r.url, 600);
    const kind = (["paper", "book", "course", "web", "other"] as const).find((k) => k === r.kind);
    sources.push({ id, title, ...(str(r.authors) ? { authors: str(r.authors, 300) } : {}), ...(year ? { year: Math.round(year) } : {}), ...(/^https?:\/\//.test(url) ? { url } : {}), ...(kind ? { kind } : {}) });
  }

  // The nodes: a key, a known kind, a title; the first of a key wins.
  const nodes: PlanNode[] = [];
  const byKey = new Map<string, PlanNode>();
  for (const n of Array.isArray(o.nodes) ? o.nodes : []) {
    const r = n && typeof n === "object" ? (n as Record<string, unknown>) : {};
    const key = str(r.key, 80);
    const title = str(r.title, 200);
    const kind = NODE_KINDS.find((k) => k === r.kind) as NodeKind | undefined;
    if (!key || !title) continue;
    if (!kind) {
      problems.push(`"${title}": unknown kind ${JSON.stringify(r.kind)} — left out.`);
      continue;
    }
    if (byKey.has(key)) {
      problems.push(`"${key}" twice — the first kept.`);
      continue;
    }
    const node: PlanNode = {
      key,
      kind,
      parent: str(r.parent, 80) || null,
      title,
      summary: str(r.summary, 1200) || undefined,
      objectives: strs(r.objectives, 12),
      requires: strs(r.requires, 30, 80),
      path: str(r.path, 80) || undefined,
      xp: num(r.xp) ?? DEFAULT_XP[kind],
      minutes: num(r.minutes),
      sources: strs(r.sources, 20, 60).filter((id) => sourceIds.has(id)),
    };
    nodes.push(node);
    byKey.set(key, node);
  }

  // Parents: there, and no loop (a node can't be its own ancestor) — else at the top.
  for (const n of nodes) {
    if (n.parent && !byKey.has(n.parent)) {
      problems.push(`"${n.title}": its parent "${n.parent}" isn't in the plan — put at the top.`);
      n.parent = null;
    }
  }
  for (const n of nodes) {
    const seen = new Set<string>([n.key]);
    for (let p = n.parent; p; p = byKey.get(p)?.parent ?? null) {
      if (seen.has(p)) {
        problems.push(`"${n.title}": its parents go round in a circle — put at the top.`);
        n.parent = null;
        break;
      }
      seen.add(p);
    }
  }
  const ancestors = (key: string): Set<string> => {
    const out = new Set<string>();
    for (let p = byKey.get(key)?.parent ?? null; p && !out.has(p); p = byKey.get(p)?.parent ?? null) out.add(p);
    return out;
  };

  // Requirements: on nodes that are there, not the node itself or its ancestors.
  for (const n of nodes) {
    const up = ancestors(n.key);
    const kept: string[] = [];
    for (const r of n.requires ?? []) {
      if (!byKey.has(r) || r === n.key || up.has(r)) {
        problems.push(`"${n.title}": requires "${r}", which ${byKey.has(r) ? "it is part of" : "isn't in the plan"} — dropped.`);
        continue;
      }
      if (!kept.includes(r)) kept.push(r);
    }
    n.requires = kept;
  }

  // The foundations — the first phase's skills — are learned one after another, in depth (each requires the one before);
  // what builds on them builds on the last one: the breadth comes after.
  const firstPhase = nodes.find((n) => n.kind === "phase");
  if (firstPhase) {
    const found = nodes.filter((n) => n.kind === "skill" && n.parent === firstPhase.key);
    const inFound = new Set(found.map((f) => f.key));
    found.forEach((f, i) => {
      const own = (f.requires ?? []).filter((r) => !inFound.has(r));
      f.requires = i ? [...own, found[i - 1].key] : own;
    });
    const last = found[found.length - 1]?.key;
    if (last)
      for (const n of nodes) {
        if (inFound.has(n.key) || !(n.requires ?? []).some((r) => inFound.has(r))) continue;
        n.requires = [...new Set([...(n.requires ?? []).filter((r) => !inFound.has(r)), last])];
      }
  }

  // No cycle of requirements: a depth-first walk drops the edge that closes one.
  const state = new Map<string, "open" | "done">();
  const visit = (key: string) => {
    state.set(key, "open");
    const n = byKey.get(key)!;
    for (const r of [...(n.requires ?? [])]) {
      const s = state.get(r);
      if (s === "open") {
        n.requires = (n.requires ?? []).filter((x) => x !== r);
        problems.push(`"${n.title}" and "${byKey.get(r)?.title}" require each other (a cycle) — that requirement dropped.`);
      } else if (!s) visit(r);
    }
    state.set(key, "done");
  };
  for (const n of nodes) if (!state.has(n.key)) visit(n.key);

  const years = num(o.years);
  return {
    plan: { title: str(o.title, 200), summary: str(o.summary, 3000), years: years ? Math.min(10, years) : 0, sources, nodes },
    problems,
  };
}

/**
 * How a plan branches: its skills' paths, and per phase the most skills side by side (the widest layer of its skills by
 * their requirements inside the phase). Linear: fewer than two paths, or most phases a single chain of skills.
 */
export function planShape(plan: Plan): { paths: number; widths: number[]; linear: boolean } {
  const skills = plan.nodes.filter((n) => n.kind === "skill");
  const paths = new Set(skills.map((s) => s.path).filter(Boolean)).size;
  const widths: number[] = [];
  for (const phase of plan.nodes.filter((n) => n.kind === "phase")) {
    const inPhase = skills.filter((s) => s.parent === phase.key);
    if (!inPhase.length) continue;
    const keys = new Set(inPhase.map((s) => s.key));
    const depth = new Map<string, number>();
    const depthOf = (key: string, seen: Set<string>): number => {
      if (depth.has(key)) return depth.get(key)!;
      if (seen.has(key)) return 0;
      seen.add(key);
      const s = inPhase.find((x) => x.key === key)!;
      const d = (s.requires ?? []).filter((r) => keys.has(r)).reduce((m, r) => Math.max(m, depthOf(r, seen) + 1), 0);
      depth.set(key, d);
      return d;
    };
    const count = new Map<number, number>();
    for (const s of inPhase) {
      const d = depthOf(s.key, new Set());
      count.set(d, (count.get(d) ?? 0) + 1);
    }
    widths.push(Math.max(...count.values()));
  }
  // (The first phase — the foundations — is a chain on purpose: learned one after another. The breadth is judged after it.)
  const after = widths.slice(1);
  const branching = after.filter((w) => w >= 2).length;
  return { paths, widths, linear: paths < 2 || (after.length > 0 && branching * 2 < after.length) };
}
