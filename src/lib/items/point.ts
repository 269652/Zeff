import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { Collection, CollectionSwitches, Item, ItemAction } from "./shared";

/**
 * The extension point for collections: a plugin that keeps things (Kanban, Keep, Workspace)
 * contributes a provider from its own `server.ts`. Read through `@/lib/items`, never directly —
 * synchronously, as the briefing's prompt builders do.
 */
export type CollectionProvider = {
  /** Its collections. */
  collections(): Collection[];
  /** A collection's items (`archived`: the archived ones too); null when the id isn't one of its collections. */
  items(collectionId: string, opts?: { archived?: boolean }): Item[] | null;
  /** The items among `refs` that are its own and still there. */
  byRefs(refs: string[]): Item[];
  /** Its items among ticket `keys` (upper case: KB-12, WS-7) — those still there. */
  byKeys(keys: string[]): Item[];
  /** Does a Lage suggestion on its item with ticket `key` (upper case); what was done, in words — null when the item isn't its own. */
  act(key: string, action: ItemAction): string | null;
  /** Puts its collection into the briefing or the knowledge, or takes it out; false when the id isn't one of its collections. */
  set(collectionId: string, patch: CollectionSwitches): boolean;
};

export const collectionProviders = extensionPoint<CollectionProvider>("items.collections");
