import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { movedOnly, type InBooking } from "./insights";
import { recipientKey } from "./recurring";

/**
 * Your own accounts (the Finances plugin): recipients of your transfers you mark as yours — an account of your own (a second
 * current account, a depot) or a credit account (a credit card, an instalment loan you pay into). Money sent there is no
 * spending: it moved, or it pays a debt off. Marked by the recipient as the bookings name it (recurring.ts recipientKey: the
 * counterparty, else the text) — the bank often gives no IBAN. Server only.
 */

export type AccountKind = "own" | "credit";
const PREF = "finances.ownAccounts";

/** The recipients you marked, by key. */
export const markedAccounts = (): Record<string, AccountKind> => getPref<Record<string, AccountKind>>(PREF, {});

/** A recipient marked as yours (`null`: not any more). */
export function markAccount(key: string, kind: AccountKind | null): void {
  const k = key.trim();
  if (!k) throw new Error("No recipient.");
  const all = { ...markedAccounts() };
  if (kind === "own" || kind === "credit") all[k] = kind;
  else delete all[k];
  setPref(PREF, all);
}

/** The last three whole months before `day` (YYYY-MM-DD): from (inclusive), to (exclusive). */
export function lastThreeMonths(day: string): { from: string; to: string } {
  const d = new Date(`${day}T00:00:00Z`);
  return {
    from: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10),
  };
}

/** The bookings between two days (none read: null). */
export function bookingsBetween(from: string, to: string): InBooking[] | null {
  try {
    return getSqlite().prepare("select date, amount, text, counterparty from bank_transactions where date >= ? and date < ?").all(from, to) as InBooking[];
  } catch {
    return null; // no statements read
  }
}

/** What went to the recipients marked as credit accounts, a month — the last three whole months on average. Null: none marked, or no statements. */
export function creditPayments(day: string, marked = markedAccounts()): number | null {
  const credit = new Set(Object.entries(marked).flatMap(([k, v]) => (v === "credit" ? [k] : [])));
  if (!credit.size) return null;
  const { from, to } = lastThreeMonths(day);
  const rows = bookingsBetween(from, to);
  if (!rows?.length) return null;
  const out = rows.filter((b) => b.amount < 0 && credit.has(recipientKey(b))).reduce((s, b) => s - b.amount, 0);
  return Math.round((out / 3) * 100) / 100;
}

export type Recipient = {
  key: string;
  /** As the latest booking names them. */
  name: string;
  count: number;
  /** Sent there in the window, in all. */
  out: number;
  last: string;
  kind: AccountKind | null;
  /** Money only moves there and back (a pocket, savings): left out of spending by itself. */
  moved: boolean;
};

/**
 * The recipients of the last six months, the most money first — to mark the ones that are yours. Transfers only (a named
 * counterparty, or one marked already): card payments to shops aren't accounts.
 */
export function recipients(day: string, limit = 40): Recipient[] {
  const d = new Date(`${day}T00:00:00Z`);
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 6, 1)).toISOString().slice(0, 10);
  const rows = bookingsBetween(from, "9999-12-31") ?? [];
  const marked = markedAccounts();
  const moved = movedOnly(rows);
  const by = new Map<string, Recipient>();
  for (const b of [...rows].sort((x, y) => x.date.localeCompare(y.date))) {
    if (b.amount >= 0) continue;
    const key = recipientKey(b);
    if (!key || (!b.counterparty.trim() && !marked[key])) continue;
    const r = by.get(key) ?? { key, name: "", count: 0, out: 0, last: "", kind: marked[key] ?? null, moved: moved.has(key) };
    r.name = b.counterparty.trim() || b.text.trim();
    r.count++;
    r.out = Math.round((r.out - b.amount) * 100) / 100;
    r.last = b.date;
    by.set(key, r);
  }
  return [...by.values()].sort((a, b) => Number(!!b.kind) - Number(!!a.kind) || b.out - a.out).slice(0, limit);
}
