import { collectionProviders } from "@/lib/items/point";
import { isInstalled } from "@/plugins/state";
import { keepCollections } from "./collections";

/**
 * What the Keep module registers (loaded through plugins/contributions): Google Keep's notes (until they are a Workspace
 * database) and old note refs as collections — there while the Workspace is. Not as "workspace": a plugin contributes once
 * per point, and the Workspace's own provider (workspace/server.ts) would replace this one.
 */
const on = () => isInstalled("workspace");
collectionProviders.contribute("core", {
  collections: () => (on() ? keepCollections.collections() : []),
  items: (id, opts) => (on() ? keepCollections.items(id, opts) : null),
  byRefs: (refs) => (on() ? keepCollections.byRefs(refs) : []),
  byKeys: (keys) => (on() ? keepCollections.byKeys(keys) : []),
  act: (key, action) => (on() ? keepCollections.act(key, action) : null),
  set: (id, patch) => (on() ? keepCollections.set(id, patch) : false),
});
