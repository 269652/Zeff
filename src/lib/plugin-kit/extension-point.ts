import { isInstalled } from "@/plugins/state";
import type { PluginId } from "@/plugins/catalog";

/**
 * Extension points — the way a plugin lets other plugins plug into it without knowing them. The
 * plugin that owns a feature (Kanban's boards, the Auto-Aktionen, the AI tasks) defines a point with
 * the shape of what it takes; a plugin that brings something contributes it under its own id. The
 * owner then reads `list()`: only the contributions of plugins that are installed (and what they build
 * on is) — so an uninstalled plugin's contribution is simply not there, and the owner never imports it.
 *
 * Server only. Contributions are registered when `@/plugins/contributions` is imported (once per process).
 */

export type Contribution<T> = { plugin: PluginId; impl: T };

export type ExtensionPoint<T> = {
  /** Unique name, "<owner>.<what>" ("kanban.boardProviders"). */
  readonly name: string;
  /** Register `impl` for `plugin`; a plugin contributes once per point (a second call replaces the first). */
  contribute(plugin: PluginId, impl: T): void;
  /** The contributions of the installed plugins, in the order they were registered. */
  list(): Contribution<T>[];
  /** Every contribution, installed or not (for the Plugins page and tests). */
  all(): Contribution<T>[];
};

const points = new Map<string, ExtensionPoint<unknown>>();

export function extensionPoint<T>(name: string): ExtensionPoint<T> {
  const existing = points.get(name);
  if (existing) return existing as ExtensionPoint<T>; // a hot reload evaluates the module again
  const items: Contribution<T>[] = [];
  const point: ExtensionPoint<T> = {
    name,
    contribute(plugin, impl) {
      const at = items.findIndex((c) => c.plugin === plugin);
      if (at >= 0) items[at] = { plugin, impl };
      else items.push({ plugin, impl });
    },
    list: () => items.filter((c) => isInstalled(c.plugin)),
    all: () => [...items],
  };
  points.set(name, point as ExtensionPoint<unknown>);
  return point;
}

/** Every point defined so far, by name (diagnostics). */
export const extensionPointNames = () => [...points.keys()];
