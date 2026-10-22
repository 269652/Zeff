/**
 * A colour per creditor, the same in every chart of the finances: given out once, in the order the creditors come (the most
 * open first), from a palette that reads on white and on dark. More creditors than colours: the palette starts again.
 * Client-safe.
 */

const PALETTE = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#a855f7", "#ec4899", "#84cc16", "#92400e", "#0e7490", "#64748b", "#1e3a8a"];

/** The colours of these creditors (their keys, in the order they are to get them). */
export function creditorColors(keys: number[]): Record<number, string> {
  const out: Record<number, string> = {};
  [...new Set(keys)].forEach((k, i) => (out[k] = PALETTE[i % PALETTE.length]));
  return out;
}

/** A debt row's creditor: its key (the contact, else the row itself), name and colour — what a chart groups by. */
export type CreditorOf = Record<number, { key: number; name: string; color: string }>;
