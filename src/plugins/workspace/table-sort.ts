import { numberWithUnit } from "./units";

/**
 * Sorting a page's table by a column (the sort button in a header cell, ui/table-sort-ext.ts): the rows under the header,
 * numbers by their value (before text), text by the alphabet (digits inside read as numbers), empty cells last.
 */

export type SortDir = "asc" | "desc";

/** One cell's sort key: a number (with its unit ignored), text, or empty. */
function key(text: string): { n: number } | { s: string } | null {
  const v = text.trim();
  if (!v) return null;
  const num = numberWithUnit(v);
  return num ? { n: num.n } : { s: v };
}

/** Compares two cells ascending: numbers < text, empty last (whatever the direction — see `sortOrder`). */
function compare(a: string, b: string): number {
  const x = key(a);
  const y = key(b);
  if (!x || !y) return 0;
  if ("n" in x && "n" in y) return x.n - y.n;
  if ("n" in x) return -1;
  if ("n" in y) return 1;
  return x.s.localeCompare(y.s, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * The order the rows take when sorted by one column: the indexes into `cells` (the column's texts, one per row).
 * Stable; the empty ones stay last in both directions.
 */
export function sortOrder(cells: string[], dir: SortDir): number[] {
  const idx = cells.map((_, i) => i);
  const sign = dir === "asc" ? 1 : -1;
  return idx.sort((i, j) => {
    const empty = (k: number) => !cells[k].trim();
    if (empty(i) || empty(j)) return Number(empty(i)) - Number(empty(j)) || i - j;
    return sign * compare(cells[i], cells[j]) || i - j;
  });
}

/** How the rows are ordered by that column now: ascending, descending, or neither (also when all are alike). */
export function currentDir(cells: string[]): SortDir | null {
  const sorted = (dir: SortDir) => sortOrder(cells, dir).every((v, i) => v === i);
  const asc = sorted("asc");
  const desc = sorted("desc");
  return asc === desc ? null : asc ? "asc" : "desc";
}

/** What a click does: ascending first, descending when it is ascending already. */
export const nextDir = (cells: string[]): SortDir => (currentDir(cells) === "asc" ? "desc" : "asc");
