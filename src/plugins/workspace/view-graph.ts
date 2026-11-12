/**
 * A graph for views (<graph>): things that depend on each other — a skill tree, a build plan, an org chart, a process — laid out in columns
 * (a thing stands one column after everything it needs), optionally in bands (a group each), with the lines between them and, if asked, a
 * thread through some of them in order (solid where it was walked, dashed ahead). Pure: nodes in, positions out; the page draws it.
 * Client-safe.
 */
export type GraphNodeIn = {
  id: string;
  label: string;
  /** The ids this one needs (they stand in columns before it). */
  requires: string[];
  /** A band: nodes of one group stand in one horizontal strip. */
  group?: string;
  color?: string;
  /** "done" (ticked), "locked" (a lock), anything else: open. */
  state?: string;
  /** 0..1: the ring around the node. */
  progress?: number;
  /** Small text in the ring ("2/3"). */
  ring?: string;
};

export type GraphNode = GraphNodeIn & { x: number; y: number; col: number; step?: number };
export type GraphEdge = { from: string; to: string; d: string };
export type GraphBand = { group: string; y: number; h: number };
export type GraphLayout = {
  width: number;
  height: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  bands: GraphBand[];
  /** The thread: a path per stretch (a → b), the stretches numbered from 1, `walked`: how many are solid. */
  thread: { d: string; n: number; solid: boolean }[];
};

export const NODE_R = 26;
const COL_W = 168;
const ROW_H = 112;
const PAD_X = 48;
const PAD_Y = 36;
const BAND_GAP = 18;
export const MAX_GRAPH_NODES = 300;

const curve = (x1: number, y1: number, x2: number, y2: number): string => {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
};

/**
 * The layout. `thread`: ids in the order the thread goes; `walked`: how many of its first stretches were walked. Ids that are not nodes are left
 * out; a need on an id that is not a node is ignored; a cycle does not hang it (a node in one stands where the walk found it).
 */
export function layoutGraph(input: GraphNodeIn[], opts: { thread?: string[]; walked?: number } = {}): GraphLayout {
  const list = input.slice(0, MAX_GRAPH_NODES);
  const known = new Set(list.map((n) => n.id));
  const needs = new Map(list.map((n) => [n.id, n.requires.filter((r) => known.has(r) && r !== n.id)]));
  // Column = longest chain of needs before it (a cycle: the walk stops where it comes back).
  const col = new Map<string, number>();
  const level = (id: string, path: Set<string>): number => {
    const have = col.get(id);
    if (have !== undefined) return have;
    if (path.has(id)) return 0;
    path.add(id);
    const c = Math.max(-1, ...(needs.get(id) ?? []).map((r) => level(r, path))) + 1;
    path.delete(id);
    col.set(id, c);
    return c;
  };
  for (const n of list) level(n.id, new Set());

  const groups = [...new Set(list.map((n) => n.group ?? ""))];
  const banded = groups.some((g) => g !== "");
  // Rows: within a band (or the whole graph), the nodes of a column one under the other in the order given.
  const rowIn = new Map<string, number>();
  const bandRows = new Map<string, number>();
  const count = new Map<string, number>();
  for (const n of list) {
    const k = `${n.group ?? ""}|${col.get(n.id)}`;
    const r = count.get(k) ?? 0;
    count.set(k, r + 1);
    rowIn.set(n.id, r);
    bandRows.set(n.group ?? "", Math.max(bandRows.get(n.group ?? "") ?? 0, r + 1));
  }
  const bandTop = new Map<string, number>();
  let y = PAD_Y;
  for (const g of groups) {
    bandTop.set(g, y);
    y += (bandRows.get(g) ?? 1) * ROW_H + (banded ? BAND_GAP : 0);
  }
  const nodes: GraphNode[] = list.map((n) => ({ ...n, col: col.get(n.id) ?? 0, x: PAD_X + (col.get(n.id) ?? 0) * COL_W + NODE_R, y: (bandTop.get(n.group ?? "") ?? PAD_Y) + (rowIn.get(n.id) ?? 0) * ROW_H + ROW_H / 2 - 8 }));
  const at = new Map(nodes.map((n) => [n.id, n]));
  const edges: GraphEdge[] = [];
  for (const n of nodes) for (const r of needs.get(n.id) ?? []) {
    const a = at.get(r)!;
    edges.push({ from: r, to: n.id, d: curve(a.x + NODE_R, a.y, n.x - NODE_R, n.y) });
  }
  const bands: GraphBand[] = banded ? groups.filter((g) => g !== "").map((g) => ({ group: g, y: (bandTop.get(g) ?? 0) - 8, h: (bandRows.get(g) ?? 1) * ROW_H })) : [];

  // The thread: from node to node in the order given, in the space beside them (out of the right edge, into the left; a step back goes around).
  const order = (opts.thread ?? []).filter((id) => at.has(id));
  const thread: GraphLayout["thread"] = [];
  order.forEach((id, i) => {
    const b = at.get(id)!;
    b.step = i + 1;
    if (i === 0) return;
    const a = at.get(order[i - 1])!;
    const back = a.x >= b.x;
    const d = back ? `M${a.x},${a.y + NODE_R} C${a.x},${a.y + NODE_R + 40} ${b.x},${b.y - NODE_R - 40} ${b.x},${b.y - NODE_R}` : curve(a.x + NODE_R, a.y + 10, b.x - NODE_R, b.y + 10);
    thread.push({ d, n: i + 1, solid: i <= (opts.walked ?? 0) });
  });
  return { width: PAD_X * 2 + Math.max(0, ...nodes.map((n) => n.col)) * COL_W + NODE_R * 2, height: Math.max(y, PAD_Y + ROW_H), nodes, edges, bands, thread };
}
