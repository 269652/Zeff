import { cosine, type Term, type Vector } from "./keyphrase";

/**
 * Stories: reports about the same thing, grouped by content — leader (incremental) clustering of the documents' TF-IDF
 * vectors, in time order: a document joins the story whose centroid it resembles most (cosine similarity above a threshold, the
 * story still going within a time window), else it starts a new one. An inverted index over each story's strongest terms keeps it
 * from comparing everything with everything. A story is named after the tags most of its reports share.
 */
export type StoryDoc = { id: number; at: string };
export type Story = { key: string; label: string; items: number[]; terms: string[]; firstAt: string; lastAt: string };

type Cluster = { id: number; centroid: Vector; sum: Vector; items: number[]; first: number; last: number };

function addTo(sum: Vector, v: Vector): void {
  for (const [k, x] of v) sum.set(k, (sum.get(k) ?? 0) + x);
}
function normalised(sum: Vector): Vector {
  let n = 0;
  for (const x of sum.values()) n += x * x;
  n = Math.sqrt(n) || 1;
  const out: Vector = new Map();
  for (const [k, x] of sum) out.set(k, x / n);
  return out;
}

export type ClusterOptions = { threshold?: number; windowHours?: number; minSize?: number };

export function clusterStories(docs: StoryDoc[], vectors: Map<number, Vector>, tags: Map<number, Term[]>, opts: ClusterOptions = {}): Story[] {
  const threshold = opts.threshold ?? 0.32;
  const windowMs = (opts.windowHours ?? 96) * 3600e3;
  const clusters: Cluster[] = [];
  const index = new Map<string, Set<number>>();
  const ordered = [...docs].sort((a, b) => a.at.localeCompare(b.at));
  for (const d of ordered) {
    const v = vectors.get(d.id);
    const t = Date.parse(d.at);
    if (!v || !v.size) continue;
    // Candidate stories: those that have one of this document's strongest terms.
    const top = [...v].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const cand = new Set<number>();
    for (const [k] of top) for (const c of index.get(k) ?? []) cand.add(c);
    let best = -1;
    let bestScore = 0;
    for (const c of cand) {
      const cl = clusters[c];
      if (t - cl.last > windowMs) continue;
      const s = cosine(v, cl.centroid);
      // Two reports are one story when they share several terms, not just one big name (every Berlin item is not one story).
      let shared = 0;
      for (const [k, w] of v) if (w >= 0.08 && (cl.centroid.get(k) ?? 0) >= 0.08) shared++;
      if (shared < 2) continue;
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    let cl: Cluster;
    if (best >= 0 && bestScore >= threshold) {
      cl = clusters[best];
      cl.items.push(d.id);
      addTo(cl.sum, v);
      cl.centroid = normalised(cl.sum);
      cl.last = Math.max(cl.last, t);
    } else {
      cl = { id: clusters.length, centroid: v, sum: new Map(v), items: [d.id], first: t, last: t };
      clusters.push(cl);
    }
    for (const [k] of [...cl.centroid].sort((a, b) => b[1] - a[1]).slice(0, 12)) (index.get(k) ?? index.set(k, new Set()).get(k)!).add(cl.id);
  }

  const stories: Story[] = [];
  for (const cl of clusters) {
    if (cl.items.length < (opts.minSize ?? 2)) continue;
    // A story hangs together: its reports resemble the centre (a loose bunch under one big name isn't one).
    const mean = cl.items.reduce((a, id) => a + cosine(vectors.get(id) ?? new Map(), cl.centroid), 0) / cl.items.length;
    if (mean < 0.4) continue;
    // Named after the tags most reports share (and a second one, if many do).
    const count = new Map<string, { name: string; n: number }>();
    for (const id of cl.items) for (const tg of tags.get(id) ?? []) count.set(tg.key, { name: tg.name, n: (count.get(tg.key)?.n ?? 0) + 1 });
    const ranked = [...count.values()].filter((c) => c.n >= Math.max(2, Math.ceil(cl.items.length * 0.4))).sort((a, b) => b.n - a.n || b.name.length - a.name.length);
    const label = ranked.slice(0, 2).map((r) => r.name).join(" · ");
    if (!label) continue;
    stories.push({ key: `s${cl.id}-${cl.items[0]}`, label, items: cl.items, terms: ranked.map((r) => r.name), firstAt: new Date(cl.first).toISOString(), lastAt: new Date(cl.last).toISOString() });
  }
  return stories.sort((a, b) => b.items.length - a.items.length);
}
