import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { Collection, Item } from "./shared";

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
};

export const collectionProviders = extensionPoint<CollectionProvider>("items.collections");
