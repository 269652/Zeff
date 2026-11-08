/**
 * A layered drawing of a directed graph (a skill tree, a plan): each node one column after the longest way into it, the
 * rows of a column ordered by where their neighbours are (barycenter sweeps), so lines cross as little as they can.
 * Pure — client and server.
 */
export type DagNode = { key: string; after: string[] };
export type DagLayout = { pos: Map<string, { col: number; row: number }>; cols: number; rows: number };

export function layoutDag(nodes: DagNode[], sweeps = 4): DagLayout {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const preds = new Map(nodes.map((n) => [n.key, [...new Set(n.after)].filter((k) => k !== n.key && byKey.has(k))]));
  const succs = new Map<string, string[]>(nodes.map((n) => [n.key, []]));
  for (const [k, ps] of preds) for (const p of ps) succs.get(p)!.push(k);

  // Columns: the longest way in (a cycle's closing edge counts as nothing).
  const col = new Map<string, number>();
  const busy = new Set<string>();
  const colOf = (k: string): number => {
    if (col.has(k)) return col.get(k)!;
    if (busy.has(k)) return 0;
    busy.add(k);
    const c = preds.get(k)!.reduce((m, p) => Math.max(m, colOf(p) + 1), 0);
    busy.delete(k);
    col.set(k, c);
    return c;
  };
  for (const n of nodes) colOf(n.key);
  const cols = nodes.length ? Math.max(...col.values()) + 1 : 0;
  const layers: string[][] = Array.from({ length: cols }, () => []);
  for (const n of nodes) layers[col.get(n.key)!].push(n.key);

  // Rows: sweep right then left, each node to the mean row of its neighbours in the column before (after).
  const rowOf = new Map<string, number>();
  const settle = () => layers.forEach((l) => l.forEach((k, i) => rowOf.set(k, i)));
  settle();
  const order = (layer: string[], near: (k: string) => string[]) => {
    const at = new Map(layer.map((k, i) => [k, i]));
    const score = (k: string) => {
      const ns = near(k).filter((x) => rowOf.has(x));
      return ns.length ? ns.reduce((s, x) => s + rowOf.get(x)!, 0) / ns.length : at.get(k)!;
    };
    const scored = layer.map((k) => [k, score(k)] as const);
    scored.sort((a, b) => a[1] - b[1] || at.get(a[0])! - at.get(b[0])!);
    layer.splice(0, layer.length, ...scored.map(([k]) => k));
    layer.forEach((k, i) => rowOf.set(k, i));
  };
  for (let s = 0; s < sweeps; s++) {
    for (let c = 1; c < cols; c++) order(layers[c], (k) => preds.get(k)!);
    for (let c = cols - 2; c >= 0; c--) order(layers[c], (k) => succs.get(k)!);
  }
  // Last, left to right once more — so a column follows the one before it.
  for (let c = 1; c < cols; c++) order(layers[c], (k) => preds.get(k)!);

  const pos = new Map<string, { col: number; row: number }>();
  for (const n of nodes) pos.set(n.key, { col: col.get(n.key)!, row: rowOf.get(n.key)! });
  return { pos, cols, rows: layers.reduce((m, l) => Math.max(m, l.length), 0) };
}
