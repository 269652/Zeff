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
