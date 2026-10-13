/**
 * The graph of things: tags are nodes, two tags are joined when stories name them together more often than chance (lift), and the
 * Louvain method (modularity maximisation, multi-level) finds the communities — "worlds" of tags that belong together (a political
 * crisis, a tech war, a football league). Related things are a node's strongest neighbours; the communities tell which things
 * are near what you read and which are far from it. Pure.
 */
export type Edge = [number, number, number];

/** Louvain community detection: a community id for every node 0..n-1. */
export function louvain(n: number, edges: Edge[], resolution = 1): number[] {
  // Level 0.
  let nodeCount = n;
  let adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (const [a, b, w] of edges) {
    if (a === b || w <= 0) continue;
    adj[a].set(b, (adj[a].get(b) ?? 0) + w);
    adj[b].set(a, (adj[b].get(a) ?? 0) + w);
  }
  let membership = Array.from({ length: n }, (_, i) => i); // original node → current community id (of the level)
  for (let level = 0; level < 12; level++) {
    const deg = adj.map((m) => [...m.values()].reduce((s, x) => s + x, 0));
    const m2 = deg.reduce((s, x) => s + x, 0); // 2m
    if (m2 === 0) break;
    const comm = Array.from({ length: nodeCount }, (_, i) => i);
    const tot = [...deg];
    let moved = true;
    let improvedAny = false;
    for (let pass = 0; moved && pass < 20; pass++) {
      moved = false;
      for (let i = 0; i < nodeCount; i++) {
        const ci = comm[i];
        const links = new Map<number, number>();
        for (const [j, w] of adj[i]) if (j !== i) links.set(comm[j], (links.get(comm[j]) ?? 0) + w);
        tot[ci] -= deg[i];
        let best = ci;
        let bestGain = (links.get(ci) ?? 0) - (resolution * tot[ci] * deg[i]) / m2;
        for (const [c, w] of links) {
          const gain = w - (resolution * tot[c] * deg[i]) / m2;
          if (gain > bestGain + 1e-12) {
            best = c;
            bestGain = gain;
          }
        }
        tot[best] += deg[i];
        if (best !== ci) {
          comm[i] = best;
          moved = true;
          improvedAny = true;
        }
      }
    }
    if (!improvedAny) break;
    // Renumber, map the original nodes, aggregate.
    const ids = new Map<number, number>();
    for (const c of comm) if (!ids.has(c)) ids.set(c, ids.size);
    membership = membership.map((c) => ids.get(comm[c])!);
    const next: Map<number, number>[] = Array.from({ length: ids.size }, () => new Map());
    for (let i = 0; i < nodeCount; i++) {
      for (const [j, w] of adj[i]) {
        const a = ids.get(comm[i])!;
        const b = ids.get(comm[j])!;
        next[a].set(b, (next[a].get(b) ?? 0) + w);
      }
    }
    // (self-loops hold the inner weight; every edge was visited twice, which Louvain's formulas expect)
    adj = next;
    nodeCount = ids.size;
    if (nodeCount <= 1) break;
  }
  return membership;
}

export type Graph = {
  /** Node index by term key. */
  index: Map<string, number>;
  keys: string[];
  /** Neighbours per node: other node, lift-based strength, how many items name both. */
  neighbors: { to: number; strength: number; co: number }[][];
  community: number[];
};

/**
 * The graph from the items' tags: nodes with at least two items, edges where two tags are named together `minCo` times or more at a
 * lift of two or better (so a term that is in everything — Berlin — doesn't tie the whole map together).
 */
export function buildGraph(itemTags: string[][], opts: { minCo?: number; minLift?: number } = {}): Graph {
  const N = Math.max(1, itemTags.length);
  const df = new Map<string, number>();
  for (const tags of itemTags) for (const t of new Set(tags)) df.set(t, (df.get(t) ?? 0) + 1);
  const keys = [...df].filter(([, c]) => c >= 2).map(([k]) => k);
  const index = new Map(keys.map((k, i) => [k, i]));
  const co = new Map<string, number>();
  for (const tags of itemTags) {
    const u = [...new Set(tags)].filter((t) => index.has(t));
    for (let i = 0; i < u.length; i++) for (let j = i + 1; j < u.length; j++) {
      const a = index.get(u[i])!;
      const b = index.get(u[j])!;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      co.set(k, (co.get(k) ?? 0) + 1);
    }
  }
  const neighbors: Graph["neighbors"] = keys.map(() => []);
  const edges: Edge[] = [];
  for (const [k, c] of co) {
    if (c < (opts.minCo ?? 2)) continue;
    const [a, b] = k.split("|").map(Number);
    const lift = (c * N) / ((df.get(keys[a]) ?? 1) * (df.get(keys[b]) ?? 1));
    if (lift < (opts.minLift ?? 2)) continue;
    const strength = Math.log(lift) * Math.log(1 + c);
    neighbors[a].push({ to: b, strength, co: c });
    neighbors[b].push({ to: a, strength, co: c });
    edges.push([a, b, c]);
  }
  for (const list of neighbors) list.sort((x, y) => y.strength - x.strength);
  return { index, keys, neighbors, community: louvain(keys.length, edges) };
}
