import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { isChatFolder } from "@/lib/mail/shared";
import { t } from "@/lib/i18n/server";
import { daysBetween, isCircle, isDateKind, isoDay, nextOccurrence, type Circle, type ContactKind, type DateKind, type Person, type PersonAccount, type PersonDate, type PersonSummary, type Upcoming } from "./shared";

/**
 * People (the Personen plugin): a profile per person you care about — your notes, their dates
 * (birthday, anniversaries, a day to remember) with reminders, and what Zeff knows of them
 * (the knowledge, their messages, todos naming them). Its own tables, made when first needed.
 */

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists people (id integer primary key autoincrement, name text not null, aliases text not null default '[]', note text not null default '', whatsapp text not null default '', emails text not null default '[]', entity_id integer, starred integer not null default 0, created_at text not null, updated_at text not null);
    create table if not exists people_dates (id integer primary key autoincrement, person_id integer not null references people(id) on delete cascade, kind text not null default 'birthday', label text not null default '', day integer not null, month integer not null, year integer, yearly integer not null default 1, remind_days integer not null default 7, source text not null default 'manual', source_text text not null default '', confirmed integer not null default 1, created_at text not null);
    create index if not exists people_dates_person on people_dates (person_id);
    create table if not exists people_reminded (date_id integer not null references people_dates(id) on delete cascade, occurrence text not null, done_at text not null, primary key (date_id, occurrence));
    create table if not exists people_relations (id integer primary key autoincrement, person_id integer not null references people(id) on delete cascade, rel text not null, other_id integer not null default 0, evidence text not null default '', source text not null default 'ai', created_at text not null, unique (person_id, rel, other_id));
  `);
  // The compiled summary: a column added later.
  if (!(d.prepare("pragma table_info(people)").all() as { name: string }[]).some((c) => c.name === "compiled")) d.exec("alter table people add column compiled text");
  // Linked accounts (Jira usernames): a column added later.
  if (!(d.prepare("pragma table_info(people)").all() as { name: string }[]).some((c) => c.name === "accounts")) d.exec("alter table people add column accounts text not null default '[]'");
  // Their circle (family, work …) and who set it (a rule, the AI, you): columns added later.
  if (!(d.prepare("pragma table_info(people)").all() as { name: string }[]).some((c) => c.name === "circle")) d.exec("alter table people add column circle text not null default ''; alter table people add column circle_source text not null default ''");
  // A person or an organisation (a bank, an authority, a company), and who said so: columns added later.
  if (!(d.prepare("pragma table_info(people)").all() as { name: string }[]).some((c) => c.name === "kind")) d.exec("alter table people add column kind text not null default 'person'; alter table people add column kind_source text not null default ''");
  return d;
}

const parse = <T>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};
const now = () => new Date().toISOString();
const changed = () => emitChange("todos");

type PRow = { id: number; name: string; aliases: string; accounts?: string; compiled?: string | null; circle?: string; circle_source?: string; kind?: string; kind_source?: string; note: string; whatsapp: string; emails: string; entity_id: number | null; starred: number; created_at: string; updated_at: string };
type DRow = { id: number; person_id: number; kind: string; label: string; day: number; month: number; year: number | null; yearly: number; remind_days: number; source: string; source_text: string; confirmed: number };

const toPerson = (r: PRow): Person => ({
  id: r.id,
  name: r.name,
  aliases: parse<string[]>(r.aliases, []),
  accounts: parse<unknown[]>(r.accounts ?? "[]", []).flatMap((a) => (a && typeof a === "object" && (a as PersonAccount).kind === "jira" && typeof (a as PersonAccount).value === "string" ? [{ kind: "jira" as const, value: (a as PersonAccount).value }] : [])),
  compiled: parse<PersonSummary | null>(r.compiled ?? "null", null),
  circle: isCircle(r.circle ?? "") ? (r.circle as Circle) : "",
  circleSource: r.circle_source === "rule" || r.circle_source === "ai" || r.circle_source === "manual" ? r.circle_source : "",
  kind: r.kind === "organization" ? "organization" : "person",
  kindSource: r.kind_source === "ai" || r.kind_source === "manual" ? r.kind_source : "",
  note: r.note,
  whatsapp: r.whatsapp,
  emails: parse<string[]>(r.emails, []),
  entityId: r.entity_id,
  starred: !!r.starred,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toDate = (r: DRow): PersonDate => ({
  id: r.id,
  personId: r.person_id,
  kind: isDateKind(r.kind) ? r.kind : "other",
  label: r.label,
  day: r.day,
  month: r.month,
  year: r.year,
  yearly: !!r.yearly,
  remindDays: r.remind_days,
  source: r.source === "fact" || r.source === "ai" ? r.source : "manual",
  sourceText: r.source_text,
  confirmed: !!r.confirmed,
});

const clean = (list: string[] | undefined, max = 20) => [...new Set((list ?? []).map((s) => s.trim()).filter(Boolean))].slice(0, max);

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/** Everyone — starred first, then by name. */
export const listPeople = (): Person[] => (db().prepare("select * from people order by starred desc, name collate nocase").all() as PRow[]).map(toPerson);

export function getPerson(id: number): Person | null {
  const r = db().prepare("select * from people where id = ?").get(id) as PRow | undefined;
  return r ? toPerson(r) : null;
}

export function createPerson(v: { name: string; aliases?: string[]; whatsapp?: string; emails?: string[]; entityId?: number | null; note?: string }): number {
  const name = v.name.trim().slice(0, 120);
  if (!name) throw new Error(t("A name, please."));
  const had = db().prepare("select id from people where lower(name) = lower(?)").get(name) as { id: number } | undefined;
  if (had) return had.id;
  const at = now();
  const r = db()
    .prepare("insert into people (name, aliases, note, whatsapp, emails, entity_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(name, JSON.stringify(clean(v.aliases).filter((a) => a.toLowerCase() !== name.toLowerCase())), (v.note ?? "").slice(0, 20000), (v.whatsapp ?? "").trim(), JSON.stringify(clean(v.emails)), v.entityId ?? null, at, at);
  changed();
  return Number(r.lastInsertRowid);
}

export function updatePerson(id: number, patch: { name?: string; aliases?: string[]; accounts?: PersonAccount[]; note?: string; whatsapp?: string; emails?: string[]; entityId?: number | null; starred?: boolean }): void {
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, v: unknown) => (sets.push(`${col} = ?`), args.push(v));
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error(t("A name, please."));
    set("name", patch.name.trim().slice(0, 120));
  }
  if (patch.aliases !== undefined) set("aliases", JSON.stringify(clean(patch.aliases)));
  if (patch.accounts !== undefined) set("accounts", JSON.stringify(patch.accounts.slice(0, 10)));
  if (patch.note !== undefined) set("note", patch.note.slice(0, 20000));
  if (patch.whatsapp !== undefined) set("whatsapp", patch.whatsapp.trim());
  if (patch.emails !== undefined) set("emails", JSON.stringify(clean(patch.emails)));
  if (patch.entityId !== undefined) set("entity_id", patch.entityId);
  if (patch.starred !== undefined) set("starred", patch.starred ? 1 : 0);
  if (!sets.length) return;
  set("updated_at", now());
  db().prepare(`update people set ${sets.join(", ")} where id = ?`).run(...args, id);
  changed();
}

/** Their circle, and who set it — yours stays: a rule or the AI never overwrites what you chose. Whether it changed. */
export function setCircle(id: number, circle: Circle | "", source: "rule" | "ai" | "manual"): boolean {
  const p = getPerson(id);
  if (!p || (p.circleSource === "manual" && source !== "manual") || (p.circle === circle && p.circleSource === source)) return false;
  // The AI's word goes over a rule's guess; a rule doesn't undo the AI's.
  if (source === "rule" && p.circleSource === "ai" && p.circle) return false;
  // Who said so stays even for "no circle": asked once, not again each briefing.
  db().prepare("update people set circle = ?, circle_source = ? where id = ?").run(circle, source, id);
  changed();
  return true;
}

/** A person or an organisation — yours stays: the AI never overwrites what you chose. Whether it changed. */
export function setKind(id: number, kind: ContactKind, source: "ai" | "manual"): boolean {
  const p = getPerson(id);
  if (!p || (p.kindSource === "manual" && source !== "manual") || (p.kind === kind && p.kindSource === source)) return false;
  db().prepare("update people set kind = ?, kind_source = ? where id = ?").run(kind, source, id);
  changed();
  return true;
}

/** A person's compiled summary, kept. */
export function setCompiled(id: number, summary: PersonSummary): void {
  db().prepare("update people set compiled = ? where id = ?").run(JSON.stringify(summary), id);
  changed();
}

/** A linked account added (once; matched ignoring case). Whether it was new. */
export function addAccount(id: number, kind: "jira", value: string): boolean {
  const p = getPerson(id);
  const v = value.trim().replace(/^@/, "");
  if (!p || !v || p.accounts.some((a) => a.kind === kind && a.value.toLowerCase() === v.toLowerCase())) return false;
  db().prepare("update people set accounts = ?, updated_at = ? where id = ?").run(JSON.stringify([...p.accounts, { kind, value: v }]), now(), id);
  changed();
  return true;
}

export function removeAccount(id: number, kind: "jira", value: string): void {
  const p = getPerson(id);
  if (!p) return;
  db().prepare("update people set accounts = ?, updated_at = ? where id = ?").run(JSON.stringify(p.accounts.filter((a) => !(a.kind === kind && a.value.toLowerCase() === value.trim().toLowerCase()))), now(), id);
  changed();
}

/** Who has this account (e.g. the Jira user "chrlorenz1"). */
export function personByAccount(kind: "jira", value: string): Person | null {
  const v = value.trim().toLowerCase();
  return listPeople().find((p) => p.accounts.some((a) => a.kind === kind && a.value.toLowerCase() === v)) ?? null;
}

/** Run on the claims/links tables when they exist (graph.ts makes them when first needed). */
function graphSql(sql: string, ...args: unknown[]): void {
  try {
    db().prepare(sql).run(...args);
  } catch {
    // not made yet: nothing to move
  }
}

export function deletePerson(id: number): void {
  db().prepare("delete from people_relations where other_id = ?").run(id);
  graphSql("delete from people_claims where person_id = ?", id);
  graphSql("delete from people_links where person_id = ?", id);
  graphSql("delete from people_links where target_type = 'person' and target_ref = ?", String(id));
  db().prepare("delete from people where id = ?").run(id);
  changed();
}

/** The names a person goes by: their name and aliases (the WhatsApp chat's too). */
export const namesOf = (p: Person) => clean([p.name, ...p.aliases, p.whatsapp]);

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export const datesOf = (personId: number): PersonDate[] => (db().prepare("select * from people_dates where person_id = ? order by confirmed desc, month, day").all(personId) as DRow[]).map(toDate);

export type DateInput = { kind: DateKind; label?: string; day: number; month: number; year?: number | null; yearly?: boolean; remindDays?: number; source?: PersonDate["source"]; sourceText?: string; confirmed?: boolean };

/** A date kept — the same one (kind, day, month) once: a proposal for one already there isn't added again. */
export function addDate(personId: number, v: DateInput): number | null {
  const d = db();
  const had = d.prepare("select id from people_dates where person_id = ? and kind = ? and day = ? and month = ?").get(personId, v.kind, v.day, v.month) as { id: number } | undefined;
  if (had) return null;
  const r = d
    .prepare("insert into people_dates (person_id, kind, label, day, month, year, yearly, remind_days, source, source_text, confirmed, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      personId,
      v.kind,
      (v.label ?? "").trim().slice(0, 120),
      v.day,
      v.month,
      v.year ?? null,
      (v.yearly ?? v.kind !== "other") ? 1 : 0,
      Math.max(0, Math.min(60, v.remindDays ?? (v.kind === "birthday" ? 7 : 3))),
      v.source ?? "manual",
      (v.sourceText ?? "").slice(0, 500),
      (v.confirmed ?? true) ? 1 : 0,
      now(),
    );
  changed();
  return Number(r.lastInsertRowid);
}

export function updateDate(id: number, patch: Partial<DateInput>): void {
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, v: unknown) => (sets.push(`${col} = ?`), args.push(v));
  if (patch.kind !== undefined) set("kind", patch.kind);
  if (patch.label !== undefined) set("label", patch.label.trim().slice(0, 120));
  if (patch.day !== undefined) set("day", patch.day);
  if (patch.month !== undefined) set("month", patch.month);
  if (patch.year !== undefined) set("year", patch.year);
  if (patch.yearly !== undefined) set("yearly", patch.yearly ? 1 : 0);
  if (patch.remindDays !== undefined) set("remind_days", Math.max(0, Math.min(60, patch.remindDays)));
  if (patch.confirmed !== undefined) set("confirmed", patch.confirmed ? 1 : 0);
  if (!sets.length) return;
  db().prepare(`update people_dates set ${sets.join(", ")} where id = ?`).run(...args, id);
  changed();
}

export function deleteDate(id: number): void {
  db().prepare("delete from people_dates where id = ?").run(id);
  changed();
}

/** The proposals waiting (from facts or the AI), of everyone. */
export function proposedDates(): (PersonDate & { personName: string })[] {
  return (db().prepare("select d.*, p.name person_name from people_dates d join people p on p.id = d.person_id where d.confirmed = 0 order by p.name").all() as (DRow & { person_name: string })[]).map((r) => ({
    ...toDate(r),
    personName: r.person_name,
  }));
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/**
 * What comes round in the next `days` (confirmed dates), soonest first; `withinReminder`: only
 * those inside their own reminder window — and not marked done for this time.
 */
export function upcoming({ days = 60, withinReminder = false, today = new Date() }: { days?: number; withinReminder?: boolean; today?: Date } = {}): Upcoming[] {
  const d = db();
  const rows = d.prepare("select d.*, p.name person_name from people_dates d join people p on p.id = d.person_id where d.confirmed = 1").all() as (DRow & { person_name: string })[];
  const done = new Set((d.prepare("select date_id, occurrence from people_reminded").all() as { date_id: number; occurrence: string }[]).map((r) => `${r.date_id}:${r.occurrence}`));
  const out: Upcoming[] = [];
  for (const r of rows) {
    const date = toDate(r);
    const on = nextOccurrence(date, today);
    if (!on) continue;
    const inDays = daysBetween(today, on);
    if (inDays > days || (withinReminder && inDays > date.remindDays)) continue;
    const occurrence = isoDay(on);
    if (withinReminder && done.has(`${date.id}:${occurrence}`)) continue;
    const turns = date.year && date.yearly ? on.getFullYear() - date.year : null;
    out.push({ date, person: { id: r.person_id, name: r.person_name }, on: occurrence, inDays, turns: turns && turns > 0 ? turns : null });
  }
  return out.sort((a, b) => a.inDays - b.inDays || a.person.name.localeCompare(b.person.name));
}

/** A reminder done (congratulated, thought of): not shown again for this time. */
/** The dates coming up in the next days that are not marked done for this time. */
export function upcomingOpen(days: number): Upcoming[] {
  const done = new Set((db().prepare("select date_id, occurrence from people_reminded").all() as { date_id: number; occurrence: string }[]).map((r) => `${r.date_id}:${r.occurrence}`));
  return upcoming({ days }).filter((u) => !done.has(`${u.date.id}:${u.on}`));
}

export function markReminded(dateId: number, occurrence: string): void {
  db().prepare("insert or ignore into people_reminded (date_id, occurrence, done_at) values (?, ?, ?)").run(dateId, occurrence, now());
  changed();
}

// ---------------------------------------------------------------------------
// What else Zeff knows of them
// ---------------------------------------------------------------------------

// The name as a word of its own — in the genitive too ("Paulas Geburtstag", "Hans’ Auto", "Karla's").
const word = (n: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:s|['’]s?)?(?=$|[^\\p{L}\\p{N}])`, "iu");

/** Whether a text names them (a name or alias, as a whole word — names shorter than 3 letters left out). */
export function namesThem(p: Person, text: string): boolean {
  return namesOf(p)
    .filter((n) => n.length >= 3)
    .some((n) => word(n).test(text));
}

export type Contact = { key: string; folder: string; who: string; text: string; at: string; convId: string };

/** Their latest messages: their WhatsApp chat, their Signal chat, mails from their addresses (or with their name as sender). */
export function contactsOf(p: Person, limit = 12): Contact[] {
  const d = getSqlite();
  const out: Contact[] = [];
  type R = { key: string; folder: string; from_name: string | null; from_email: string | null; subject: string; preview: string; received_at: string; conv_id: string };
  const push = (rows: R[]) => {
    for (const r of rows) if (!out.some((o) => o.key === r.key)) out.push({ key: r.key, folder: r.folder, who: r.from_name ?? r.from_email ?? "", text: isChatFolder(r.folder) ? r.preview : `${r.subject} — ${r.preview}`, at: r.received_at, convId: r.conv_id });
  };
  try {
    // Their WhatsApp chat: the one set — else one named like them (their name or an alias).
    const chat = p.whatsapp || namesOf(p).find((n) => d.prepare("select 1 from emails where conv_id = ? limit 1").get(`wa:${n}`));
    if (chat) push(d.prepare("select * from emails where conv_id = ? order by received_at desc limit ?").all(`wa:${chat}`, limit) as R[]);
    // Their Signal chat: one named like them (their name, an alias or their WhatsApp chat's name).
    const signal = namesOf(p).find((n) => d.prepare("select 1 from emails where conv_id = ? limit 1").get(`sg:${n}`));
    if (signal) push(d.prepare("select * from emails where conv_id = ? order by received_at desc limit ?").all(`sg:${signal}`, limit) as R[]);
    for (const mail of p.emails) push(d.prepare("select * from emails where lower(from_email) = lower(?) order by received_at desc limit ?").all(mail, limit) as R[]);
    if (!p.whatsapp && !p.emails.length) push(d.prepare("select * from emails where folder not in ('WhatsApp', 'Signal') and lower(from_name) = lower(?) order by received_at desc limit ?").all(p.name, limit) as R[]);
  } catch {
    // no messages kept (the plugins never ran)
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** The WhatsApp chats Zeff knows (one to one, not groups) — profiles to make. */
export function whatsappChats(): { name: string; messages: number; lastAt: string }[] {
  try {
    return (
      getSqlite()
        // A group: marked so — or (read before Zeff marked them) more than you and one other writing.
        .prepare("select substr(conv_id, 4) name, count(*) messages, max(received_at) lastAt from emails where folder = 'WhatsApp' and coalesce(is_group, 0) = 0 group by conv_id having count(distinct from_name) <= 2 order by lastAt desc")
        .all() as { name: string; messages: number; lastAt: string }[]
    ).filter((c) => c.name);
  } catch {
    return [];
  }
}

/** The knowledge's entity found for them, kept (quietly — it's a lookup's result, not a change). */
export function rememberEntity(id: number, entityId: number): void {
  db().prepare("update people set entity_id = ? where id = ?").run(entityId, id);
}

// ---------------------------------------------------------------------------
// One person under several names: the index texts are matched against, aliases, merging
// ---------------------------------------------------------------------------

/** Everyone, as texts (todos) are matched against — see mentions.ts. */
export async function peopleIndex() {
  const { buildPeopleIndex } = await import("./mentions");
  // Their Jira usernames tag them too (@jenschum), like their names and aliases.
  return buildPeopleIndex(listPeople().map((p) => ({ ...p, aliases: [...p.aliases, ...p.accounts.map((a) => a.value)] })));
}

/** More names for a person (a mention found to be them): those they don't have yet. How many. */
export function addAliases(id: number, names: string[]): number {
  const p = getPerson(id);
  if (!p) return 0;
  const have = new Set(namesOf(p).map((n) => n.toLowerCase()));
  const fresh = clean(names).filter((n) => n.length >= 2 && !have.has(n.toLowerCase()));
  if (!fresh.length) return 0;
  updatePerson(id, { aliases: [...p.aliases, ...fresh] });
  return fresh.length;
}

/**
 * Two profiles that are one person: `drop` goes into `keep` — its name and aliases become aliases,
 * its addresses, chat, notes, dates (those not there yet) and star come along; `drop` is deleted.
 */
export function mergePeople(keepId: number, dropId: number): void {
  if (keepId === dropId) return;
  const keep = getPerson(keepId);
  const drop = getPerson(dropId);
  if (!keep || !drop) throw new Error(t("Unknown person."));
  const d = db();
  d.transaction(() => {
    updatePerson(keep.id, {
      aliases: clean([...keep.aliases, drop.name, ...drop.aliases, ...(drop.whatsapp && drop.whatsapp !== keep.whatsapp && keep.whatsapp ? [drop.whatsapp] : [])]).filter((a) => a.toLowerCase() !== keep.name.toLowerCase()),
      emails: clean([...keep.emails, ...drop.emails]),
      whatsapp: keep.whatsapp || drop.whatsapp,
      accounts: [...keep.accounts, ...drop.accounts.filter((a) => !keep.accounts.some((k) => k.kind === a.kind && k.value.toLowerCase() === a.value.toLowerCase()))],
      note: [keep.note, drop.note].filter((n) => n.trim()).join("\n\n"),
      entityId: keep.entityId ?? drop.entityId,
      starred: keep.starred || drop.starred,
    });
    for (const x of datesOf(drop.id)) {
      const { id: _id, personId: _p, ...rest } = x;
      addDate(keep.id, rest);
    }
    // Its relations — and those others have to it — move along (the same one twice: kept once).
    d.prepare("update or ignore people_relations set person_id = ? where person_id = ?").run(keep.id, drop.id);
    d.prepare("update or ignore people_relations set other_id = ? where other_id = ?").run(keep.id, drop.id);
    d.prepare("delete from people_relations where person_id = ? and other_id = person_id").run(keep.id);
    // Their claims and links too; links to them point to the kept one.
    graphSql("update or ignore people_claims set person_id = ? where person_id = ?", keep.id, drop.id);
    graphSql("update or ignore people_links set person_id = ? where person_id = ?", keep.id, drop.id);
    graphSql("update or ignore people_details set person_id = ? where person_id = ?", keep.id, drop.id);
    // What Zeff trusts about them (@/lib/trust) goes with them.
    graphSql("update or ignore fact_versions set subject = ? where subject = ?", `person:${keep.id}`, `person:${drop.id}`);
    graphSql("update or ignore people_links set target_ref = ? where target_type = 'person' and target_ref = ?", String(keep.id), String(drop.id));
    graphSql("delete from people_links where person_id = ? and target_type = 'person' and target_ref = ?", keep.id, String(keep.id));
    deletePerson(drop.id);
  })();
}

// ---------------------------------------------------------------------------
// Relations: who is who to whom — structured, derived by the AI from your contexts
// ---------------------------------------------------------------------------

export type PersonRelation = { id: number; personId: number; /** From your side: "meine Mutter", "Schwester von Lotte", "Vermieter". */ rel: string; /** The other profile (0: you). */ otherId: number; otherName: string | null; evidence: string; source: "ai" | "manual" };

/** A person's relations: what they are to you / to others (out), and what others are to them (in). */
export function relationsOf(personId: number): { out: PersonRelation[]; in: (PersonRelation & { personName: string })[] } {
  type R = { id: number; person_id: number; rel: string; other_id: number; evidence: string; source: string; other_name: string | null; person_name: string };
  const rows = (where: string) => db().prepare(`select r.*, o.name other_name, p.name person_name from people_relations r join people p on p.id = r.person_id left join people o on o.id = r.other_id where ${where} order by r.id`).all(personId) as R[];
  const view = (r: R): PersonRelation => ({ id: r.id, personId: r.person_id, rel: r.rel, otherId: r.other_id, otherName: r.other_name, evidence: r.evidence, source: r.source === "manual" ? "manual" : "ai" });
  return { out: rows("r.person_id = ?").map(view), in: rows("r.other_id = ?").map((r) => ({ ...view(r), personName: r.person_name })) };
}

/** A relation kept — the same (person, phrase, other) once. */
export function addRelation(personId: number, rel: string, otherId: number, evidence = "", source: "ai" | "manual" = "ai"): boolean {
  const phrase = rel.trim().slice(0, 60);
  if (!phrase || personId === otherId || !getPerson(personId) || (otherId !== 0 && !getPerson(otherId))) return false;
  const r = db().prepare("insert or ignore into people_relations (person_id, rel, other_id, evidence, source, created_at) values (?, ?, ?, ?, ?, ?)").run(personId, phrase, otherId, evidence.trim().slice(0, 300), source, now());
  if (r.changes) changed();
  return r.changes > 0;
}

export function deleteRelation(id: number): void {
  db().prepare("delete from people_relations where id = ?").run(id);
  changed();
}
