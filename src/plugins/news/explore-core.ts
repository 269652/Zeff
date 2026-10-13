import { buildGraph, type Graph } from "./graph";
import { flat } from "./normalize";
import { stemDe } from "./nlp";
import { tokens } from "./shared";

/**
 * The map behind Explore: from the headlines, the things they are about (people, places, companies, topics) and how
 * those things hang together — two things are related when stories mention them together. Pure; the page feeds it
 * the recent items. From it come the bubbles you hop between: what is rising now, what is related to the thing you are
 * on, and what is out there that you haven't looked at.
 */
/** The key of a tag: accents, case and hyphens out, each word stemmed — "Supermärkte", "Supermärkten" and "supermarkte" are one thing. */
export const normKey = (t: string): string => t.split(/[\s-]+/).filter(Boolean).map((w) => stemDe(flat(w))).join(" ");

export type ExploreItem = { id: number; title: string; summary: string; publishedAt: string; sourceName: string; /** Its tags (the AI's or the corpus tagger's); without, the headline's own names. */ tags?: string[]; /** The story it belongs to. */ story?: string };
export type Bubble = { term: string; count: number; weight: number; kind: "trend" | "related" | "yours" | "wild" };

/** Words that are capitalised in German headlines (every noun) but name nothing in particular. */
const COMMON = new Set(
  "Neue Neuer Neues Neuen Meldung Nachricht Nachrichten Thema Themen Jahr Jahre Jahren Woche Woch Tag Tage Zeit Mann Frau Leute Land Stadt Welt Mensch Menschen Prozent Millionen Milliarden Euro Dollar Mehr Weniger Gegen Nach Vor Über Unter Für Mit Bei Von Der Die Das Den Dem Des Ein Eine Einer Hat Haben Wird Werden Wurde Wurden Ist Sind War Sei Kann Muss Soll Will Alle Alles Auch Aber Oder Und Wie Was Wer Wo Wann Warum Wieso Heute Morgen Gestern Jetzt Schon Noch Immer Wieder Kein Keine Ohne Doch Dann Nun Hier Dort Ihre Ihr Seine Sein Unser Diese Dieser Dieses Erste Ersten Erster Zweite Letzte Letzten Große Großen Neue The And For With From That This What Why How When Where Who Will Would Could Should After Before Over Under Into About More Less New News Says Said First Last Why".split(" "),
);

/** What a headline names: runs of capitalised words ("Elon Musk", "Deutsche Bahn"), single capitalised names and the longer words. */
export function keyTerms(title: string, summary = ""): string[] {
  const text = `${title}. ${summary.slice(0, 160)}`;
  const out = new Map<string, string>(); // lower → as written
  const add = (t: string) => {
    const k = t.toLowerCase();
    if (k.length >= 4 && !out.has(k)) out.set(k, t);
  };
  // Runs of two or more capitalised words (a name), then single capitalised words not at the start of a sentence.
  for (const m of text.matchAll(/(?:^|[^\p{L}])((?:[\p{Lu}][\p{L}'’-]+)(?:\s+[\p{Lu}][\p{L}'’-]+)+)/gu)) {
    const run = m[1].replace(/\s+/g, " ").trim();
    const words = run.split(" ").filter((w) => !COMMON.has(w));
    if (words.length >= 2) add(words.join(" "));
  }
  for (const m of text.matchAll(/(?<=[\p{Ll}\d,;:)"“”‚‘’»«] )([\p{Lu}][\p{L}-]{3,})/gu)) if (!COMMON.has(m[1])) add(m[1]);
  // The longer lower-case words (topics: "klimaschutz", "quantencomputer"), only the title's.
  for (const w of tokens(title).filter((x) => x.length >= 8 && !COMMON.has(x[0].toUpperCase() + x.slice(1))).slice(0, 6)) add(w);
  return [...out.values()];
}

export type Index = {
  /** term (lower) → display form, the item ids that name it. */
  terms: Map<string, { display: string; items: Set<number> }>;
  items: Map<number, ExploreItem & { terms: string[] }>;
  /** The graph of things named together, with its communities (Louvain). */
  graph: Graph;
};

export function buildIndex(items: ExploreItem[]): Index {
  const terms: Index["terms"] = new Map();
  const map: Index["items"] = new Map();
  // (a tag is shown the way most items write it)
  const shown = new Map<string, Map<string, number>>();
  for (const it of items) {
    const ts = it.tags && it.tags.length ? it.tags : keyTerms(it.title, it.summary);
    map.set(it.id, { ...it, terms: [...new Set(ts.map(normKey))] });
    for (const t of ts) {
      const k = normKey(t);
      const cur = terms.get(k);
      const seen = (shown.get(k) ?? shown.set(k, new Map()).get(k)!);
      seen.set(t, (seen.get(t) ?? 0) + 1);
      if (cur) cur.items.add(it.id);
      else terms.set(k, { display: t, items: new Set([it.id]) });
    }
  }
  for (const [k, forms] of shown) terms.get(k)!.display = [...forms].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
  const graph = buildGraph([...map.values()].map((i) => i.terms));
  return { terms, items: map, graph };
}

const cap = (n: number, max: number) => Math.max(0.15, Math.min(1, n / max));

/** What is rising: things named by several items, more in the last day than before, not so common that they mean nothing. */
export function trending(ix: Index, nowMs: number, limit = 14): Bubble[] {
  const total = ix.items.size || 1;
  const day = nowMs - 864e5;
  const scored = [...ix.terms.entries()].flatMap(([k, v]) => {
    const n = v.items.size;
    if (n < 3 || n > total * 0.15) return [];
    let recent = 0;
    for (const id of v.items) if (Date.parse(ix.items.get(id)!.publishedAt) >= day) recent++;
    const before = n - recent;
    return [{ k, v, n, score: recent * Math.log(2 + recent / (1 + before)) * (k.includes(" ") ? 1.3 : 1) }];
  });
  const top = scored.sort((a, b) => b.score - a.score).slice(0, limit);
  const max = top[0]?.score || 1;
  return top.map(({ v, n, score }) => ({ term: v.display, count: n, weight: cap(score, max), kind: "trend" as const }));
}

/** What hangs together with a term: the other things its stories name, by how often together relative to how common each is. */
export function related(ix: Index, term: string, limit = 12): Bubble[] {
  const key = normKey(term);
  const here = ix.terms.get(key);
  if (!here) return [];
  // From the graph: the strongest neighbours (lift × how often together) — not the term's own words, not what is in every story.
  const node = ix.graph.index.get(key);
  if (node !== undefined) {
    const mine = key;
    const picked = ix.graph.neighbors[node]
      .map((n) => ({ t: ix.graph.keys[n.to], c: n.co, s: n.strength }))
      .filter((n) => !n.t.includes(mine) && !mine.includes(n.t) && (ix.terms.get(n.t)?.items.size ?? 0) <= ix.items.size * 0.15)
      .slice(0, limit);
    if (picked.length) {
      const max = picked[0].s || 1;
      return picked.map((n) => ({ term: ix.terms.get(n.t)?.display ?? n.t, count: n.c, weight: cap(n.s, max), kind: "related" as const }));
    }
  }
  const co = new Map<string, number>();
  for (const id of here.items) for (const t of ix.items.get(id)!.terms) if (t !== key) co.set(t, (co.get(t) ?? 0) + 1);
  const scored = [...co].flatMap(([t, c]) => {
    const other = ix.terms.get(t)!;
    // Not the term's own words again ("klimaschutz" under "Klimaschutz Gesetz"), nor a thing that is in every story.
    if (t.includes(key) || key.includes(t) || other.items.size > ix.items.size * 0.15) return [];
    return [{ t, c, score: c / Math.sqrt(here.items.size * other.items.size) + c * 0.01 }];
  });
  const top = scored.sort((a, b) => b.score - a.score).slice(0, limit);
  const max = top[0]?.score || 1;
  return top.map(({ t, c, score }) => ({ term: ix.terms.get(t)!.display, count: c, weight: cap(score, max), kind: "related" as const }));
}

/** Things out there that are not near what you read: named by a few items (3–8), not related to what you give. */
export function wild(ix: Index, near: string[], seed: number, limit = 8): Bubble[] {
  const nearKeys = new Set(near.map(normKey));
  // The communities your things are in: out there is another world.
  const nearWorlds = new Set([...nearKeys].flatMap((k) => (ix.graph.index.has(k) ? [ix.graph.community[ix.graph.index.get(k)!]] : [])));
  const nearItems = new Set<number>();
  for (const n of nearKeys) for (const id of ix.terms.get(n)?.items ?? []) nearItems.add(id);
  const pool = [...ix.terms.entries()].filter(([k, v]) => {
    const c = v.items.size;
    if (c < 3 || c > 8 || nearKeys.has(k)) return false;
    let overlap = 0;
    for (const id of v.items) if (nearItems.has(id)) overlap++;
    const node = ix.graph.index.get(k);
    if (node !== undefined && nearWorlds.has(ix.graph.community[node])) return false;
    return overlap / c < 0.25;
  });
  // A seeded shuffle: the same for a while, different later.
  const rnd = (i: number) => {
    const x = Math.sin(seed * 9301 + i * 49297) * 233280;
    return x - Math.floor(x);
  };
  return pool
    .map(([, v], i) => ({ v, r: rnd(i) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, limit)
    .map(({ v }) => ({ term: v.display, count: v.items.size, weight: 0.4 + (v.items.size - 3) / 12, kind: "wild" as const }));
}

/** The bubbles' places: the middle one at the centre, the rest on rings round it (angles spread, a stable nudge per term). Percent of the field. */
export function layout(terms: string[], opts: { rings?: number } = {}): { x: number; y: number; ring: number }[] {
  const n = terms.length;
  const perRing = Math.ceil(n / (opts.rings ?? 2));
  const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return terms.map((t, i) => {
    const ring = Math.floor(i / perRing);
    const inRing = Math.min(perRing, n - ring * perRing);
    const a = ((i % perRing) / inRing) * Math.PI * 2 + ring * 0.5 + ((hash(t) % 100) / 100 - 0.5) * 0.25;
    // The rings share the room: the innermost at about 45%, the outermost at 100% of 38 (percent of the field).
    const rings = opts.rings ?? 2;
    const frac = rings <= 1 ? 0.75 : 0.45 + 0.55 * (ring / (rings - 1));
    const r = 38 * frac + ((hash(t + "r") % 100) / 100) * 2;
    const clamp = (v: number) => Math.max(7, Math.min(93, v));
    return { x: Math.round(clamp(50 + Math.cos(a) * r * 1.15) * 10) / 10, y: Math.round(clamp(50 + Math.sin(a) * r) * 10) / 10, ring };
  });
}
