import { similarText } from "@/lib/boards/similar";

/**
 * Trust in facts — what a value means (client-safe, pure): the kinds of things Zeff keeps about someone or
 * something (an IBAN, a birthday, an address, a system's address …), how two values of a kind are compared —
 * an IBAN without its spaces, a date in any spelling, a URL without its scheme and last slash, a phone number
 * with or without +49, "Str." as "Straße" — whether a thing has one value at a time (an IBAN changes) or
 * several (phone numbers), and how long a value holds before it is asked about again (a birthday never ends).
 */

export type ValueKind = "iban" | "bic" | "date" | "url" | "phone" | "address" | "handle" | "text";

export type AttributeSpec = {
  kind: ValueKind;
  /** One value at a time: a different one is a contradiction (else: another value besides). */
  single: boolean;
  /** Days a value holds before "still true?" (null: for good). */
  shelfDays: number | null;
};

const URL_SPEC: AttributeSpec = { kind: "url", single: false, shelfDays: 180 };

export const ATTRIBUTES: Record<string, AttributeSpec> = {
  iban: { kind: "iban", single: true, shelfDays: 365 },
  bic: { kind: "bic", single: false, shelfDays: 365 },
  bank: { kind: "text", single: false, shelfDays: 365 },
  revtag: { kind: "handle", single: true, shelfDays: 365 },
  address: { kind: "address", single: true, shelfDays: 365 },
  phone: { kind: "phone", single: false, shelfDays: 365 },
  hours: { kind: "text", single: false, shelfDays: 180 },
  birthday: { kind: "date", single: true, shelfDays: null },
  absence: { kind: "text", single: true, shelfDays: 30 },
  role: { kind: "text", single: false, shelfDays: 120 },
  "prod-url": { kind: "url", single: true, shelfDays: 180 },
  "test-url": URL_SPEC,
  "dev-url": URL_SPEC,
  "other-url": URL_SPEC,
  text: { kind: "text", single: true, shelfDays: 365 },
};

/** An attribute's spec — an unknown one is a free text with one value. */
export const attributeSpec = (attribute: string): AttributeSpec => ATTRIBUTES[attribute] ?? ATTRIBUTES.text;

/** Days a value of the attribute holds (null: for good). */
export const shelfLife = (attribute: string): number | null => attributeSpec(attribute).shelfDays;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = { jan: 1, januar: 1, january: 1, jänner: 1, feb: 2, februar: 2, february: 2, mär: 3, mar: 3, märz: 3, maerz: 3, march: 3, apr: 4, april: 4, mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dez: 12, dec: 12, dezember: 12, december: 12 };
const MONTH_WORDS = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const pad = (n: number) => String(n).padStart(2, "0");
const year4 = (y: string) => (y.length === 2 ? (Number(y) > 50 ? `19${y}` : `20${y}`) : y);
const DATE_RE = new RegExp(String.raw`(\d{4})-(\d{2})-(\d{2})|\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?|\b(\d{1,2})\.?\s*(${MONTH_WORDS})\.?(?:\s+(\d{4}))?`, "giu");

/** The dates a text names, as "YYYY-MM-DD" or "--MM-DD" (no year). */
export function datesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    let y = "";
    let mo = 0;
    let d = 0;
    if (m[1]) [y, mo, d] = [m[1], Number(m[2]), Number(m[3])];
    else if (m[4]) [y, mo, d] = [m[6] ? year4(m[6]) : "", Number(m[5]), Number(m[4])];
    else [y, mo, d] = [m[9] ?? "", MONTHS[m[8].toLowerCase()] ?? 0, Number(m[7])];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(`${y || "-"}-${pad(mo)}-${pad(d)}`);
  }
  return out;
}

/** Two dates the same day: month and day alike, the years too where both have one. */
function sameDate(a: string, b: string): boolean {
  if (a.slice(-5) !== b.slice(-5)) return false;
  const ya = a.slice(0, -6);
  const yb = b.slice(0, -6);
  return ya === "-" || yb === "-" || ya === yb;
}

// ---------------------------------------------------------------------------
// Normalizing and comparing
// ---------------------------------------------------------------------------

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.]+/gu, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function normUrl(v: string): string {
  const s = v.trim().replace(/^[a-z]+:\/\//i, "").replace(/[/#?]+$/, "");
  const at = s.indexOf("/");
  const host = (at < 0 ? s : s.slice(0, at)).toLowerCase().replace(/:(80|443)$/, "");
  return host + (at < 0 ? "" : s.slice(at).replace(/\/+$/, ""));
}

function normPhone(v: string): string {
  const d = v.replace(/[^\d+]/g, "");
  if (d.startsWith("+49")) return `0${d.slice(3)}`;
  if (d.startsWith("0049")) return `0${d.slice(4)}`;
  return d.replace(/\+/g, "");
}

const normAddress = (v: string) =>
  words(v.replace(/stra(?:ss|ß)e\b/gi, "straße").replace(/str\.(?=\s|,|$)/gi, "straße").replace(/str\b/gi, "straße"))
    .replace(/(\d+)\s+([a-z])\b/g, "$1$2");

/** A value as it is compared (and kept unique): what spelling leaves out taken away. */
export function normalizeValue(attribute: string, value: string): string {
  const v = value.trim();
  switch (attributeSpec(attribute).kind) {
    case "iban":
    case "bic":
      return v.replace(/\s+/g, "").toUpperCase();
    case "url":
      return normUrl(v);
    case "phone":
      return normPhone(v);
    case "address":
      return normAddress(v);
    case "handle":
      return `@${v.replace(/^@+/, "").toLowerCase()}`;
    case "date":
      return datesIn(v)[0] ?? words(v);
    default:
      return words(v);
  }
}

/** The values a free text pins down (dates, IBANs, addresses on the web): when both texts have some, they decide. */
function pinned(text: string): string[] {
  const ibans = (text.match(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/gi) ?? []).map((x) => x.replace(/\s+/g, "").toUpperCase());
  const urls = (text.match(/\bhttps?:\/\/[^\s)>\]]+/gi) ?? []).map(normUrl);
  return [...ibans, ...urls];
}

/** Whether two values of an attribute say the same. */
export function sameValue(attribute: string, a: string, b: string): boolean {
  const kind = attributeSpec(attribute).kind;
  if (kind === "date") {
    const [x, y] = [datesIn(a)[0], datesIn(b)[0]];
    if (x && y) return sameDate(x, y);
  }
  if (normalizeValue(attribute, a) === normalizeValue(attribute, b)) return true;
  if (kind !== "text" && kind !== "date") return false;
  // A free text: the dates and IBANs, URLs in it decide when both have them; else mostly the same words.
  const [da, db] = [datesIn(a), datesIn(b)];
  if (da.length && db.length) return da.length === db.length && da.every((d) => db.some((e) => sameDate(d, e)));
  const [pa, pb] = [pinned(a), pinned(b)];
  if (pa.length && pb.length) return pa.length === pb.length && pa.every((x) => pb.includes(x));
  return similarText(a, b);
}

// ---------------------------------------------------------------------------
// Which attribute a fact's subject names
// ---------------------------------------------------------------------------

const SUBJECT_KINDS: [RegExp, string][] = [
  [/geburtstag|birthday|geboren/i, "birthday"],
  [/\biban\b|bankverbindung|kontoverbindung|\bkonto\b|dienstkonto/i, "iban"],
  [/adresse|anschrift|wohnort|\bwohnt\b|address/i, "address"],
  [/telefon|handy|mobil|rufnummer|phone/i, "phone"],
  [/abwesen|urlaub|nicht im dienst|krank|elternzeit|vertretung|absence/i, "absence"],
  [/\brolle\b|position|funktion|zuständig|\brole\b/i, "role"],
];

/** The attribute a fact's subject is about ("Nadines Geburtstag" → birthday); "text" when it names none. */
export function attributeOfSubject(subject: string): string {
  return SUBJECT_KINDS.find(([re]) => re.test(subject))?.[1] ?? "text";
}
