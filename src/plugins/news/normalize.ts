import { GAZETTEER } from "./gazetteer";
import type { Term } from "./keyphrase";

/**
 * The normalisation pass over the tags — the same thing written differently becomes one tag:
 *   1. known names: every spelling the gazetteer knows (Russia, Rusia, Russland → Russland; AI, KI → Künstliche Intelligenz);
 *   2. spelling: case, accents, hyphens and spaces don't make a different tag (Saudi-Arabien = Saudi Arabien);
 *   3. names that contain each other: a last name that nearly always comes with the full name is the full name ("Hall" →
 *      "Robert Hall"), a name with a suffix is the name ("Walter White Jr" → "Walter White");
 *   4. near spellings: strings a character or two apart, both used more than once ("Champion League" → "Champions League");
 *   5. parts of a known phrase ("intelligence", "York") on their own are dropped.
 * The most used form of each tag is its name. Pure.
 */
export type Normalized = { tags: Map<number, Term[]>; canon: Map<string, string>; display: Map<string, string> };

/** Case, accents, hyphens, spaces and punctuation out. */
export const flat = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]/gu, "");

/** Edit distance, with an early out when it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const tokensOf = (s: string) => s.split(/[\s-]+/).filter(Boolean).map(flat);

/** Words that are only part of a known multi-word phrase ("intelligence" of "Künstliche Intelligenz"): not tags by themselves. */
const PHRASE_PARTS = (() => {
  const set = new Set<string>();
  for (const [k] of GAZETTEER) {
    const parts = k.split(/[\s-]+/);
    if (parts.length >= 2) for (const p of parts) if (p.length >= 5) set.add(flat(p));
  }
  // (but a part that is a known name on its own stays one: "York" is not, "Trump" is)
  for (const [k] of GAZETTEER) if (!/[\s-]/.test(k)) set.delete(flat(k));
  return set;
})();

export function normalizeTags(tags: Map<number, Term[]>, df: Map<string, number>, display: Map<string, string>): Normalized {
  // Documents per key, and each key's name.
  const docs = new Map<string, Set<number>>();
  for (const [id, list] of tags) for (const t of list) (docs.get(t.key) ?? docs.set(t.key, new Set()).get(t.key)!).add(id);
  const canon = new Map<string, string>();
  const names = new Map<string, string>();
  for (const k of docs.keys()) {
    canon.set(k, k);
    names.set(k, display.get(k) ?? k);
  }
  const root = (k: string): string => {
    let c = k;
    for (let i = 0; i < 6 && canon.get(c) !== c && canon.has(c); i++) c = canon.get(c)!;
    return c;
  };
  const merge = (from: string, to: string) => {
    const a = root(from);
    const b = root(to);
    if (a !== b) canon.set(a, b);
  };
  const dfOf = (k: string) => df.get(k) ?? docs.get(k)?.size ?? 1;

  // 1. Known names: one tag per gazetteer entry.
  for (const k of [...docs.keys()]) {
    const g = GAZETTEER.get((names.get(k) ?? k).toLowerCase());
    if (!g) continue;
    const target = `g:${g.name.toLowerCase()}`;
    names.set(target, g.name);
    docs.set(target, docs.get(target) ?? new Set());
    canon.set(target, target);
    merge(k, target);
  }
  const classDocs = () => {
    const out = new Map<string, Set<number>>();
    for (const k of docs.keys()) {
      const r = root(k);
      const set = out.get(r) ?? new Set<number>();
      for (const id of docs.get(k)!) set.add(id);
      out.set(r, set);
    }
    return out;
  };

  // 2. Spelling: the same letters, whatever the case, accents, hyphens and spaces.
  const byFlat = new Map<string, string[]>();
  for (const k of new Set([...docs.keys()].map(root))) {
    const f = flat(names.get(k) ?? k);
    if (f.length >= 3) (byFlat.get(f) ?? byFlat.set(f, []).get(f)!).push(k);
  }
  for (const group of byFlat.values()) if (group.length > 1) {
    group.sort((a, b) => dfOf(b) - dfOf(a));
    for (const k of group.slice(1)) merge(k, group[0]);
  }

  // 3. Names that contain each other.
  let cd = classDocs();
  const roots = () => [...cd.keys()];
  const share = (a: string, b: string) => {
    const A = cd.get(a)!;
    const B = cd.get(b)!;
    let n = 0;
    for (const id of A) if (B.has(id)) n++;
    return n / Math.max(1, A.size);
  };
  const named = roots().filter((r) => !r.startsWith("g:")).map((r) => ({ r, toks: tokensOf(names.get(r) ?? r) }));
  const multi = named.filter((x) => x.toks.length >= 2).sort((a, b) => b.toks.length - a.toks.length);
  for (const one of named.filter((x) => x.toks.length === 1 && x.toks[0].length >= 3)) {
    // A last name (or first name) that comes with one full name: that name.
    const owners = multi.filter((m) => m.toks[m.toks.length - 1] === one.toks[0] || m.toks[0] === one.toks[0]);
    const best = owners.map((m) => ({ m, s: share(one.r, m.r) })).sort((a, b) => b.s - a.s || dfOf(b.m.r) - dfOf(a.m.r))[0];
    if (best && best.s >= 0.7 && cd.get(best.m.r)!.size >= 2) merge(one.r, best.m.r);
  }
  cd = classDocs();
  for (const long of multi) for (const short of multi) {
    if (long.r === short.r || root(long.r) === root(short.r) || long.toks.length <= short.toks.length) continue;
    const prefix = short.toks.every((t, i) => long.toks[i] === t);
    const suffix = short.toks.every((t, i) => long.toks[long.toks.length - short.toks.length + i] === t);
    if (!(prefix || suffix)) continue;
    // "Walter White Jr" → "Walter White": the longer one is (nearly) only where the shorter is.
    if (share(root(long.r), root(short.r)) >= 0.7 && dfOf(short.r) >= dfOf(long.r)) merge(long.r, short.r);
  }

  // 4. Near spellings, both used more than once.
  cd = classDocs();
  const buckets = new Map<string, string[]>();
  for (const r of roots()) {
    const f = flat(names.get(r) ?? r);
    if (f.length >= 8 && cd.get(r)!.size >= 2) (buckets.get(f.slice(0, 3)) ?? buckets.set(f.slice(0, 3), []).get(f.slice(0, 3))!).push(r);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => cd.get(b)!.size - cd.get(a)!.size);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = flat(names.get(list[i]) ?? list[i]);
      const b = flat(names.get(list[j]) ?? list[j]);
      if (root(list[i]) !== root(list[j]) && editDistance(a, b, Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.12))) <= Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.12))) {
        // (a gazetteer name stays the one the others merge into)
        if (list[j].startsWith("g:") && !list[i].startsWith("g:")) merge(list[i], list[j]);
        else merge(list[j], list[i]);
      }
    }
  }

  // The name of each class: the gazetteer's, else the most used form.
  cd = classDocs();
  const out = new Map<string, string>();
  for (const r of cd.keys()) {
    const members = [...docs.keys()].filter((k) => root(k) === r);
    const g = members.find((k) => k.startsWith("g:"));
    out.set(r, g ? names.get(g)! : names.get(members.sort((a, b) => dfOf(b) - dfOf(a))[0]) ?? r);
  }

  // Rebuild every document's tags: one per class, the best score, parts of known phrases dropped.
  const result = new Map<number, Term[]>();
  for (const [id, list] of tags) {
    const best = new Map<string, Term>();
    for (const t of list) {
      const r = root(t.key);
      if (!r.startsWith("g:") && t.kind === "word" && PHRASE_PARTS.has(flat(t.name))) continue;
      const cur = best.get(r);
      if (!cur || cur.score < t.score) best.set(r, { ...t, key: r, name: out.get(r) ?? t.name });
    }
    result.set(id, [...best.values()].sort((a, b) => b.score - a.score));
  }
  const finalCanon = new Map<string, string>();
  for (const k of docs.keys()) finalCanon.set(k, root(k));
  return { tags: result, canon: finalCanon, display: out };
}
