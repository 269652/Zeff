import { formatDate } from "@/lib/format";
import { translator, type T } from "@/lib/i18n/shared";

const EN = translator("en");

/**
 * People (the Personen plugin) — what pages and the server share: a profile, its dates and when
 * they come round, a reminder. Client-safe.
 */

export const DATE_KINDS = ["birthday", "anniversary", "other"] as const;
export type DateKind = (typeof DATE_KINDS)[number];
export const DATE_KIND_LABELS: Record<DateKind, string> = { birthday: "Birthday", anniversary: "Anniversary", other: "Date" };
/** The kinds' names in the language of `t`. */
export const dateKindLabels = (t: T): Record<DateKind, string> => ({ birthday: t("Birthday"), anniversary: t("Anniversary"), other: t("Date") });
export const isDateKind = (v: unknown): v is DateKind => (DATE_KINDS as readonly unknown[]).includes(v);

/** A person's date: a birthday or anniversary (every year), or one day (a year given, not yearly). */
export type PersonDate = {
  id: number;
  personId: number;
  kind: DateKind;
  label: string;
  day: number;
  month: number;
  /** The year: of birth (a birthday — the age follows), the first one (an anniversary), the day (a one-off). */
  year: number | null;
  yearly: boolean;
  /** Reminded this many days before (and on the day). */
  remindDays: number;
  /** Where it came from: by hand, a fact, the AI — and what said so. */
  source: "manual" | "fact" | "ai";
  sourceText: string;
  /** A proposal (fact, AI) not confirmed yet: no reminders until you do. */
  confirmed: boolean;
};

/** An account of a person somewhere else — which Jira user they are (for @-mentions in comments synced to Jira). */
export type PersonAccount = { kind: "jira"; value: string };

/** A person's compiled summary: what connects you, the key facts, the fun facts — and when, from how many things Zeff had on them. */
export type PersonSummary = { connection: string; keyFacts: string[]; funFacts: string[]; at: string; sources: number };

export type Person = {
  id: number;
  name: string;
  aliases: string[];
  /** Their linked accounts (Jira usernames). */
  accounts: PersonAccount[];
  /** Their compiled summary (the Compile page); null: not compiled yet. */
  compiled: PersonSummary | null;
  note: string;
  /** The WhatsApp chat (its name) — their messages. */
  whatsapp: string;
  /** Their mail addresses — their mails. */
  emails: string[];
  /** The knowledge's entity (its id on this account's knowledge server). */
  entityId: number | null;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
};

/** A date coming round: when (YYYY-MM-DD), in how many days, how old they turn. */
export type Upcoming = { date: PersonDate; person: Pick<Person, "id" | "name">; on: string; inDays: number; turns: number | null };

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "16.10." / "16.10.1996" / "1996-10-16" / "16. Oktober (1996)" → day, month, year; null when it isn't a date. */
const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
export function parseDayMonth(text: string): { day: number; month: number; year: number | null } | null {
  const t = text.trim().toLowerCase();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return valid(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}|\d{2}))?/.exec(t);
  if (m) return valid(Number(m[1]), Number(m[2]), m[3] ? fullYear(Number(m[3])) : null);
  m = new RegExp(`(\\d{1,2})\\.?\\s*(${MONTHS.join("|")}|maerz)(?:\\s+(\\d{4}))?`).exec(t);
  if (m) return valid(Number(m[1]), m[2] === "maerz" ? 3 : MONTHS.indexOf(m[2]) + 1, m[3] ? Number(m[3]) : null);
  return null;
}
const fullYear = (y: number) => (y >= 100 ? y : y > (new Date().getFullYear() % 100) + 1 ? 1900 + y : 2000 + y);
function valid(day: number, month: number, year: number | null) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(year ?? 2024, month - 1, day);
  if (probe.getMonth() !== month - 1) return null;
  return { day, month, year };
}

/** The date as Zeff shows dates: "16 Oct" or "16 Oct 1996". */
export const dateText = (d: Pick<PersonDate, "day" | "month" | "year">) => formatDate(new Date(d.year ?? 2000, d.month - 1, d.day), { weekday: false, year: !!d.year });

/**
 * When it comes round next, from `today` on (today itself counts): a yearly one this year or
 * next (29.2. in a year without it: the 28th), a one-off on its day (null when it's past).
 */
export function nextOccurrence(d: Pick<PersonDate, "day" | "month" | "year" | "yearly">, today: Date): Date | null {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!d.yearly) {
    if (!d.year) return null;
    const on = new Date(d.year, d.month - 1, d.day);
    return on >= start ? on : null;
  }
  const at = (y: number) => {
    const last = new Date(y, d.month, 0).getDate();
    return new Date(y, d.month - 1, Math.min(d.day, last));
  };
  const thisYear = at(start.getFullYear());
  return thisYear >= start ? thisYear : at(start.getFullYear() + 1);
}

/** Days from `today` to `on` (0: today). */
export const daysBetween = (today: Date, on: Date) => Math.round((on.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 864e5);

/** "today", "tomorrow", "in 5 days", "on 16 Oct" — in the language of `t` (English without). */
export const inDaysText = (n: number, on?: string, t: T = EN) =>
  n === 0 ? t("today") : n === 1 ? t("tomorrow") : n < 14 || !on ? t("in {n} days", { n }) : t("on {date}", { date: formatDate(on, { weekday: false }) });

/** "Nadine's", "James’" — a name's possessive. */
export const genitive = (name: string) => (/s$/i.test(name.trim()) ? `${name.trim()}’` : `${name.trim()}’s`);

/** (1st), (2nd), (3rd), (4th), (11th), (21st) … */
const ordinal = (n: number, t: T) => {
  const end = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return end === "st" ? t("({n}st)", { n }) : end === "nd" ? t("({n}nd)", { n }) : end === "rd" ? t("({n}rd)", { n }) : t("({n}th)", { n });
};

/** "Nadine’s birthday", "James’ birthday". */
const birthdayOf = (name: string, t: T) => (/s$/i.test(name.trim()) ? t("{name}’ birthday", { name: name.trim() }) : t("{name}’s birthday", { name: name.trim() }));

/** A reminder's line: "Nadine’s birthday (turns 30)" — in the language of `t` (English without). */
export const upcomingTitle = (u: Upcoming, t: T = EN) =>
  u.date.kind === "birthday"
    ? `${birthdayOf(u.person.name, t)}${u.turns ? ` ${t("(turns {n})", { n: u.turns })}` : ""}`
    : `${u.date.label || dateKindLabels(t)[u.date.kind]} — ${u.person.name}${u.turns && u.date.kind === "anniversary" ? ` ${ordinal(u.turns, t)}` : ""}`;

/** The same without the person: "Birthday (turns 30)", "Wedding anniversary". */
export const upcomingShort = (u: Upcoming, t: T = EN) =>
  `${u.date.kind === "other" ? u.date.label || dateKindLabels(t).other : dateKindLabels(t)[u.date.kind]}${u.turns ? (u.date.kind === "birthday" ? ` ${t("(turns {n})", { n: u.turns })}` : ` ${ordinal(u.turns, t)}`) : ""}`;
