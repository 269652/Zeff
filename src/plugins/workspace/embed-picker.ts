import type { TreeItem } from "./store";

/**
 * What "Embed page" offers on page `selfId`: the pages below it first (its sub-pages, at any depth), then all the others.
 * Never the page itself, nor its parents (shown in it, they'd show it again); filtered by `q` in the title.
 */
export function embedChoices(items: TreeItem[], selfId: number, q: string): { below: TreeItem[]; other: TreeItem[] } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const parentsOf = (id: number): number[] => {
    const out: number[] = [];
    for (let p = byId.get(id)?.parentId ?? null; p !== null && !out.includes(p); p = byId.get(p)?.parentId ?? null) out.push(p);
    return out;
  };
  const ancestors = new Set(parentsOf(selfId));
  const below = (i: TreeItem) => parentsOf(i.id).includes(selfId);
  const want = q.trim().toLowerCase();
  const shown = items.filter((i) => i.id !== selfId && !ancestors.has(i.id) && (!want || (i.title || "").toLowerCase().includes(want)));
  return { below: shown.filter(below), other: shown.filter((i) => !below(i)) };
}
