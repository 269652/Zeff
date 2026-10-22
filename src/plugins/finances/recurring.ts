/**
 * Recurring payments (the Finances plugin): what goes out to the same recipient again and again — a month, a quarter or a
 * year apart, the amount about the same — read off the bank's bookings, by the numbers alone (no lists of names). A contract
 * or subscription each: what it costs per payment and a month, its rhythm, when it was last paid and when next. One that
 * stopped (its next payment long overdue) is ended. Pure — the bookings come in.
 */

export type Booking = { date: string; amount: number; text: string; counterparty: string };
export type Rhythm = "monthly" | "quarterly" | "yearly";
export type Recurring = {
  /** Who is paid, as the bookings call them (the latest spelling). */
  name: string;
  /** The recipient as compared (lower case, without numbers): the record's key. */
  key: string;
  rhythm: Rhythm;
  /** What one payment is (the median of the last three). */
  amount: number;
  /** What it costs a month (a quarterly one a third, a yearly one a twelfth). */
  monthly: number;
  last: string;
  next: string;
  /** How many payments it is made of. */
  count: number;
  /** Still running (its next payment not long overdue). */
  active: boolean;
};

const RHYTHMS: { rhythm: Rhythm; min: number; max: number; months: number; least: number }[] = [
  { rhythm: "monthly", min: 25, max: 36, months: 1, least: 3 },
  { rhythm: "quarterly", min: 80, max: 100, months: 3, least: 2 },
  { rhythm: "yearly", min: 350, max: 380, months: 12, least: 2 },
];
/** How far apart the amounts may be (of their median) — a phone bill moves a little, shopping a lot. */
const SPREAD = 0.25;

const DAY = 864e5;
const days = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const cents = (v: number) => Math.round(v * 100) / 100;
/** The same day so many months on (the 31st in a shorter month: its last day). */
function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

/** The recipient as compared: its words without numbers, references and the bank's own words around them. */
export function recipientKey(b: Pick<Booking, "text" | "counterparty">): string {
  return (b.counterparty || b.text)
    .toLowerCase()
    .replace(/\b(?:to|an|von|from|zahlung|payment|lastschrift|sepa|card|karte|kartenzahlung)\b/g, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/[^\p{L}&]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** The payments that recur, the running ones first (by what they cost a month). `today`: YYYY-MM-DD. */
export function detectRecurring(bookings: Booking[], today: string): Recurring[] {
  const groups = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (!(b.amount < 0)) continue;
    const key = recipientKey(b);
    if (key.length < 2) continue;
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }
  const out: Recurring[] = [];
  for (const [key, all] of groups) {
    const list = [...all].sort((a, b) => a.date.localeCompare(b.date));
    // Two bookings the same day (a split, a refund and again): one payment.
    const pays = list.filter((b, i) => i === 0 || b.date.slice(0, 10) !== list[i - 1].date.slice(0, 10));
    if (pays.length < 2) continue;
    // The rhythm from the latest stretch of payments: the gaps between the last ones (up to seven).
    const recent = pays.slice(-7);
    const gaps = recent.slice(1).map((b, i) => days(recent[i].date, b.date));
    const gap = median(gaps);
    const r = RHYTHMS.find((x) => gap >= x.min && gap <= x.max);
    if (!r) continue;
    // The payments of that rhythm: a run going back from the last one with gaps in its range.
    let start = recent.length - 1;
    while (start > 0) {
      const g = days(recent[start - 1].date, recent[start].date);
      if (g < r.min || g > r.max) break;
      start--;
    }
    const run = recent.slice(start);
    if (run.length < r.least) continue;
    const amounts = run.slice(-3).map((b) => -b.amount);
    const amount = median(amounts);
    if (amount <= 0 || (Math.max(...amounts) - Math.min(...amounts)) / amount > SPREAD) continue;
    const last = run[run.length - 1].date.slice(0, 10);
    const next = addMonths(last, r.months);
    const latest = list[list.length - 1];
    out.push({
      name: (latest.counterparty || latest.text).trim(),
      key,
      rhythm: r.rhythm,
      amount: cents(amount),
      monthly: cents(amount / r.months),
      last,
      next,
      count: run.length,
      // Running while its next payment isn't overdue by more than half a period.
      active: days(next, today) <= gap / 2,
    });
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || b.monthly - a.monthly);
}
