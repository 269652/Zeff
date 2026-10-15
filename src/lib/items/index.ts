import "@/plugins/contributions";
import { collectionProviders } from "./point";
import type { Collection, CollectionSwitches, Item, ItemAction } from "./shared";

/**
 * Collections and their items from every installed plugin that keeps things (server only). What
 * reads boards, notes or databases — the briefing, the knowledge, search, agents, todos' sources —
 * reads them here, not from the plugins' stores.
 */

export type { Collection, CollectionKind, CollectionSwitches, Item, ItemAction, ItemPhase, ItemStatus } from "./shared";

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

/** A collection's items (`archived`: the archived ones too); null when no installed plugin has it. */
export function collectionItems(id: string, opts: { archived?: boolean } = {}): Item[] | null {
  for (const p of providers()) {
    const items = p.items(id, opts);
    if (items) return items;
  }
  return null;
}

/** The items by their ticket keys (KB-12, WS-7; any case), by upper-case key — those still there. */
export function itemsByKeys(keys: string[]): Map<string, Item> {
  const wanted = [...new Set(keys.map((k) => k.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, Item>();
  if (!wanted.length) return out;
  for (const p of providers()) for (const it of p.byKeys(wanted)) if (it.key) out.set(it.key.toUpperCase(), it);
  return out;
}

/** Does a Lage suggestion on the item with ticket `key` (a card, a row): what was done, in words. */
export function itemAction(key: string, action: ItemAction): string {
  const k = key.trim().toUpperCase();
  for (const p of providers()) {
    const done = p.act(k, action);
    if (done !== null) return done;
  }
  throw new Error(`That item doesn't exist (any more): ${k}`);
}

/** Puts a collection into the briefing or the knowledge, or takes it out (its plugin keeps the switch). */
export function setCollection(id: string, patch: CollectionSwitches): void {
  if (!providers().some((p) => p.set(id, patch))) throw new Error(`No such collection: ${id}`);
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

/** What goes into the knowledge: the items of the collections in it, archived ones too. */
export function knowledgeItems(filter: Pick<CollectionFilter, "plugin"> = {}): PlacedItem[] {
  return listCollections({ ...filter, knowledge: true }).flatMap((collection) => (collectionItems(collection.id, { archived: true }) ?? []).map((item) => ({ item, collection })));
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
