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

/** Who contributes: a built-in plugin, "core" (Zeff itself, always there), or an external plugin ("ext:<id>", through a provider). */
export type Contributor = PluginId | "core" | `ext:${string}`;

export type Contribution<T> = { plugin: Contributor; impl: T };

export type ExtensionPoint<T> = {
  /** Unique name, "<owner>.<what>" ("kanban.boardProviders"). */
  readonly name: string;
  /** Register `impl` for `plugin`; a plugin contributes once per point (a second call replaces the first). */
  contribute(plugin: Contributor, impl: T): void;
  /** The contributions of the installed plugins, in the order they were registered. */
  list(): Contribution<T>[];
  /** Every contribution, installed or not (for the Plugins page and tests). */
  all(): Contribution<T>[];
  /**
   * Contributions that are found, not registered: `fn` is asked on every `list()` / `all()` and answers with what there is now —
   * the stored forms external plugins declare in their manifests (docs/kernel-contract.md), there while their plugin is on, gone when
   * it is off, changed when it changes, without a restart. Its contributions count as installed (the provider says what is on).
   * Registered once per `key` (a second call replaces the first).
   */
  provide(key: string, fn: () => Contribution<T>[]): void;
};

const points = new Map<string, ExtensionPoint<unknown>>();

export function extensionPoint<T>(name: string): ExtensionPoint<T> {
  const existing = points.get(name);
  if (existing) return existing as ExtensionPoint<T>; // a hot reload evaluates the module again
  const items: Contribution<T>[] = [];
  const providers = new Map<string, () => Contribution<T>[]>();
  const provided = (): Contribution<T>[] =>
    [...providers.values()].flatMap((fn) => {
      try {
        return fn();
      } catch (e) {
        console.error(`[${name}] a provider failed:`, e instanceof Error ? e.message : e);
        return [];
      }
    });
  const point: ExtensionPoint<T> = {
    name,
    contribute(plugin, impl) {
      const at = items.findIndex((c) => c.plugin === plugin);
      if (at >= 0) items[at] = { plugin, impl };
      else items.push({ plugin, impl });
    },
    list: () => [...items.filter((c) => c.plugin === "core" || (!c.plugin.startsWith("ext:") && isInstalled(c.plugin as PluginId))), ...provided()],
    all: () => [...items, ...provided()],
    provide(key, fn) {
      providers.set(key, fn);
    },
  };
  points.set(name, point as ExtensionPoint<unknown>);
  return point;
}

/** Every point defined so far, by name (diagnostics). */
export const extensionPointNames = () => [...points.keys()];
