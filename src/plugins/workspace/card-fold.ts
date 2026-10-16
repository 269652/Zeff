/** The text of a gallery card, folded: the first lines (about two lines' worth), and whether there is more behind "more". */
type Line = { kind: "text"; text: string } | { kind: "task"; text: string; checked: boolean; index: number };

const LINES = 2;
const CHARS = 180;

export function foldedLines<T extends Line>(lines: T[]): { shown: T[]; more: boolean } {
  let budget = CHARS;
  const shown: T[] = [];
  let more = false;
  for (const l of lines) {
    if (shown.length >= LINES || budget <= 0) {
      more = true;
      break;
    }
    if (l.kind === "text" && l.text.length > budget) {
      shown.push({ ...l, text: `${l.text.slice(0, Math.max(0, budget - 1)).trimEnd()}…` });
      more = true;
      break;
    }
    budget -= l.text.length;
    shown.push(l);
  }
  if (shown.length < lines.length) more = true;
  return { shown, more };
}
