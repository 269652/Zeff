"use client";

import { useEffect, useState } from "react";
import { widgetOutputsAction } from "../actions";
import { WS_CHANGED } from "./ChatPanel";

/**
 * What widgets published (zeff.publish) as the views read it — outputs.<name>: read once for the page, again when something
 * changed (a widget published, the assistant changed the workspace). Every view on the page shares the one read.
 */

let cache: Record<string, unknown> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<(o: Record<string, unknown>) => void>();

function load(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = widgetOutputsAction()
    .then((r) => {
      const next = r.ok ? r.outputs : (cache ?? {});
      if (!cache || JSON.stringify(cache) !== JSON.stringify(next)) {
        cache = next;
        for (const l of listeners) l(next);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The published values by name ({} until read). */
export function useWidgetOutputs(): Record<string, unknown> {
  const [outputs, setOutputs] = useState<Record<string, unknown>>(cache ?? {});
  useEffect(() => {
    listeners.add(setOutputs);
    if (!cache) void load();
    const again = () => void load(true);
    window.addEventListener(WS_CHANGED, again);
    return () => {
      listeners.delete(setOutputs);
      window.removeEventListener(WS_CHANGED, again);
    };
  }, []);
  return outputs;
}
