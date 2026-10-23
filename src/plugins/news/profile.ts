import { tokens, type ProfileTerm } from "./shared";

/**
 * What Zeff knows about you that news can be matched against — gathered on this PC, never sent anywhere:
 *   · your facts (hobbies, family, places: "Julias Hobby — klettert", "Paula: Rennrad"),
 *   · what your open todos are about (the words that come up, with the todo that made them: T-132),
 *   · what your open tickets are about (PROJ-364 …).
 * The scoring gives an item with such a word a lift and says why ("work: T-132"), so a headline about the thing you are
 * working on, or the thing a friend loves, comes up without you having named it as an interest.
 */

/** Words that are in every todo and say nothing about a topic. */
const GENERIC = new Set(
  "prüfen testen geben bescheid ticket tickets nachfragen klären erledigen umsetzen implementieren deployment deployen merge request review bitte danach nachdem wieder müssen sollen können später morgen heute woche montag dienstag mittwoch donnerstag freitag fertig aufgabe punkt thema ergebnis status update antworten schreiben senden schicken melden abstimmen termin meeting".split(" "),
);

export type ProfileInput = {
  facts: { subject: string; text: string }[];
  todos: { ref: string; text: string }[];
  tickets: { key: string; summary: string }[];
};

/** The terms of a profile, strongest first (pure — the gathering is in `profileTerms`). */
export function termsOf(input: ProfileInput, limit = 70): ProfileTerm[] {
  const out = new Map<string, ProfileTerm>();
  const add = (term: string, weight: number, why: string) => {
    const k = term.toLowerCase();
    if (term.length < 4 || GENERIC.has(k)) return;
    const cur = out.get(k);
    if (!cur || cur.weight < weight) out.set(k, { term, weight, why });
  };
  // Facts: the subject as it is (a person's hobby, a place), and the longer words in what is said about it.
  for (const f of input.facts) {
    const subject = f.subject.replace(/\s+/g, " ").trim();
    if (subject.length >= 4 && subject.length <= 40) add(subject, 0.8, `you: ${subject}`);
    for (const w of tokens(f.text).filter((x) => x.length >= 6).slice(0, 4)) add(w, 0.5, `you: ${subject.slice(0, 30)}`);
  }
  // Todos: words that come up in several, else the long ones — with the first todo that has them.
  const count = new Map<string, { n: number; ref: string }>();
  for (const t of input.todos) for (const w of tokens(t.text).filter((x) => x.length >= 5 && !GENERIC.has(x))) {
    const c = count.get(w);
    if (c) c.n++;
    else count.set(w, { n: 1, ref: t.ref });
  }
  for (const [w, c] of [...count].sort((a, b) => b[1].n - a[1].n).slice(0, 30)) add(w, 1, `work: ${c.ref}`);
  // Tickets: what they are called.
  const tc = new Map<string, string>();
  for (const t of input.tickets) for (const w of tokens(t.summary).filter((x) => x.length >= 5 && !GENERIC.has(x))) if (!tc.has(w)) tc.set(w, t.key);
  for (const [w, key] of [...tc].slice(0, 25)) add(w, 0.8, `ticket: ${key}`);
  return [...out.values()].sort((a, b) => b.weight - a.weight).slice(0, limit);
}

/** Gathers the profile from this Zeff: facts, open todos, open Jira tickets (each only if it is there). */
export async function profileTerms(): Promise<ProfileTerm[]> {
  const input: ProfileInput = { facts: [], todos: [], tickets: [] };
  try {
    input.facts = (await import("@/lib/facts")).listFacts(200).map((f) => ({ subject: f.subject, text: f.text }));
  } catch {
    // no facts
  }
  try {
    input.todos = (await import("@/lib/boards/store")).listTodos({ status: "open" }).map((t) => ({ ref: t.ref, text: t.text }));
  } catch {
    // no todos
  }
  try {
    const { getDb, schema } = await import("@/db");
    const { ne } = await import("drizzle-orm");
    input.tickets = getDb().select({ key: schema.jiraTickets.key, summary: schema.jiraTickets.summary }).from(schema.jiraTickets).where(ne(schema.jiraTickets.statusCategory, "done")).limit(60).all();
  } catch {
    // no Jira
  }
  return termsOf(input);
}
