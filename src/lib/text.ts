/**
 * Small text and date helpers that were copied around. Only pure imports: client-bundled `-shared.ts`
 * modules use it too.
 */

/** A number as two digits ("7" → "07"). */
export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** A local date as YYYY-MM-DD. */
export { localDay as isoDay } from "./dates";

/** Whitespace flattened to single spaces and cut to n characters, "…" after the cut (so up to n + 1 long). Null → "". */
export function clip(s: string | null | undefined, n: number): string {
  const flat = (s ?? "").replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

/** At most n characters including the "…" that marks a cut (the text before it trimmed at the end). */
export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** Whitespace flattened to single spaces and trimmed. Null → "". */
export const flatten = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

/** flatten, then the first n characters — no mark of a cut. */
export const flatSlice = (s: unknown, n: number): string => flatten(s).slice(0, n);

/** flatten, then at most n characters including the "…" that marks a cut (unlike truncate, not trimmed before it). */
export function flatTruncate(s: unknown, n: number): string {
  const v = flatten(s);
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}

/** Trimmed, then the first n characters (whitespace inside kept). Null → "". */
export const trimSlice = (s: unknown, n: number): string => String(s ?? "").trim().slice(0, n);

/** A text to match as it is in a RegExp: its special characters escaped. */
export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
