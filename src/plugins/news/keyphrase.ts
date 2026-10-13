import { GAZETTEER } from "./gazetteer";
import { chunks, detectLang, type Chunk, type Lang } from "./nlp";
import { looksLikeName, ROLE } from "./names";
import { normalizeTags } from "./normalize";

/**
 * Keyphrase extraction over a whole corpus, with standard statistics instead of rules of thumb:
 *   · candidates are n-grams (1–3 words) inside chunks — runs of content words between punctuation and stop words — keyed by
 *     their stems, so inflections and spellings merge;
 *   · a unigram is a term when several documents use it and not nearly all (document frequency window); a bigram or
 *     trigram must be a collocation — its words occur together far more often than chance (pointwise mutual information) —
 *     or look like a name (a given name in front, an organisation word at the end) or be in the gazetteer;
 *   · each candidate is scored TF-IDF style, boosted for the headline, for being a collocation and for being a known name;
 *   · a single word must also be cohesive: its documents share another strong term (Rücktritt ↔ Bärbel Bas), a common word
 *     is spread over unrelated ones;
 *   · each document keeps its few best terms, a longer phrase replacing its own words.
 * Also gives each document a TF-IDF vector (L2-normalised) for similarity and clustering. Pure.
 */
export type Doc = { id: number; title: string; summary: string };
export type Term = { key: string; name: string; score: number; kind: "name" | "phrase" | "word" | "acronym" | "place" | "org" | "company" | "person" | "topic" };
export type Vector = Map<string, number>;
export type Analysis = {
  tags: Map<number, Term[]>;
  vectors: Map<number, Vector>;
  /** Document frequency of every term key. */
  df: Map<string, number>;
  /** How a term key is shown. */
  display: Map<string, string>;
  n: number;
  lang: Map<number, Lang>;
};

/** Words that are in every headline and say nothing (generic nouns, section names, filler). */
export const GENERIC = new Set(
  `meldung nachricht nachrichten thema themen jahr jahre woche monat zeit mann männer frau frauen kind kinder leute land länder stadt welt mensch menschen leben fall fälle frage fragen grund gründe plan pläne gesetz gesetze regierung chef chefin
   million millionen milliarde milliarden euro dollar studie studien bericht berichte experten experte forscher forscherin polizei video videos fotos foto live update analyse kommentar interview ticker liveblog newsletter podcast bilder überblick hintergrund
   montag dienstag mittwoch donnerstag freitag samstag sonntag januar februar märz april mai juni juli august september oktober november dezember
   präsident präsidentin kanzler kanzlerin minister ministerin
   problem probleme chance folgen rechte recht nutzer gefahr angriff angriffe entwicklung entwicklungen minuten minute nacht grad kritik punkt partei parteien gewalt netz download wirtschaft politik kultur gesellschaft sport preis preise ergebnis ergebnisse lage situation
   anzeige anzeigen werbung geschichte geschichten folge episode tipps tipp mitte ende anfang teil teile weg wege platz plätze
   news report study police video photos update analysis opinion review reviews tips guide monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december
   published online article articles advertisement sponsored read more subscribe
   president minister chancellor prime tool tools using use used build built make makes made get gets getting best top worst why how what year years week month day days time times people world life case question reason plan law government
   million billion percent dollar company companies group groups state states country countries city cities`
    .split(/\s+/)
    .filter(Boolean),
);

const ACRO_BLOCK = new Set("OK TV AM PM NEU LIVE TOP VS IMAGO DPA AFP APA SDA FC SC SV VFB VFL TSV RB PA UPI GMT CET".split(" "));

type Cand = { key: string; n: number; surfaces: Map<string, number>; title: boolean; tf: number; caps: number; midCaps: number; tokens: number; names: boolean };
const isAcronym = (w: string) => w.length >= 2 && w.length <= 6 && w === w.toUpperCase() && /\p{L}/u.test(w) && !ACRO_BLOCK.has(w);

/** The n-gram candidates of a chunk list, keyed by stems. */
function grams(cs: Chunk[], inTitle: boolean, into: Map<string, Cand>, maxN = 3): void {
  for (const ch of cs) {
    for (let i = 0; i < ch.length; i++) {
      for (let n = 1; n <= maxN && i + n <= ch.length; n++) {
        const toks = ch.slice(i, i + n);
        // A phrase doesn't start or end with a generic word.
        if (GENERIC.has(toks[0].lower) || GENERIC.has(toks[n - 1].lower)) continue;
        if (n === 1 && toks[0].lower.length < 4 && !isAcronym(toks[0].surface)) continue;
        // A role or title in front of a name is not part of it ("Arbeitsministerin Bas").
        if (n >= 2 && ROLE.test(toks[0].surface)) continue;
        const key = toks.map((t) => t.stem).join(" ");
        const surface = toks.map((t) => t.surface).join(" ");
        const cur = into.get(key) ?? { key, n, surfaces: new Map(), title: false, tf: 0, caps: 0, midCaps: 0, tokens: n, names: false };
        cur.surfaces.set(surface, (cur.surfaces.get(surface) ?? 0) + 1);
        cur.title ||= inTitle;
        cur.tf++;
        if (toks.every((t) => t.cap)) {
          cur.caps++;
          if (toks.every((t) => !t.start)) cur.midCaps++;
          if (n >= 2) cur.names = true;
        }
        into.set(key, cur);
      }
    }
  }
}

export type AnalyzeOptions = { maxTags?: number };

export function analyze(docs: Doc[], opts: AnalyzeOptions = {}): Analysis {
  const maxTags = opts.maxTags ?? 4;
  const N = Math.max(1, docs.length);
  // Languages: each document's own, else the corpus's commonest.
  const langs = new Map<number, Lang>();
  const count = new Map<Lang, number>();
  for (const d of docs) {
    const l = detectLang(`${d.title}. ${d.summary.slice(0, 160)}`);
    langs.set(d.id, l);
    if (l !== "xx") count.set(l, (count.get(l) ?? 0) + 1);
  }
  const majority = ([...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "de") as Lang;
  for (const [id, l] of langs) if (l === "xx") langs.set(id, majority);

  // Pass 1: candidates per document, corpus document frequencies.
  const per = new Map<number, Map<string, Cand>>();
  const df = new Map<string, number>();
  const surfaceCount = new Map<string, Map<string, number>>();
  for (const d of docs) {
    const lang = langs.get(d.id)!;
    const m = new Map<string, Cand>();
    grams(chunks(d.title, lang), true, m);
    grams(chunks(d.summary.slice(0, 220), lang), false, m);
    per.set(d.id, m);
    for (const [k, c] of m) {
      df.set(k, (df.get(k) ?? 0) + 1);
      const sc = surfaceCount.get(k) ?? new Map();
      for (const [s, n] of c.surfaces) sc.set(s, (sc.get(s) ?? 0) + n);
      surfaceCount.set(k, sc);
    }
  }
  const display = new Map<string, string>();
  for (const [k, sc] of surfaceCount) {
    const best = [...sc].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
    // The gazetteer's canonical name when it knows the phrase.
    const g = GAZETTEER.get(best.toLowerCase());
    display.set(k, g ? g.name : best);
  }

  const lift = (key: string, n: number): number => {
    // Pointwise mutual information of a phrase against its words: how much more often together than by chance.
    const parts = key.split(" ");
    if (parts.length < 2) return 0;
    const dAll = df.get(key) ?? 0;
    const pa = parts.reduce((acc, p) => acc * ((df.get(p) ?? 1) / N), 1);
    return Math.log(Math.max(1e-9, dAll / N) / Math.max(1e-9, pa)) / (n > 2 ? 1.6 : 1);
  };

  // Eligible terms and their scores per document.
  type Scored = { key: string; score: number; kind: Term["kind"]; n: number };
  const strongOf = new Map<number, Set<string>>();
  const scored = new Map<number, Scored[]>();
  for (const d of docs) {
    const out: Scored[] = [];
    for (const [key, c] of per.get(d.id)!) {
      const dfk = df.get(key) ?? 1;
      const surface = [...c.surfaces.keys()][0];
      const lang = langs.get(d.id)!;
      const capRatio = c.caps / Math.max(1, c.tf);
      const g = GAZETTEER.get(surface.toLowerCase());
      let kind: Term["kind"] = "word";
      let boost = 1;
      if (g) {
        kind = g.kind;
        boost = 2;
        if (surface.length <= 3 && surface !== g.name && ![...c.surfaces.keys()].some((s) => s === s.toUpperCase())) continue;
      } else if (c.n === 1 && isAcronym(surface)) kind = "acronym";
      else if (c.n >= 2) {
        const pmi = lift(key, c.n);
        const nameLike = c.names && looksLikeName(surface.split(" "));
        // German noun phrases and names are capitalised throughout; in English a phrase needs a capital or a very strong collocation;
        // other languages: names only.
        const shapeOk = lang === "de" ? capRatio >= 0.7 : lang === "en" ? capRatio >= 0.5 || (dfk >= 3 && pmi >= 4) : capRatio >= 0.7;
        if (nameLike) {
          kind = "name";
          boost = 1.4;
        } else if (dfk >= 2 && pmi >= 2.2 && shapeOk && dfk <= Math.max(6, N * 0.03)) {
          kind = "phrase";
          boost = 1.3 + Math.min(0.4, (pmi - 2.2) / 6);
        } else continue;
      } else {
        // A single word: several documents use it, not nearly all.
        const limit = Math.max(6, Math.round(N * 0.04));
        if (dfk < 3 || dfk > limit) continue;
        // German: nouns are capitalised wherever they stand — a lowercase word is a verb, adjective or adverb, not a term. English: a proper
        // noun is capitalised mid-sentence; a lowercase one must be a clear topic (several documents, no verb/adverb ending). Others: names only.
        const surfaceLower = surface.toLowerCase();
        if (lang === "de" && capRatio < 0.7) continue;
        // (a lowercase English word is a term only when it is plainly a noun-like topic: long, several documents, no verb/adverb ending)
        if (lang === "en" && capRatio < 0.5 && (dfk < 4 || /(ed|ing|ly|ful|ive|ous|ish|able|ness|ment|s)$/.test(surfaceLower) || surfaceLower.length < 6)) continue;
        if (lang !== "de" && lang !== "en" && (capRatio < 0.7 || c.midCaps === 0)) continue;
        // Capitalised in the middle of sentences in most uses: a name or a noun (in English, a proper noun).
        if (c.midCaps / Math.max(1, c.tf) > 0.5) boost = 1.15;
      }
      if (g && dfk > Math.max(8, N * 0.25)) continue;
      const idf = Math.log((N + 1) / (dfk + 0.5));
      const score = idf * (1 + 0.3 * Math.log(c.tf)) * (c.title ? 1 : 0.45) * boost;
      out.push({ key, score, kind, n: c.n });
    }
    scored.set(d.id, out);
    strongOf.set(d.id, new Set(out.filter((s) => s.kind !== "word").map((s) => s.key)));
  }

  // Cohesion of single words: the documents of a topic word share another strong term.
  const cohesive = new Set<string>();
  const docsOf = new Map<string, number[]>();
  for (const [id, list] of scored) for (const s of list) if (s.kind === "word" && s.n === 1) (docsOf.get(s.key) ?? docsOf.set(s.key, []).get(s.key)!).push(id);
  for (const [key, ids] of docsOf) {
    const co = new Map<string, number>();
    for (const id of ids) for (const sk of strongOf.get(id) ?? []) co.set(sk, (co.get(sk) ?? 0) + 1);
    // Phrases and names that contain the word itself don't count as "another" term.
    const top = Math.max(0, ...[...co].filter(([sk]) => !sk.split(" ").includes(key)).map(([, v]) => v));
    if (ids.length >= 3 && top / ids.length >= 0.45) cohesive.add(key);
  }

  const tags = new Map<number, Term[]>();
  for (const d of docs) {
    const list = (scored.get(d.id) ?? []).filter((s) => s.kind !== "word" || s.n > 1 || cohesive.has(s.key)).sort((a, b) => b.score - a.score);
    const kept: Scored[] = [];
    for (const s of list) {
      const parts = s.key.split(" ");
      // A longer phrase replaces its own words; a word already inside a kept phrase is not repeated.
      if (kept.some((k) => k.key !== s.key && k.key.split(" ").length > parts.length && parts.every((p) => k.key.split(" ").includes(p)))) continue;
      kept.push(s);
      if (kept.length >= maxTags) break;
    }
    // (A phrase that came later than its own word: the word goes.)
    const final = kept.filter((s) => !kept.some((k) => k.key !== s.key && k.key.split(" ").length > s.key.split(" ").length && s.key.split(" ").every((p) => k.key.split(" ").includes(p))));
    tags.set(d.id, final.map((s) => ({ key: s.key, name: display.get(s.key) ?? s.key, score: s.score, kind: s.kind })));
  }

  // TF-IDF vectors over the terms that carry meaning: stems (not generic, in a document window) and collocations.
  const vectors = new Map<number, Vector>();
  const maxDf = Math.max(8, Math.round(N * 0.06));
  for (const d of docs) {
    const v: Vector = new Map();
    for (const [key, c] of per.get(d.id)!) {
      const dfk = df.get(key) ?? 1;
      if (dfk < 2 || dfk > maxDf) continue;
      if (c.n === 1 && key.length < 4) continue;
      if (c.n >= 2 && lift(key, c.n) < 2.2 && !c.names) continue;
      v.set(key, (1 + Math.log(c.tf)) * Math.log((N + 1) / (dfk + 0.5)) * (c.title ? 2 : 1) * (c.n >= 2 ? 1.5 : 1));
    }
    let norm = 0;
    for (const x of v.values()) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (const [k, x] of v) v.set(k, x / norm);
    vectors.set(d.id, v);
  }
  // The normalisation pass: one tag for what is written differently (spellings, languages, a last name and its full name …).
  const norm = normalizeTags(tags, df, display);
  for (const [k, name] of norm.display) display.set(k, name);
  return { tags: norm.tags, vectors, df, display, n: N, lang: langs };
}

/** Cosine of two L2-normalised vectors. */
export function cosine(a: Vector, b: Vector): number {
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, x] of s) dot += x * (l.get(k) ?? 0);
  return dot;
}
