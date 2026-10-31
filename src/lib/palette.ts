/** The search's scoring and its keys (lib/search, components/Search): what a typed text finds among entries, and in which order. */
export type PaletteItem = { id: string; label: string; hint?: string; href: string; group: string; /** Extra words that find it (the old name, a ticket key). */ keywords?: string };

/** Text as the palette compares it: lower case, without accents. */
export const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** 0 = no match; higher is better: the label starts with the text > a word starts with it > the label contains it > the hint/keywords do. Every word of the query must match. */
export function scoreItem(item: PaletteItem, query: string): number {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const label = norm(item.label);
  const rest = norm(`${item.hint ?? ""} ${item.keywords ?? ""} ${item.group}`);
  let total = 0;
  for (const w of words) {
    let s = 0;
    if (label.startsWith(w)) s = 100;
    else if (label.split(/[^a-z0-9]+/).some((x) => x.startsWith(w))) s = 70;
    else if (label.includes(w)) s = 40;
    else if (rest.includes(w)) s = 15;
    if (!s) return 0;
    total += s;
  }
  return total;
}

/** The items matching `query`, best first (ties keep their order); without a query the first `limit` as they are. */
export function filterPalette(items: PaletteItem[], query: string, limit = 30): PaletteItem[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((item, i) => ({ item, i, s: scoreItem(item, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item);
}

/** A key press that should open the palette: Ctrl/Cmd+K anywhere, "/" only when not typing in a field. */
export function opensPalette(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey?: boolean; target: EventTarget | { tagName?: string } | null }): boolean {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") return true;
  return e.key === "/" && !typing(e) && !e.ctrlKey && !e.metaKey && !e.altKey;
}
/** Ctrl/Cmd+Shift+K opens the commands (what Zeff can run by hand: syncs, routines, jobs …) — anywhere, in a field too. */
export function opensCommands(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey?: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && !!e.shiftKey && !e.altKey && e.key.toLowerCase() === "k";
}
/** A command's href ("zeff:sync:jira") taken apart: what it does and what on; null for a page's href. */
export function parseCommand(href: string): { what: string; arg: string } | null {
  const m = /^zeff:([^:]+):?(.*)$/.exec(href);
  return m ? { what: m[1], arg: m[2] } : null;
}
/** "?" opens the shortcuts help — not while typing. */
export function opensShortcuts(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: EventTarget | { tagName?: string } | null }): boolean {
  return e.key === "?" && !typing(e) && !e.ctrlKey && !e.metaKey && !e.altKey;
}
/** Is the key press typing in a field (an input, a text area, something editable)? */
export function typing(e: { target: EventTarget | { tagName?: string } | null }): boolean {
  const el = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  return !!el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes((el.tagName ?? "").toUpperCase());
}
