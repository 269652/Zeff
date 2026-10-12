import { GAZETTEER, GAZETTEER_EXACT, GAZETTEER_MAX_WORDS, type Kind } from "./gazetteer";
import { FIRST_NAMES, looksLikeName, ROLE } from "./names";

/**
 * The tagger: what each headline is about — names (people, places, organisations, companies), acronyms and topics — decided
 * with the whole corpus in view, not headline by headline:
 *   · a gazetteer of well-known names and topics lifts what is certain (German nouns are all capitalised, so a capital
 *     letter alone says little);
 *   · runs of capitalised words are names ("Deutsche Bahn", "Elon Musk"), kept when more than one story names them;
 *   · single capitalised words and acronyms must be named by several stories (support), and not by nearly all of them;
 *   · variants are merged ("Musks" → "Musk" → "Elon Musk", a last name that always comes with its first name);
 *   · each headline keeps its few best tags, a longer name replacing its own parts.
 * Pure: items in, tags out.
 */
export type TagItem = { id: number; title: string; summary: string };
export type TagKind = Kind | "name" | "acronym" | "word";
export type Tagged = { name: string; kind: TagKind; score: number };

/** Capitalised words that name nothing: generic nouns, titles, days and months, headline filler (German and English). */
const GENERIC = new Set(
  `neue neuer neues neuen neuem meldung nachricht nachrichten thema themen jahr jahre jahren woche wochen monat monate tag tage zeit zeiten mann männer frau frauen kind kinder leute land länder stadt städte welt mensch menschen leben fall fälle frage fragen grund gründe plan pläne gesetz gesetze regierung chef chefin
   prozent million millionen milliarde milliarden euro dollar mehr weniger gegen nach vor über unter für mit bei von der die das den dem des ein eine einer einen einem hat haben wird werden wurde wurden ist sind war sei kann muss soll will alle alles auch aber oder und wie was wer wo wann warum wieso
   heute morgen gestern jetzt schon noch immer wieder kein keine ohne doch dann nun hier dort ihre ihr seine sein unser diese dieser dieses erste ersten erster zweite letzte letzten große großen kleine alte alten junge jungen
   studie studien bericht berichte experten experte forscher forscherin polizei video videos fotos foto live update analyse kommentar interview ticker liveblog newsletter podcast bilder überblick hintergrund
   montag dienstag mittwoch donnerstag freitag samstag sonntag januar februar märz april mai juni juli august september oktober november dezember
   präsident präsidentin kanzler kanzlerin minister ministerin bundeskanzler bundesminister senator premier premierminister außenminister außenministerin ceo
   the and for with from that this what why how when where who will would could should after before over under into about more less new news says said first last report study police video photos live update analysis opinion review
   monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december president minister chancellor prime
   el la los las una uno del por para con que como más pero también
   chance folgen rechte recht union problem probleme nutzer gefahr angriffe angriff entwicklungen entwicklung minuten minute nacht grad kritik punkt partei parteien gewalt netz download wirtschaft politik kultur gesellschaft sport preis preise ergebnis ergebnisse lage situation woche wochen
   tool tools using use used build built make makes made get gets getting best top worst why how what rival labs lab tips guide guides review reviews
   mitte published oct nov dec jan feb sep aug jul jun apr mar on in at of to by is it as an or if so up we
   mann frau mal teil seit dass bis weil wenn dabei damit dazu davon daran darauf worauf zwischen während trotz wegen laut nur sehr ganz viele vielen einige mehrere`
    .split(/\s+/)
    .filter(Boolean),
);

/** Titles in front of a name ("Präsident Biden", "Minister Lindner"): not part of it. */
const TITLES = new Set("präsident präsidentin kanzler kanzlerin bundeskanzler minister ministerin bundesminister außenminister außenministerin senator premier premierminister papst könig königin president chancellor prime minister senator ceo chef".split(" "));

/** All-capital words that are not acronyms of anything. */
const ACRO_BLOCK = new Set("OK TV AM PM NEU LIVE TOP VS UND OR AN IM ZU DER DIE DAS EIN IMAGO DPA AFP APA SDA FC SC SV VFB VFL TSV RB AP US PA UPI".split(" "));

type Tok = { raw: string; lower: string; start: boolean; cap: boolean; allCaps: boolean; /** Punctuation came right before it: a run of names doesn't go across. */ gap: boolean };

/** Words with whether each starts a sentence and is capitalised. */
function toks(text: string): Tok[] {
  text = text.replace(/\bU\.S\.A?\.?/g, "USA").replace(/\bU\.K\.?/g, "UK").replace(/\bU\.N\.?/g, "UN").replace(/\bE\.U\.?/g, "EU");
  const out: Tok[] = [];
  let start = true;
  let gap = false;
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*|[.!?:;,—–"“”„»«()|]/gu)) {
    const w = m[0];
    if (!/[\p{L}\p{N}]/u.test(w[0])) {
      gap = true;
      if (/[.!?:;—–|"“„»]/.test(w)) start = true;
      continue;
    }
    const clean = w.replace(/['’]s$/i, "");
    out.push({ raw: clean, lower: clean.toLowerCase(), start, cap: /^\p{Lu}/u.test(clean), allCaps: clean.length >= 2 && clean === clean.toUpperCase() && /\p{L}/u.test(clean), gap });
    start = false;
    gap = false;
  }
  return out;
}

type Cand = { key: string; display: string; kind: TagKind; weight: number; title: boolean; /** A name that looks like one (a given name in front, an organisation word at the end …): trusted even when only one headline has it. */ plausible?: boolean };

/** A gazetteer phrase at a token window: first letter capital for names (case-insensitive otherwise), exact case for aliases of up to three letters. */
/** A German compound or plural of a topic ("Elektroautos", "Klimaschutz-Gesetz", "Cyberangriffe"): the topic whose name it starts with. */
const TOPIC_ALIASES = [...GAZETTEER.entries()].filter(([k, e]) => e.kind === "topic" && !k.includes(" ") && k.length >= 7);
function topicByPrefix(word: string) {
  if (word.length < 8) return undefined;
  for (const [k, e] of TOPIC_ALIASES) if (word.startsWith(k) && word.length <= k.length + 6) return e;
  return undefined;
}

function gazetteerAt(t: Tok[], i: number): { n: number; name: string; kind: Kind } | null {
  for (let n = Math.min(GAZETTEER_MAX_WORDS, t.length - i); n >= 1; n--) {
    const win = t.slice(i, i + n);
    const e = GAZETTEER.get(win.map((w) => w.lower).join(" ")) ?? (n === 1 ? topicByPrefix(win[0].lower) : undefined);
    if (!e) continue;
    const written = win.map((w) => w.raw).join(" ");
    if (written.length <= 3 && !GAZETTEER_EXACT.has(written)) continue;
    if (e.kind !== "topic" && !win[0].cap) continue;
    return { n, name: e.name, kind: e.kind };
  }
  return null;
}

function candidates(text: string, inTitle: boolean): Cand[] {
  const t = toks(text);
  const used = new Set<number>();
  const out: Cand[] = [];
  const add = (display: string, kind: TagKind, weight: number, plausible = false) => out.push({ key: display.toLowerCase(), display, kind, weight: inTitle ? weight : weight * 0.5, title: inTitle, plausible });
  // English headlines in Title Case capitalise every word: there a run is a name only when it looks like one.
  const capRatio = t.length ? t.filter((w) => w.cap).length / t.length : 0;
  const titleCase = t.length >= 5 && capRatio > 0.6;
  const titleCaseHeadline = titleCase;
  // 1. Known names and topics (longest first).
  for (let i = 0; i < t.length; i++) {
    if (used.has(i)) continue;
    const g = gazetteerAt(t, i);
    if (g) {
      add(g.name, g.kind, 3);
      for (let k = i; k < i + g.n; k++) used.add(k);
      i += g.n - 1;
    }
  }
  // 2. Runs of capitalised words: names. A title in front ("Präsident Biden") and a filler word at the start are cut off.
  for (let i = 0; i < t.length; ) {
    if (used.has(i) || !t[i].cap || t[i].allCaps) {
      i++;
      continue;
    }
    let j = i;
    j++;
    while (j < t.length && !used.has(j) && t[j].cap && !t[j].allCaps && !t[j].gap) j++;
    let run = t.slice(i, j);
    while (run.length && (GENERIC.has(run[0].lower) || TITLES.has(run[0].lower) || (run.length > 1 && ROLE.test(run[0].raw)))) run = run.slice(1);
    // Title Case English: a trailing verb form ("Isaac Newton Predicted") isn't part of the name; a genitive ("Zuckerbergs") is the name.
    while (run.length > 2 && /(ed|ing|s)$/i.test(run[run.length - 1].raw) && titleCaseHeadline) run = run.slice(0, -1);
    if (run.length >= 2 && /[a-zäöü]s$/.test(run[run.length - 1].raw) && run[run.length - 1].raw.length > 5 && FIRST_NAMES.has(run[0].lower.split("-")[0])) run = [...run.slice(0, -1), { ...run[run.length - 1], raw: run[run.length - 1].raw.slice(0, -1), lower: run[run.length - 1].lower.slice(0, -1) }];
    while (run.length && GENERIC.has(run[run.length - 1].lower)) run = run.slice(0, -1);
    if (run.length >= 2 && run.length <= 4 && run.every((w) => !GENERIC.has(w.lower))) {
      const plausible = looksLikeName(run.map((w) => w.raw));
      if (!titleCase || plausible) add(run.map((w) => w.raw).join(" "), "name", 2.2, plausible);
      // A German headline that starts with a noun and then a name ("Rücktritt Bärbel Bas"): the name without the noun, and the noun alone.
      if (run[0].start) {
        const rest = run.slice(1);
        if (rest.length >= 2) add(rest.map((w) => w.raw).join(" "), "name", 2.2, looksLikeName(rest.map((w) => w.raw)));
        else if (rest[0].raw.length >= 4) add(rest[0].raw, "word", 1);
        if (run[0].raw.length >= 4) add(run[0].raw, "word", 0.8);
      }
    } else if (run.length === 1 && !GENERIC.has(run[0].lower) && run[0].raw.length >= 4 && !titleCase) add(run[0].raw, "word", run[0].start ? 0.8 : 1);
    else if (run.length >= 2 && !titleCase) for (const w of run) if (!GENERIC.has(w.lower) && w.raw.length >= 4) add(w.raw, "word", w.start ? 0.8 : 1);
    i = j;
  }
  // 3. Acronyms.
  t.forEach((w, i) => {
    if (!used.has(i) && w.allCaps && w.raw.length >= 3 && w.raw.length <= 6 && !ACRO_BLOCK.has(w.raw) && !GENERIC.has(w.lower)) add(w.raw, "acronym", 2);
  });
  return out;
}

export type TagOptions = { max?: number };

/** Tags for every item, decided with the corpus in view: id → its best tags (names as they should be shown). */
export function tagCorpus(items: TagItem[], opts: TagOptions = {}): Map<number, Tagged[]> {
  const max = opts.max ?? 4;
  const perItem = new Map<number, Cand[]>();
  const df = new Map<string, { display: string; kind: TagKind; items: Set<number> }>();
  for (const it of items) {
    const cs = [...candidates(it.title, true), ...candidates(it.summary.slice(0, 200), false).filter((c) => c.kind !== "word")];
    perItem.set(it.id, cs);
    for (const c of cs) {
      const cur = df.get(c.key);
      if (cur) {
        cur.items.add(it.id);
        if (c.kind !== "word" && cur.kind === "word") cur.kind = c.kind;
      } else df.set(c.key, { display: c.display, kind: c.kind, items: new Set([it.id]) });
    }
  }
  const N = Math.max(1, items.length);
  // Cohesion of single words: a topic word's stories share a name, place or acronym (Rücktritt with Bas, Streik with GDL); a
  // common word (Problem, Chance) is spread over unrelated stories — it is dropped.
  const strongOf = new Map<number, Set<string>>();
  for (const [id, cs] of perItem) strongOf.set(id, new Set(cs.filter((c) => c.kind !== "word").map((c) => c.key)));
  const incoherent = new Set<string>();
  for (const [k, v] of df) {
    if (v.kind !== "word") continue;
    const co = new Map<string, number>();
    for (const id of v.items) for (const sk of strongOf.get(id) ?? []) co.set(sk, (co.get(sk) ?? 0) + 1);
    const top = Math.max(0, ...co.values());
    if (v.items.size < 3 || top / v.items.size < 0.4) incoherent.add(k);
  }

  // Merging: a genitive ("Musks") into its base; a last name ("Musk") into the full name it always comes with ("Elon Musk").
  const alias = new Map<string, string>();
  for (const [k, v] of df) {
    if (/s$/.test(k) && k.length >= 5 && df.has(k.slice(0, -1)) && df.get(k.slice(0, -1))!.items.size >= v.items.size) alias.set(k, k.slice(0, -1));
  }
  const full = [...df].filter(([k, v]) => v.kind === "name" && v.items.size >= 2 && k.includes(" "));
  for (const [k, v] of df) {
    if (k.includes(" ") || v.kind === "name" || v.kind === "place" || v.kind === "org" || v.kind === "company" || v.kind === "topic") continue;
    const owner = full.find(([fk, fv]) => fk.endsWith(` ${k}`) && v.items.size <= fv.items.size * 1.6);
    if (owner) alias.set(k, owner[0]);
  }
  const canon = (k: string): string => {
    let cur = k;
    for (let n = 0; n < 4 && alias.has(cur); n++) cur = alias.get(cur)!;
    return cur;
  };
  // Document frequencies after merging.
  const cdf = new Map<string, Set<number>>();
  for (const [k, v] of df) {
    const c = canon(k);
    const set = cdf.get(c) ?? new Set<number>();
    for (const id of v.items) set.add(id);
    cdf.set(c, set);
  }

  const out = new Map<number, Tagged[]>();
  const pick = (pool: Cand[]): Tagged[] => {
    const best = new Map<string, Tagged>();
    for (const c of pool) {
      const key = canon(c.key);
      const n = cdf.get(key)?.size ?? 1;
      const meta = df.get(key) ?? df.get(c.key)!;
      const known = c.kind === "place" || c.kind === "org" || c.kind === "company" || c.kind === "person" || c.kind === "topic";
      // Support: a known name needs none; a name or acronym two stories; a single word three — and none may be in nearly everything.
      if (c.kind === "word" && incoherent.has(c.key)) continue;
      // (A name in a headline is a name already — a story that is new has one headline; a single word or acronym needs company.)
      const need = known || (c.kind === "name" && c.plausible) ? 1 : c.kind === "word" ? 3 : 2;
      if (n < need || n > Math.max(4, N * (known ? 0.2 : 0.08))) continue;
      const idf = Math.max(1, Math.min(4, Math.log(1 + N / n)));
      const score = c.weight * idf * (n >= 3 ? 1.15 : 1);
      const display = meta.display.includes(" ") || known ? (cdf.has(key) && df.get(key) ? df.get(key)!.display : c.display) : c.display;
      const cur = best.get(key);
      if (!cur || cur.score < score) best.set(key, { name: display, kind: (df.get(key)?.kind ?? c.kind), score });
    }
    // A name only this headline has, that contains one several stories name ("Rücktritt Bärbel Bas" ⊃ "Bärbel Bas"), is cut back to the supported part.
    for (const [key] of [...best]) {
      if ((cdf.get(key)?.size ?? 1) > 1) continue;
      for (const [other] of best) if (other !== key && key.includes(other) && (cdf.get(other)?.size ?? 1) >= 2) best.delete(key);
    }
    // A longer name replaces its own parts ("Musk" in "Elon Musk").
    const list = [...best.entries()].sort((a, b) => b[1].score - a[1].score);
    const kept: Tagged[] = [];
    for (const [key, tag] of list) {
      if (kept.some((k) => k.name.toLowerCase().includes(key) && k.name.toLowerCase() !== key)) continue;
      kept.push(tag);
      if (kept.length >= max) break;
    }
    return kept;
  };
  for (const it of items) {
    const own = perItem.get(it.id) ?? [];
    // The headline's own names; the summary's only when the headline names nothing (it supports the counts either way).
    const fromTitle = pick(own.filter((c) => c.title));
    out.set(it.id, fromTitle.length ? fromTitle : pick(own));
  }
  return out;
}

/** Tags as names only, for the item cards. */
export const tagNames = (m: Map<number, Tagged[]>, id: number): string[] => (m.get(id) ?? []).map((t) => t.name);
