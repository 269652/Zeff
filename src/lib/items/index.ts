import "@/plugins/contributions";
import { collectionProviders } from "./point";
import type { Collection, Item } from "./shared";

/**
 * Collections and their items from every installed plugin that keeps things (server only). What
 * reads boards, notes or databases — the briefing, the knowledge, search, agents, todos' sources —
 * reads them here, not from the plugins' stores.
 */

export type { Collection, CollectionKind, Item, ItemPhase, ItemStatus } from "./shared";

const providers = () => collectionProviders.list().map((c) => c.impl);

export type CollectionFilter = { plugin?: string; briefing?: boolean; knowledge?: boolean };

export function listCollections(filter: CollectionFilter = {}): Collection[] {
  return providers()
    .flatMap((p) => p.collections())
    .filter(
      (c) =>
        (filter.plugin === undefined || c.plugin === filter.plugin) &&
        (filter.briefing === undefined || c.briefing === filter.briefing) &&
        (filter.knowledge === undefined || c.knowledge === filter.knowledge),
    );
}

/** A collection's items; null when no installed plugin has it. */
export function collectionItems(id: string): Item[] | null {
  for (const p of providers()) {
    const items = p.items(id);
    if (items) return items;
  }
  return null;
}

/** The items by their refs, those still there (an unknown ref is left out). */
export function itemsByRefs(refs: string[]): Map<string, Item> {
  const wanted = [...new Set(refs)];
  const out = new Map<string, Item>();
  if (!wanted.length) return out;
  for (const p of providers()) for (const it of p.byRefs(wanted)) out.set(it.ref, it);
  return out;
}

/** An item with the collection it's in. */
export type PlacedItem = { item: Item; collection: Collection };

/** The items with their collections (an item whose collection isn't listed any more is left out). */
export function placed(items: Iterable<Item>): PlacedItem[] {
  const cols = new Map(listCollections().map((c) => [c.id, c]));
  return [...items].flatMap((item) => {
    const collection = cols.get(item.collectionId);
    return collection ? [{ item, collection }] : [];
  });
}

/**
 * What the briefing reads as notes: the items of the collections in it — not the boards', whose
 * cards are tickets in the Lage themselves.
 */
export function briefingNotes(): PlacedItem[] {
  return listCollections({ briefing: true })
    .filter((c) => c.kind !== "board")
    .flatMap((collection) => (collectionItems(collection.id) ?? []).map((item) => ({ item, collection })));
}
