/**
 * Text basics for the news analytics — standard methods, no AI: language detection by stop-word overlap, tokenising into
 * chunks (maximal runs of content words between punctuation and stop words — the places a keyphrase can be), and stemmers
 * (Porter for English, a light Snowball-style one for German) so "Streiks", "Streik" and "Streiks'" are one term.
 */
export type Lang = "de" | "en" | "es" | "fr" | "xx";

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

export const STOP: Record<Exclude<Lang, "xx">, Set<string>> = {
  de: words(`der die das den dem des ein eine einer einen einem eines und oder aber auch als wie wo wer was wann warum wieso weil dass daß wenn dann doch noch schon nur sehr mehr weniger nicht kein keine keinen keiner kann können konnte muss müssen musste soll sollen sollte will wollen wollte darf dürfen
    ist sind war waren wird werden wurde wurden worden sei seien hat haben hatte hatten habe wäre wären würde würden gibt gab geben gehen geht ging kommt kommen kam macht machen machte lässt sagt sagte sagen sieht sehen zeigt zeigen
    ich du er sie es wir ihr mich dich ihn uns euch ihnen mir dir ihm man sich sein seine seiner seinen seinem seines ihre ihrer ihren ihrem unser unsere dieser diese dieses diesen diesem jede jeder jedes jeden alle alles allen aller manche viele vielen einige mehrere beide
    in im ins an am auf aus bei beim bis durch für gegen mit nach nahe neben ohne seit über um unter von vom vor vorm während wegen zu zum zur zwischen ab bei laut trotz statt innerhalb außerhalb
    hier dort da dabei dafür dagegen damit danach daran darauf daraus darin darum davon davor dazu dazwischen deshalb deswegen daher also somit sonst jedoch dennoch trotzdem außerdem zudem allerdings
    nun jetzt heute gestern morgen immer wieder erst schon bald oft nie nicht mal ganz fast etwa rund circa bereits sogar
    neue neuer neues neuen neuem erste ersten erster zweite zweiten letzte letzten gleich ganze ganzen mehr
    ja nein ob wohl denn eben eigentlich vielleicht gerade endlich plötzlich wirklich nämlich
    prozent euro cent uhr jahr jahre jahren jahres tag tage tagen woche wochen monat monate mal hinter hinten vorn vorne oben unten rechts links innen außen entlang gegenüber anstatt anstelle samt sogar nahezu nämlich übrigens ebenfalls ebenso sowie so sowie sowohl weder entweder zudem etwa mehrere viele mehr bisher künftig kaum stets weiterhin jedoch`),
  en: words(`the a an and or but if then than that this these those which who whom whose what when where why how as at by for from in into of on onto to up with without within about above after again against all also am any are aren't be been being before below between both can could did do does doing down during each few further had has have having he her here hers herself him himself his i it its itself just me more most my myself no nor not now off once only other our ours out over own same she should so some such too under until very was we were will would you your yours
    says say said new news over more less first last one two three us per via amid vs may might must shall will also still even ever never now just like get gets got make makes made take takes took see sees saw show shows showed
    is isn't was wasn't are aren't be been it's that's there's here's he's she's we're they're i'm you're don't doesn't didn't won't can't couldn't wouldn't shouldn't
    their they them theirs themselves while because however although though yet whether either neither rather quite many much any every another others`),
  es: words(`el la los las un una unos unas y o pero si que como de del al en con por para sin sobre entre desde hasta hacia según ante bajo contra durante mediante tras más menos muy ya no se su sus lo le les me te nos os es son fue fueron ser está están estar ha han haber hay había hizo hace hacer tiene tienen tener este esta estos estas ese esa esos esas aquel esto eso cuando donde quien cual cuales también solo sólo tras tras`),
  fr: words(`le la les un une des du de et ou mais si que qui quoi dont où comme dans en par pour sur sous avec sans entre vers chez contre depuis pendant après avant plus moins très déjà ne pas se sa son ses leur leurs ce cet cette ces est sont était été être a ont avoir avait fait faire il elle ils elles nous vous je tu on aussi comme`),
};

/** The language of a text: the one whose stop words are most of it (xx: can't tell). */
export function detectLang(text: string): Lang {
  const ws = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (ws.length < 3) return "xx";
  let best: Lang = "xx";
  let bestN = 0;
  let second = 0;
  for (const l of Object.keys(STOP) as Exclude<Lang, "xx">[]) {
    const n = ws.filter((w) => STOP[l].has(w)).length;
    if (n > bestN) {
      second = bestN;
      bestN = n;
      best = l;
    } else if (n > second) second = n;
  }
  return bestN >= 1 && bestN > second ? best : "xx";
}

export type Token = { surface: string; lower: string; stem: string; cap: boolean; start: boolean };
export type Chunk = Token[];

/**
 * A text as chunks: runs of content words, cut at punctuation and stop words. "Rücktritt von Bärbel Bas erschüttert die SPD"
 * → [Rücktritt] [Bärbel Bas erschüttert] [SPD]. A keyphrase never crosses a chunk.
 */
export function chunks(raw: string, lang: Lang): Chunk[] {
  const text = raw.replace(/https?:\/\/\S+|www\.\S+/g, " ");
  const stop = lang === "xx" ? new Set<string>() : STOP[lang];
  const out: Chunk[] = [];
  let cur: Token[] = [];
  let start = true;
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
  };
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*|[.!?:;,—–"“”„»«()|/]/gu)) {
    const w = m[0];
    if (!/[\p{L}\p{N}]/u.test(w[0])) {
      flush();
      if (/[.!?:;—–|"“„»]/.test(w)) start = true;
      continue;
    }
    let surface = w.replace(/['’]s$/i, "").replace(/^['’-]+|['’-]+$/g, "");
    // A capitalised name in the genitive ("Trumps", "Merkels"): the name.
    if (/^\p{Lu}/u.test(surface) && surface.length >= 5 && /[a-zäöü]s$/.test(surface) && !/(ss|us|is|as|os|es|ys)$/.test(surface)) surface = surface.slice(0, -1);
    const lower = surface.toLowerCase();
    if (!surface || /^\d+$/.test(surface) || stop.has(lower) || lower.length < 2) {
      flush();
      start = false;
      continue;
    }
    cur.push({ surface, lower, stem: stem(lower, lang), cap: /^\p{Lu}/u.test(surface), start });
    start = false;
  }
  flush();
  return out;
}

// ---- stemmers --------------------------------------------------------------------------------------------------------

/** A light German stemmer (Snowball-like): umlauts folded, inflection endings off. */
export function stemDe(word: string): string {
  let w = word.toLowerCase().replace(/ß/g, "ss").replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u");
  if (w.length <= 4) return w;
  w = w.replace(/-(?=\p{L})/gu, "");
  for (const suf of ["ern", "em", "er", "en", "es", "e", "s"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      if (suf === "s" && !/[bdfghklmnrt]s$/.test(w)) continue;
      w = w.slice(0, -suf.length);
      break;
    }
  }
  for (const suf of ["est", "en", "er", "st"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 4) {
      if (suf === "st" && !/[bdfghklmnt]st$/.test(w)) continue;
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return w;
}

const isCons = (w: string, i: number): boolean => {
  const c = w[i];
  if ("aeiou".includes(c)) return false;
  if (c === "y") return i === 0 || !isCons(w, i - 1);
  return true;
};
const measure = (w: string): number => {
  let n = 0;
  let prevV = false;
  for (let i = 0; i < w.length; i++) {
    const v = !isCons(w, i);
    if (prevV && !v) n++;
    prevV = v;
  }
  return n;
};
const hasVowel = (w: string) => [...w].some((_, i) => !isCons(w, i));
const endsDouble = (w: string) => w.length >= 2 && w[w.length - 1] === w[w.length - 2] && isCons(w, w.length - 1);
const cvc = (w: string) => w.length >= 3 && isCons(w, w.length - 1) && !isCons(w, w.length - 2) && isCons(w, w.length - 3) && !"wxy".includes(w[w.length - 1]);

/** The Porter stemmer (English). */
export function porter(word: string): string {
  let w = word.toLowerCase();
  if (w.length < 3 || !/^[a-z]+$/.test(w)) return w;
  // 1a
  if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("ies")) w = w.slice(0, -2);
  else if (!w.endsWith("ss") && w.endsWith("s")) w = w.slice(0, -1);
  // 1b
  let step1b = false;
  if (w.endsWith("eed")) {
    if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1);
  } else if (w.endsWith("ed") && hasVowel(w.slice(0, -2))) {
    w = w.slice(0, -2);
    step1b = true;
  } else if (w.endsWith("ing") && hasVowel(w.slice(0, -3))) {
    w = w.slice(0, -3);
    step1b = true;
  }
  if (step1b) {
    if (/(at|bl|iz)$/.test(w)) w += "e";
    else if (endsDouble(w) && !/[lsz]$/.test(w)) w = w.slice(0, -1);
    else if (measure(w) === 1 && cvc(w)) w += "e";
  }
  // 1c
  if (w.endsWith("y") && hasVowel(w.slice(0, -1))) w = `${w.slice(0, -1)}i`;
  // 2
  const s2: [string, string][] = [["ational", "ate"], ["tional", "tion"], ["enci", "ence"], ["anci", "ance"], ["izer", "ize"], ["abli", "able"], ["alli", "al"], ["entli", "ent"], ["eli", "e"], ["ousli", "ous"], ["ization", "ize"], ["ation", "ate"], ["ator", "ate"], ["alism", "al"], ["iveness", "ive"], ["fulness", "ful"], ["ousness", "ous"], ["aliti", "al"], ["iviti", "ive"], ["biliti", "ble"]];
  for (const [a, b] of s2) if (w.endsWith(a)) {
    if (measure(w.slice(0, -a.length)) > 0) w = w.slice(0, -a.length) + b;
    break;
  }
  // 3
  const s3: [string, string][] = [["icate", "ic"], ["ative", ""], ["alize", "al"], ["iciti", "ic"], ["ical", "ic"], ["ful", ""], ["ness", ""]];
  for (const [a, b] of s3) if (w.endsWith(a)) {
    if (measure(w.slice(0, -a.length)) > 0) w = w.slice(0, -a.length) + b;
    break;
  }
  // 4
  for (const a of ["ement", "ance", "ence", "able", "ible", "ment", "ant", "ent", "ion", "ism", "ate", "iti", "ous", "ive", "ize", "al", "er", "ic", "ou"]) {
    if (!w.endsWith(a)) continue;
    const stem = w.slice(0, -a.length);
    if (measure(stem) > 1 && (a !== "ion" || /[st]$/.test(stem))) w = stem;
    break;
  }
  // 5
  if (w.endsWith("e")) {
    const stem = w.slice(0, -1);
    if (measure(stem) > 1 || (measure(stem) === 1 && !cvc(stem))) w = stem;
  }
  if (w.endsWith("ll") && measure(w) > 1) w = w.slice(0, -1);
  return w;
}

/** The stem of a word in its language (others: plural "s" and a few endings off). */
export function stem(lower: string, lang: Lang): string {
  if (lang === "de") return stemDe(lower);
  if (lang === "en") return porter(lower);
  return lower.length > 4 ? lower.replace(/(es|s|a|o)$/, "") : lower;
}
