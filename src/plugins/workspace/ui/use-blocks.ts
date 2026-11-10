"use client";

import { useEffect, useState } from "react";
import { listBlocksAction } from "../actions";
import type { BlockDef } from "../blocks";
import { WS_CHANGED } from "./ChatPanel";

/**
 * The blocks of your own (blocks.ts) as the views draw them: read once for the page, again when the Workspace changed (the
 * assistant made or changed one). Every view on the page shares the one read.
 */

let cache: BlockDef[] | null = null;
let loading: Promise<BlockDef[]> | null = null;
const listeners = new Set<(b: BlockDef[]) => void>();

function load(force = false): Promise<BlockDef[]> {
  if (cache && !force) return Promise.resolve(cache);
  if (loading && !force) return loading;
  loading = listBlocksAction()
    .then((r) => (r.ok ? r.blocks : (cache ?? [])))
    .catch(() => cache ?? [])
    .then((b) => {
      // (The same blocks as before: the views keep what they have — nothing is drawn again.)
      if (!cache || JSON.stringify(cache) !== JSON.stringify(b)) {
        cache = b;
        for (const l of listeners) l(b);
      }
      loading = null;
      return b;
    });
  return loading;
}

/** The blocks — null until they are read (a view using one draws it a moment later, without a mistake meanwhile). */
export function useBlockDefs(): BlockDef[] | null {
  const [blocks, setBlocks] = useState<BlockDef[] | null>(cache);
  useEffect(() => {
    listeners.add(setBlocks);
    void load().then(setBlocks);
    const again = () => void load(true);
    window.addEventListener(WS_CHANGED, again);
    return () => {
      listeners.delete(setBlocks);
      window.removeEventListener(WS_CHANGED, again);
    };
  }, []);
  return blocks;
}
