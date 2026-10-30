/**
 * Identity resolution (the People plugin): one person under every name the sources know them by.
 * Teams, mail, Jira and GitLab each write a person differently ("Becker, Thomas", "thobecke1",
 * "Thomas B."); this reads those names and the addresses and usernames that come with them and
 * proposes — never applies by itself — which are the same person: a name to add as an alias, two
 * profiles to merge, a profile for someone who keeps turning up. A proposal waits in the review
 * queue until you accept it; a rejected one is remembered and not made again. Server only.
 */
import { getSqlite } from "@/db";
import { recordFeedback } from "@/lib/learning/ledger";
import { identityFeedback } from "@/lib/learning/sources";
import { emitChange } from "@/lib/events";
import { nameSimilar, normalizeName } from "./accounts";
import type { Person } from "./shared";
import { addAccount, addAliases, createPerson, getPerson, listPeople, mergePeople, namesOf, updatePerson } from "./store";

export type SuggestionKind = "alias" | "merge" | "person";
export type Suggestion = {
  id: number;
  kind: SuggestionKind;
  /** alias: the profile the name goes to. merge: the one that stays. person: 0. */
  personId: number;
  /** merge: the one that goes into it. */
  otherId: number;
  /** alias: the name. person: the name of the new profile. */
  name: string;
  emails: string[];
  jira: string;
  /** Why — one line, as shown in the queue. */
  evidence: string;
  confidence: number;
  createdAt: string;
};

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists people_suggestions (id integer primary key autoincrement, key text not null unique, kind text not null, person_id integer not null default 0, other_id integer not null default 0, name text not null default '', emails text not null default '[]', jira text not null default '', evidence text not null default '', confidence real not null default 0.5, status text not null default 'pending', created_at text not null, decided_at text);
  `);
  return d;
}

const now = () => new Date().toISOString();
type Row = { id: number; key: string; kind: string; person_id: number; other_id: number; name: string; emails: string; jira: string; evidence: string; confidence: number; created_at: string };
const toSuggestion = (r: Row): Suggestion => ({
  id: r.id,
  kind: r.kind === "merge" || r.kind === "person" ? r.kind : "alias",
  personId: r.person_id,
  otherId: r.other_id,
  name: r.name,
  emails: (() => {
    try {
      return JSON.parse(r.emails) as string[];
    } catch {
      return [];
    }
  })(),
  jira: r.jira,
  evidence: r.evidence,
  confidence: r.confidence,
  createdAt: r.created_at,
});

/** The proposals waiting, the surest first. */
export const pendingSuggestions = (): Suggestion[] => (db().prepare("select * from people_suggestions where status = 'pending' order by confidence desc, id").all() as Row[]).map(toSuggestion);

/** A proposal queued — once per key, whatever became of it; one still waiting gets the evidence of now. Whether it is new. */
function propose(s: Omit<Suggestion, "id" | "createdAt"> & { key: string }): boolean {
  const r = db()
    .prepare("insert or ignore into people_suggestions (key, kind, person_id, other_id, name, emails, jira, evidence, confidence, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(s.key, s.kind, s.personId, s.otherId, s.name, JSON.stringify(s.emails), s.jira, s.evidence.slice(0, 300), s.confidence, now());
  if (!r.changes) db().prepare("update people_suggestions set name = ?, emails = ?, evidence = ?, confidence = ? where key = ? and status = 'pending'").run(s.name, JSON.stringify(s.emails), s.evidence.slice(0, 300), s.confidence, s.key);
  return r.changes > 0;
}

// ---------------------------------------------------------------------------
// What the sources call people
// ---------------------------------------------------------------------------

/** replied: the mail conversations with them I wrote in. */
type Seen = { name: string; sources: Set<string>; count: number; emails: Set<string>; users: Set<string>; replied: number };

/** Bots and mailboxes: no one's profile. */
const NOT_A_PERSON = /no-?reply|newsletter|notification|mailer|support|service|team|bot\b|admin|jira|gitlab|microsoft|google|system|\d{3,}/i;

/** Every name the synced sources write, with where, how often, and the addresses and usernames that came with it. */
export function observedNames(): Seen[] {
  const d = getSqlite();
  const seen = new Map<string, Seen>();
  const note = (name: string | null | undefined, source: string, extra: { email?: string | null; user?: string | null; count?: number; replied?: number } = {}) => {
    const display = (name ?? "").trim().replace(/\s+/g, " ");
    const key = normalizeName(display);
    if (!key || key === "ich" || display.length < 3 || NOT_A_PERSON.test(display)) return;
    const s = seen.get(key) ?? { name: display, sources: new Set<string>(), count: 0, emails: new Set<string>(), users: new Set<string>(), replied: 0 };
    s.sources.add(source);
    s.count += extra.count ?? 1;
    s.replied += extra.replied ?? 0;
    if (extra.email?.includes("@")) s.emails.add(extra.email.toLowerCase());
    if (extra.user) s.users.add(extra.user);
    // The fuller way of writing it is the one shown ("Thomas Becker" over "Becker").
    if (display.length > s.name.length) s.name = display;
    seen.set(key, s);
  };
  const all = <T>(sql: string): T[] => {
    try {
      return d.prepare(sql).all() as T[];
    } catch {
      return []; // the plugin behind it never ran
    }
  };
  // One address, several ways of writing it ("ogv.wagner", the address itself, a cut-off "Obergerichtsvollzie."):
  // those count for the real name the address also writes, the most frequent — else each stands on its own.
  const byAddress = new Map<string, { n: string; c: number }[]>();
  for (const r of all<{ n: string | null; e: string | null; c: number }>("select from_name n, lower(from_email) e, count(*) c from emails where folder not in ('WhatsApp', 'Signal') and from_name is not null and from_name != 'Ich' group by n, e")) {
    // A shop's or a bot's address writes many names: those aren't one person.
    if (!r.e?.includes("@") || NOT_A_PERSON.test(r.e)) note(r.n, "mail", { email: r.e, count: r.c });
    else byAddress.set(r.e, [...(byAddress.get(r.e) ?? []), { n: r.n ?? "", c: r.c }]);
  }
  // The conversations I wrote in, by the address of the other side: someone I answer is someone, not a newsletter.
  const replied = new Map(
    all<{ e: string; c: number }>("select lower(o.from_email) e, count(distinct o.conv_id) c from emails o where o.from_email like '%@%' and exists (select 1 from emails m where m.conv_id = o.conv_id and m.from_name = 'Ich') group by e").map((r) => [r.e, r.c]),
  );
  // The letters (documents) that carry the address — a letterhead, a signature.
  const inDocs = new Map<string, number>();
  for (const doc of all<{ text: string }>("select text from documents where status = 'ready'")) {
    for (const e of new Set((doc.text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []).map((x) => x.toLowerCase()))) inDocs.set(e, (inDocs.get(e) ?? 0) + 1);
  }
  const weak = (name: string) => name.includes("@") || !name.trim().includes(" ") || name.trim().endsWith(".");
  for (const [email, rows] of byAddress) {
    const real = rows.filter((r) => !weak(r.n)).sort((a, b) => b.c - a.c || b.n.length - a.n.length);
    const extra = real.length ? rows.filter((r) => weak(r.n)).reduce((sum, r) => sum + r.c, 0) : 0;
    const main = real[0] ?? [...rows].sort((a, b) => b.c - a.c)[0];
    for (const r of real.length ? real : rows) note(r.n, "mail", { email, count: r.c + (r === real[0] ? extra : 0), replied: r === main ? (replied.get(email) ?? 0) : 0 });
    if (inDocs.has(email)) note(main.n, "documents", { email, count: inDocs.get(email) });
  }
  for (const r of all<{ n: string | null; c: number }>("select sender_name n, count(*) c from teams_messages where sender_name is not null group by n")) note(r.n, "teams", { count: r.c });
  for (const r of all<{ n: string; c: number }>("select author n, count(*) c from jira_comments where author != '' group by n")) note(r.n, "jira", { count: r.c });
  for (const r of all<{ n: string | null; c: number }>("select author n, count(*) c from gitlab_items where author is not null group by n")) note(r.n, "gitlab", { count: r.c });
  // "Name (username)" as the briefing runs list everyone on a ticket.
  for (const run of all<{ tickets: string }>("select tickets from board_runs where status = 'ok' order by id desc limit 12")) {
    try {
      for (const t of JSON.parse(run.tickets) as { people?: string[] }[]) {
        for (const p of t.people ?? []) {
          const m = /^(.+?) \(([^()]+)\)$/.exec(p.trim());
          if (m) note(m[1], "jira", { user: m[2].trim() });
        }
      }
    } catch {
      // not readable
    }
  }
  return [...seen.values()];
}

/**
 * An address of their own: a word of the name before the @, none in the domain
 * (ogv.wagner@example.org for "Obergerichtsvollzieherin Wagner" — not jobs@mail.xing.com for "XING Jobs").
 */
function ownAddress(email: string, words: string[]): boolean {
  const [local, domain = ""] = email.toLowerCase().split("@");
  const named = words.filter((w) => w.length >= 3);
  return named.some((w) => normalizeName(local).includes(w)) && !named.some((w) => domain.includes(w));
}

/**
 * The knowledge's entities that are this profile: one of its names, aliases or addresses is the
 * entity's name or alias (the knowledge may keep someone twice — "U. Wagner" and "Wagner").
 * The one carrying the profile's address first, then the one with more pages.
 */
export function knowledgeEntitiesOf<E extends { id: number; name: string; aliases: string[]; pages: number }>(p: Pick<Person, "name" | "aliases" | "emails" | "whatsapp">, entities: E[]): E[] {
  const forms = new Set([p.name, ...p.aliases, p.whatsapp].map(normalizeName).filter((n) => n.length >= 3));
  const addresses = new Set(p.emails.map((e) => e.toLowerCase()));
  const ranked = entities.flatMap((e) => {
    const theirs = [e.name, ...e.aliases];
    const byAddress = theirs.some((n) => addresses.has(n.trim().toLowerCase()));
    return byAddress || theirs.some((n) => forms.has(normalizeName(n))) ? [{ e, byAddress }] : [];
  });
  return ranked.sort((a, b) => Number(b.byAddress) - Number(a.byAddress) || b.e.pages - a.e.pages).map((x) => x.e);
}

/** Whether a profile already goes by this name (or its normalized form). */
const hasName = (p: Person, name: string) => namesOf(p).some((n) => normalizeName(n) === normalizeName(name));

// ---------------------------------------------------------------------------
// The proposals
// ---------------------------------------------------------------------------

const keyOf = (...parts: (string | number)[]) => parts.join(":");

/**
 * Look for identities to propose: names the sources write for a profile that it doesn't go by yet (an
 * alias), profiles that are one person (merge), and names that keep turning up with no profile (a new
 * one). Only what the evidence carries: a shared address or username, the same name written differently,
 * a first name that fits one profile only. How many were queued.
 */
export function findIdentitySuggestions(): number {
  const people = listPeople();
  let queued = 0;
  // The new-profile proposals this run stands by: the waiting ones it doesn't make again are dropped.
  const wanted = new Set<string>();
  const q =(s: Parameters<typeof propose>[0]) => {
    if (propose(s)) queued++;
  };

  // 1. Two profiles that are one person.
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i];
      const b = people[j];
      const shared = (x: string[], y: string[]) => x.find((v) => y.some((w) => w.toLowerCase() === v.toLowerCase()));
      const email = shared(a.emails, b.emails);
      const user = shared(a.accounts.map((x) => x.value), b.accounts.map((x) => x.value));
      const chat = a.whatsapp && a.whatsapp === b.whatsapp ? a.whatsapp : "";
      const sameName = namesOf(a).some((n) => namesOf(b).some((m) => normalizeName(n) === normalizeName(m) || (n.includes(" ") && nameSimilar(n, m))));
      const found: { evidence: string; confidence: number } | null = email
        ? { evidence: `the same address (${email})`, confidence: 0.97 }
        : user
          ? { evidence: `the same Jira user (${user})`, confidence: 0.97 }
          : chat
            ? { evidence: `the same WhatsApp chat (${chat})`, confidence: 0.95 }
            : sameName
              ? { evidence: `"${a.name}" and "${b.name}" are the same name written differently`, confidence: 0.85 }
              : null;
      if (!found) continue;
      const { evidence, confidence } = found;
      // The fuller profile stays (more words in the name, then more addresses).
      const [keep, drop] = [a, b].sort((x, y) => y.name.split(/\s+/).length - x.name.split(/\s+/).length || y.emails.length - x.emails.length || x.id - y.id);
      q({ key: keyOf("merge", Math.min(a.id, b.id), Math.max(a.id, b.id)), kind: "merge", personId: keep.id, otherId: drop.id, name: drop.name, emails: [], jira: "", evidence, confidence });
    }
  }

  // 2. What the sources call people.
  const seen = observedNames();
  const byEmail = new Map(people.flatMap((p) => p.emails.map((e) => [e.toLowerCase(), p] as [string, Person])));
  const byUser = new Map(people.flatMap((p) => p.accounts.map((a) => [a.value.toLowerCase(), p] as [string, Person])));
  for (const s of seen) {
    if (people.some((p) => hasName(p, s.name))) continue;
    // By what it came with: an address or a username a profile has already.
    const viaEmail = [...s.emails].map((e) => byEmail.get(e)).find(Boolean);
    const viaUser = [...s.users].map((u) => byUser.get(u.toLowerCase())).find(Boolean);
    if (viaEmail || viaUser) {
      const p = (viaEmail ?? viaUser)!;
      q({ key: keyOf("alias", p.id, normalizeName(s.name)), kind: "alias", personId: p.id, otherId: 0, name: s.name, emails: [], jira: "", evidence: viaEmail ? `written by ${[...s.emails].join(", ")} — ${p.name}'s address` : `listed as Jira user ${[...s.users].join(", ")} — ${p.name}'s account`, confidence: 0.95 });
      continue;
    }
    // By the name: written differently (umlauts, "Last, First", a letter off) — for exactly one profile.
    const near = people.filter((p) => namesOf(p).some((n) => nameSimilar(n, s.name)));
    if (near.length === 1) {
      q({ key: keyOf("alias", near[0].id, normalizeName(s.name)), kind: "alias", personId: near[0].id, otherId: 0, name: s.name, emails: [], jira: "", evidence: `"${s.name}" in ${[...s.sources].join(", ")} reads like ${near[0].name}`, confidence: 0.8 });
      continue;
    }
    // A full name that continues exactly one profile's first name, with the same address/user nowhere else: "Laura" → "Laura Schulz".
    const words = normalizeName(s.name).split(" ");
    if (words.length >= 2 && s.sources.size >= 1) {
      const first = people.filter((p) => !p.name.includes(" ") && normalizeName(p.name) === words[0]);
      const rivals = people.filter((p) => p.name.includes(" ") && normalizeName(p.name).split(" ")[0] === words[0]);
      if (first.length === 1 && !rivals.length && s.count >= 3) {
        q({ key: keyOf("alias", first[0].id, normalizeName(s.name)), kind: "alias", personId: first[0].id, otherId: 0, name: s.name, emails: [...s.emails], jira: [...s.users][0] ?? "", evidence: `"${first[0].name}" is the only ${words[0]} you have a profile for; "${s.name}" appears ${s.count}× in ${[...s.sources].join(", ")}`, confidence: 0.55 });
        continue;
      }
    }
    // Someone who keeps turning up, with a full name and no profile: a new one. Known from mail (and letters)
    // only, it takes more: that I wrote back, or an address of their own — shops and newsletters have neither.
    const mailOnly = [...s.sources].every((x) => x === "mail" || x === "documents");
    if (words.length >= 2 && (s.count >= 4 || s.sources.size >= 2) && (!mailOnly || s.replied > 0 || [...s.emails].some((e) => ownAddress(e, words)))) {
      const key = keyOf("person", normalizeName(s.name));
      wanted.add(key);
      const confidence = Math.min(s.replied ? 0.95 : 0.9, 0.4 + s.count / 40 + s.sources.size * 0.1 + (s.replied ? 0.3 : 0));
      q({ key, kind: "person", personId: 0, otherId: 0, name: s.name, emails: [...s.emails].slice(0, 3), jira: [...s.users][0] ?? "", evidence: `${s.count}× in ${[...s.sources].join(", ")}${s.replied ? ` — you wrote back (${s.replied}×)` : ""}`, confidence });
    }
  }
  // The waiting new-profile proposals this run no longer makes (a shop from before the rules above) go.
  const stale = (db().prepare("select key from people_suggestions where status = 'pending' and kind = 'person'").all() as { key: string }[]).filter((r) => !wanted.has(r.key));
  for (const r of stale) db().prepare("update people_suggestions set status = 'obsolete', decided_at = ? where key = ?").run(now(), r.key);
  if (queued || stale.length) emitChange("todos");
  return queued;
}

/**
 * Accept a proposal: do what it says. Throws when it no longer fits (the profiles are gone). The profile
 * that is new or got a new name or address — the one whose past messages are worth reading again.
 */
export function acceptSuggestion(id: number): number | undefined {
  const r = db().prepare("select * from people_suggestions where id = ? and status = 'pending'").get(id) as Row | undefined;
  if (!r) return undefined;
  const s = toSuggestion(r);
  let touched: number | undefined;
  if (s.kind === "merge") mergePeople(s.personId, s.otherId);
  else if (s.kind === "alias") {
    if (!getPerson(s.personId)) throw new Error("Unknown person.");
    addAliases(s.personId, [s.name]);
    for (const e of s.emails) updatePerson(s.personId, { emails: [...new Set([...(getPerson(s.personId)?.emails ?? []), e])] });
    if (s.jira) addAccount(s.personId, "jira", s.jira);
    touched = s.personId;
  } else {
    touched = createPerson({ name: s.name, emails: s.emails });
    if (s.jira) addAccount(touched, "jira", s.jira);
  }
  db().prepare("update people_suggestions set status = 'accepted', decided_at = ? where id = ?").run(now(), id);
  recordFeedback(identityFeedback(r, "accepted"));
  // Others that concerned a profile that is gone now.
  db().prepare("update people_suggestions set status = 'obsolete', decided_at = ? where status = 'pending' and kind != 'person' and ((person_id != 0 and person_id not in (select id from people)) or (other_id != 0 and other_id not in (select id from people)))").run(now());
  emitChange("todos");
  return touched;
}

export function rejectSuggestion(id: number): void {
  const r = db().prepare("select * from people_suggestions where id = ? and status = 'pending'").get(id) as Row | undefined;
  db().prepare("update people_suggestions set status = 'rejected', decided_at = ? where id = ? and status = 'pending'").run(now(), id);
  if (r) recordFeedback(identityFeedback(r, "rejected"));
  emitChange("todos");
}
