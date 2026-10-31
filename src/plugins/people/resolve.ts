/**
 * Who someone is, by rule (the People plugin) — the one resolver every part asks: a sender as a mail address ("Name <a@b.de>"),
 * a name, an alias, a WhatsApp or Signal chat ("wa:<chat>", "sg:<chat>"), a phone number, a Jira username or a bank account
 * (IBAN) — each form only when it is one person's (a form two people share names neither). And the people a text names (their
 * names as mentions.ts finds them, their addresses in it). No AI. Built once per run (everyone read once). Server only.
 */
import { getSqlite } from "@/db";
import { ibanValid } from "@/lib/girocode";
import { buildPeopleIndex, mentionMatcher, splitMentions } from "./mentions";
import { listPeople, namesOf } from "./store";
import type { Person } from "./shared";

export type PersonResolver = {
  people: Person[];
  /** One sender — an address, a name, a chat id, a phone number, a Jira username, an IBAN — as a person; null: not one we know (or two). */
  person: (who: string | null | undefined) => number | null;
  /** A bank account's owner (an IBAN of their details). */
  byIban: (iban: string | null | undefined) => number | null;
  /** A phone number's owner (a number of their details, or their WhatsApp chat's when it is one). */
  byPhone: (phone: string | null | undefined) => number | null;
  /** A chat's person ("wa:<chat>", "sg:<chat>": the chat set on the profile, a chat named like them, their number). */
  byChat: (convId: string | null | undefined) => number | null;
  /** The people a text and its senders concern. */
  peopleIn: (text: string, ...senders: (string | null | undefined)[]) => number[];
};

/** An IBAN as compared: no spaces, capitals. */
export const ibanKey = (s: string | null | undefined): string => String(s ?? "").replace(/\s+/g, "").toUpperCase();

/** A phone number as compared: its digits, international (0049…, +49…, 0151… all as 49…); "" when too short for one. */
export function phoneKey(s: string | null | undefined): string {
  let d = String(s ?? "").replace(/@.*$/, "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `49${d.slice(1)}`;
  return d.length >= 7 ? d : "";
}

/** A map of forms to people that forgets a form two people have. */
function uniqueMap() {
  const map = new Map<string, number>();
  const clash = new Set<string>();
  return {
    put(key: string, id: number) {
      if (!key || clash.has(key)) return;
      if (map.has(key) && map.get(key) !== id) {
        clash.add(key);
        map.delete(key);
        return;
      }
      map.set(key, id);
    },
    get: (key: string) => (key ? (map.get(key) ?? null) : null),
  };
}

const safeAll = <T>(sql: string, ...args: unknown[]): T[] => {
  try {
    return getSqlite().prepare(sql).all(...args) as T[];
  } catch {
    return [];
  }
};

export function makePersonResolver(): PersonResolver {
  let people: Person[] = [];
  try {
    people = listPeople();
  } catch {
    people = [];
  }
  const byName = uniqueMap();
  const ibans = uniqueMap();
  const phones = uniqueMap();
  for (const p of people) {
    for (const k of new Set([...namesOf(p), ...p.emails, ...p.accounts.map((a) => a.value)].map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 2))) byName.put(k, p.id);
    const chatPhone = phoneKey(p.whatsapp);
    if (chatPhone && /^[+\d\s()/-]+$/.test(p.whatsapp)) phones.put(chatPhone, p.id);
  }
  // Their details (people/details.ts): the bank accounts and numbers read or added for them, not removed.
  for (const r of safeAll<{ person_id: number; key: string; value: string }>("select distinct person_id, key, value from people_details where removed = 0 and key in ('iban', 'phone')")) {
    if (r.key === "iban") ibans.put(ibanKey(r.value), r.person_id);
    else phones.put(phoneKey(r.value), r.person_id);
  }
  const byIban = (iban: string | null | undefined) => ibans.get(ibanKey(iban));
  const byPhone = (phone: string | null | undefined) => phones.get(phoneKey(phone));
  const named = (w: string) => byName.get(w.trim().toLowerCase());
  const byChat = (convId: string | null | undefined): number | null => {
    const c = String(convId ?? "").trim();
    const m = /^(?:wa|sg):(.+)$/.exec(c);
    const chat = m ? m[1] : c;
    if (!chat) return null;
    return named(chat) ?? (/^[+\d\s()/-]+(@.*)?$/.test(chat) ? byPhone(chat) : null);
  };
  const person = (who: string | null | undefined): number | null => {
    const w = String(who ?? "").trim();
    if (!w) return null;
    if (/^(?:wa|sg):/.test(w)) return byChat(w);
    const exact = named(w) ?? named(w.replace(/^.*<([^>]+)>.*$/, "$1"));
    if (exact) return exact;
    // ("Max Muster <max@…>": the name, when the address isn't known)
    const name = /^\s*"?([^"<]+?)"?\s*<[^>]+>/.exec(w)?.[1];
    if (name && named(name)) return named(name);
    if (/^[A-Z]{2}\d{2}[A-Z0-9 ]{10,}$/i.test(w) && ibanValid(ibanKey(w))) return byIban(w);
    if (/^[+\d\s()/-]{7,}$/.test(w)) return byPhone(w);
    return null;
  };
  const addresses = people.flatMap((p) => p.emails.map((e) => [e.toLowerCase(), p.id] as const));
  const matcher = mentionMatcher(buildPeopleIndex(people));
  const peopleIn = (text: string, ...senders: (string | null | undefined)[]): number[] => {
    const ids = new Set<number>();
    for (const m of splitMentions(text, matcher)) if (m.person) ids.add(m.person.id);
    const lower = text.toLowerCase();
    for (const [e, id] of addresses) if (lower.includes(e)) ids.add(id);
    for (const s of senders) {
      const id = person(s);
      if (id) ids.add(id);
    }
    return [...ids];
  };
  return { people, person, byIban, byPhone, byChat, peopleIn };
}

// ---------------------------------------------------------------------------
// The people a text names — one index for everyone, kept while nobody changes
// ---------------------------------------------------------------------------

type Cached = { key: string; matcher: ReturnType<typeof mentionMatcher>; texts: Map<string, number[]> };
const cache = globalThis as { __zeffPeopleNamed?: Map<string, Cached> };
const MAX_TEXTS = 5000;

/** What changes the index: everyone's names (the people table's rows and when they last changed), per database. */
function versionKey(): string {
  const r = safeAll<{ n: number; at: string | null; s: number }>("select count(*) n, max(updated_at) at, sum(id) s from people")[0];
  return `${r?.n ?? 0}|${r?.at ?? ""}|${r?.s ?? 0}`;
}

function current(): Cached {
  const file = (() => {
    try {
      return getSqlite().name;
    } catch {
      return "";
    }
  })();
  const all = (cache.__zeffPeopleNamed ??= new Map());
  const key = versionKey();
  let c = all.get(file);
  if (!c || c.key !== key) {
    let people: Person[] = [];
    try {
      people = listPeople();
    } catch {
      people = [];
    }
    c = { key, matcher: mentionMatcher(buildPeopleIndex(people)), texts: new Map() };
    all.set(file, c);
  }
  return c;
}

/**
 * The people a text names: their names as mentions.ts finds them (whole words, a capital, the genitive too, a part of the name
 * only they have — a form two people share names neither) and a mention of them ([[person:12|…]]). Kept per text while nobody
 * changes, so asking for many people over the same todos reads each text once.
 */
export function peopleNamedIn(text: string | null | undefined): number[] {
  const s = String(text ?? "");
  if (!s.trim()) return [];
  const c = current();
  const had = c.texts.get(s);
  if (had) return had;
  const ids = new Set<number>();
  for (const m of splitMentions(s, c.matcher)) if (m.person) ids.add(m.person.id);
  for (const m of s.matchAll(/\[\[person:(\d+)\|/g)) ids.add(Number(m[1]));
  const out = [...ids];
  if (c.texts.size >= MAX_TEXTS) c.texts.clear();
  c.texts.set(s, out);
  return out;
}

/** Whether a text names this person (see peopleNamedIn). */
export const namesPerson = (personId: number, text: string | null | undefined): boolean => peopleNamedIn(text).includes(personId);
