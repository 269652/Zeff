import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { daysBetween, isDateKind, isoDay, nextOccurrence, type DateKind, type Person, type PersonDate, type Upcoming } from "./shared";

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
  `);
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

type PRow = { id: number; name: string; aliases: string; note: string; whatsapp: string; emails: string; entity_id: number | null; starred: number; created_at: string; updated_at: string };
type DRow = { id: number; person_id: number; kind: string; label: string; day: number; month: number; year: number | null; yearly: number; remind_days: number; source: string; source_text: string; confirmed: number };

const toPerson = (r: PRow): Person => ({
  id: r.id,
  name: r.name,
  aliases: parse<string[]>(r.aliases, []),
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
  if (!name) throw new Error("A name, please.");
  const had = db().prepare("select id from people where lower(name) = lower(?)").get(name) as { id: number } | undefined;
  if (had) return had.id;
  const t = now();
  const r = db()
    .prepare("insert into people (name, aliases, note, whatsapp, emails, entity_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(name, JSON.stringify(clean(v.aliases).filter((a) => a.toLowerCase() !== name.toLowerCase())), (v.note ?? "").slice(0, 20000), (v.whatsapp ?? "").trim(), JSON.stringify(clean(v.emails)), v.entityId ?? null, t, t);
  changed();
  return Number(r.lastInsertRowid);
}

export function updatePerson(id: number, patch: { name?: string; aliases?: string[]; note?: string; whatsapp?: string; emails?: string[]; entityId?: number | null; starred?: boolean }): void {
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, v: unknown) => (sets.push(`${col} = ?`), args.push(v));
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error("A name, please.");
    set("name", patch.name.trim().slice(0, 120));
  }
  if (patch.aliases !== undefined) set("aliases", JSON.stringify(clean(patch.aliases)));
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

export function deletePerson(id: number): void {
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
export function markReminded(dateId: number, occurrence: string): void {
  db().prepare("insert or ignore into people_reminded (date_id, occurrence, done_at) values (?, ?, ?)").run(dateId, occurrence, now());
  changed();
}

// ---------------------------------------------------------------------------
// What else Zeff knows of them
// ---------------------------------------------------------------------------

// The name as a word of its own — in the genitive too ("Nadines Geburtstag", "Hans’ Auto", "Karla's").
const word = (n: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:s|['’]s?)?(?=$|[^\\p{L}\\p{N}])`, "iu");

/** Whether a text names them (a name or alias, as a whole word — names shorter than 3 letters left out). */
export function namesThem(p: Person, text: string): boolean {
  return namesOf(p)
    .filter((n) => n.length >= 3)
    .some((n) => word(n).test(text));
}

export type Contact = { key: string; folder: string; who: string; text: string; at: string; convId: string };

/** Their latest messages: their WhatsApp chat, mails from their addresses (or with their name as sender). */
export function contactsOf(p: Person, limit = 12): Contact[] {
  const d = getSqlite();
  const out: Contact[] = [];
  type R = { key: string; folder: string; from_name: string | null; from_email: string | null; subject: string; preview: string; received_at: string; conv_id: string };
  const push = (rows: R[]) => {
    for (const r of rows) if (!out.some((o) => o.key === r.key)) out.push({ key: r.key, folder: r.folder, who: r.from_name ?? r.from_email ?? "", text: r.folder === "WhatsApp" ? r.preview : `${r.subject} — ${r.preview}`, at: r.received_at, convId: r.conv_id });
  };
  try {
    // Their WhatsApp chat: the one set — else one named like them (their name or an alias).
    const chat = p.whatsapp || namesOf(p).find((n) => d.prepare("select 1 from emails where conv_id = ? limit 1").get(`wa:${n}`));
    if (chat) push(d.prepare("select * from emails where conv_id = ? order by received_at desc limit ?").all(`wa:${chat}`, limit) as R[]);
    for (const mail of p.emails) push(d.prepare("select * from emails where lower(from_email) = lower(?) order by received_at desc limit ?").all(mail, limit) as R[]);
    if (!p.whatsapp && !p.emails.length) push(d.prepare("select * from emails where folder <> 'WhatsApp' and lower(from_name) = lower(?) order by received_at desc limit ?").all(p.name, limit) as R[]);
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
