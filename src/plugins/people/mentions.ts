/**
 * People named in a text (a todo's): every way a person is called — their name, aliases, WhatsApp
 * chat, and the parts of their name nobody else shares ("Kruger" for Christopher Kruger, also as
 * "Herr Kruger") — found as whole words, in the genitive too ("Paulas"). A form two people share
 * names neither. Client-safe.
 */

/** A person as texts are matched against: the forms they're called by (each theirs alone). */
export type PersonIndexEntry = { id: number; name: string; forms: string[] };

/** Words in front of a name that belong to the mention ("Herr Kruger", "Frau Dr. Meier"). */
const HONORIFIC = String.raw`(?:(?:Herrn?|Frau|Fr\.|Hr\.|Dr\.|Prof\.)\s+){0,2}`;
const TITLES = new Set(["herr", "herrn", "frau", "dr.", "prof.", "hr.", "fr."]);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The index of everyone: their own forms, plus their name's first and last word when no one else
 * has that word (3 letters at least) — a form that would name two people is left out for both.
 */
export function buildPeopleIndex(people: { id: number; name: string; aliases: string[]; whatsapp: string }[]): PersonIndexEntry[] {
  const own = people.map((p) => ({ id: p.id, name: p.name, forms: [...new Set([p.name, ...p.aliases, p.whatsapp].map((s) => s.trim()).filter((s) => s.length >= 2))] }));
  // The parts of their names (first and last word, honorifics aside).
  const parts = own.map((p) => {
    const words = p.forms.flatMap((f) => {
      const w = f.split(/\s+/).filter((x) => !TITLES.has(x.toLowerCase()));
      return w.length > 1 ? [w[0], w[w.length - 1]] : [];
    });
    return [...new Set(words.filter((w) => w.length >= 3 && /^\p{Lu}/u.test(w)))];
  });
  // How many people each form (or part) would name.
  const count = new Map<string, number>();
  own.forEach((p, i) => {
    for (const f of new Set([...p.forms, ...parts[i]].map((x) => x.toLowerCase()))) count.set(f, (count.get(f) ?? 0) + 1);
  });
  return own.map((p, i) => ({ ...p, forms: [...new Set([...p.forms, ...parts[i]])].filter((f) => count.get(f.toLowerCase()) === 1) })).filter((p) => p.forms.length);
}

/** One regex for everyone's forms (the longest first: "Christopher Kruger" before "Kruger"), and which person each names. */
export function mentionMatcher(index: PersonIndexEntry[]): { re: RegExp; who: Map<string, PersonIndexEntry> } | null {
  const who = new Map<string, PersonIndexEntry>();
  for (const p of index) for (const f of p.forms) who.set(f.toLowerCase(), p);
  if (!who.size) return null;
  const forms = [...who.keys()].sort((a, b) => b.length - a.length).map(esc);
  // A whole word (letters and digits around it end it), maybe with an honorific before and a genitive after.
  const re = new RegExp(String.raw`(?<![\p{L}\p{N}])(${HONORIFIC})(${forms.join("|")})((?:s|['’]s?)?)(?![\p{L}\p{N}])`, "giu");
  return { re, who };
}

export type Mention = { text: string; person?: PersonIndexEntry };

/** A text cut into plain pieces and the mentions of people in it. */
export function splitMentions(text: string, m: ReturnType<typeof mentionMatcher>): Mention[] {
  if (!m || !text) return [{ text }];
  const out: Mention[] = [];
  let at = 0;
  for (const x of text.matchAll(m.re)) {
    const person = m.who.get(x[2].toLowerCase());
    // A name is written with a capital: "mark" or "will" in a sentence aren't Mark or Will.
    if (!person || !/^\p{Lu}/u.test(x[2])) continue;
    const start = x.index ?? 0;
    if (start > at) out.push({ text: text.slice(at, start) });
    out.push({ text: x[0], person });
    at = start + x[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/**
 * A note's text cut into plain pieces and the people tagged in it (@Name, @alias, @username — any
 * case): a tag is the person's form right after an @, its piece includes the @. A name without an @
 * stays plain.
 */
export function splitTags(text: string, m: ReturnType<typeof mentionMatcher>): Mention[] {
  if (!m || !text.includes("@")) return [{ text }];
  const forms = [...m.who.keys()].sort((a, b) => b.length - a.length).map(esc);
  const re = new RegExp(String.raw`(?<![\p{L}\p{N}_.@])@(${forms.join("|")})(?![\p{L}\p{N}_])`, "giu");
  const out: Mention[] = [];
  let at = 0;
  for (const x of text.matchAll(re)) {
    const person = m.who.get(x[1].toLowerCase());
    if (!person) continue;
    const start = x.index ?? 0;
    if (start > at) out.push({ text: text.slice(at, start) });
    out.push({ text: x[0], person });
    at = start + x[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
