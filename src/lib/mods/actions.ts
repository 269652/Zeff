"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";

/** Server Actions of the Mods page (lib/mods): what is there, on/off, build, versions, safe mode, a mod's code saved by hand. */

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const wrap = async <T,>(fn: () => Promise<T> | T): Promise<Res<T & object>> => {
  try {
    const r = await fn();
    revalidatePath("/mods");
    return { ok: true, ...(r as T & object) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
};

export type ModRow = {
  id: string;
  name: string;
  version: string;
  description: string;
  parts: string[];
  enabled: boolean;
  by?: string;
  changedAt?: string;
  disabledReason?: string;
  problems: string[];
  errors: { hook: string; message: string; at: string; where: string }[];
  stale: string[];
  targets: number;
  /** The accounts it is for (unset: every account). */
  accounts?: string[];
  versions: { id: string; at: string }[];
};

export async function modsOverviewAction() {
  return wrap(async () => {
    const store = await import("./store");
    const { modsGlobal } = await import("./hook");
    (await import("./server")).loadMods();
    const G = modsGlobal();
    const catalog = new Map(store.hookCatalog().map((p) => [p.id, p.hash]));
    const mods: ModRow[] = store.listMods().map((m) => ({
      id: m.manifest.id,
      name: m.manifest.name,
      version: m.manifest.version,
      description: m.manifest.description,
      parts: [m.manifest.server && "server", m.manifest.client && "browser", m.manifest.css && "css"].filter(Boolean) as string[],
      enabled: m.state.enabled,
      by: m.state.by,
      changedAt: m.state.changedAt,
      disabledReason: m.state.enabled ? undefined : (G.disabled.get(m.manifest.id) ?? m.state.disabledReason),
      problems: m.state.built?.problems ?? [],
      errors: [...(m.state.errors ?? []), ...G.errors.filter((e) => e.mod === m.manifest.id).map((e) => ({ ...e, where: "server" }))].slice(-10),
      // Held back: what a call met (G.stale) and what the catalog says changed or is gone since it was written — before any call.
      stale: [...new Set([...G.stale.values()].filter((s) => s.mod === m.manifest.id).map((s) => s.hook).concat(catalog.size ? store.staleTargets(m.manifest, catalog) : []))],
      ...(m.state.accounts?.length ? { accounts: m.state.accounts } : {}),
      targets: Object.keys(m.manifest.targets ?? {}).length,
      versions: store.modVersions(m.manifest.id).map((v) => ({ id: v.id, at: v.at })),
    }));
    const { listAccounts, currentAccountId } = await import("@/db/accounts");
    return { mods, safe: store.safeMode(), hooks: store.hookCatalog().length, hooksLive: G.known.size, accounts: listAccounts().map((a) => ({ id: a.id, name: a.name })), account: currentAccountId() };
  });
}

export async function setModEnabledAction(id: string, on: boolean) {
  return wrap(async () => {
    const store = await import("./store");
    if (!store.getMod(String(id))) throw new Error("There is no such mod.");
    if (on) {
      const b = await (await import("./build")).buildMod(String(id));
      if (!b.ok) throw new Error(`It doesn't build: ${b.problems.join("; ")}`);
      store.setModState(String(id), { enabled: true, disabledReason: undefined, errors: [] });
    } else store.setModState(String(id), { enabled: false, disabledReason: "switched off by you" });
    const failed = (await import("./server")).loadMods(true);
    if (failed.length) throw new Error(failed.join("; "));
    return {};
  });
}

/** Which accounts a mod is for: some (a change asked for in one stays there), or every one (null). */
export async function setModAccountsAction(id: string, accounts: string[] | null) {
  return wrap(async () => {
    const store = await import("./store");
    if (!store.getMod(String(id))) throw new Error("There is no such mod.");
    const { listAccounts } = await import("@/db/accounts");
    const known = new Set(listAccounts().map((a) => a.id));
    const list = Array.isArray(accounts) ? [...new Set(accounts.map(String))].filter((a) => known.has(a)) : [];
    store.setModState(String(id), { accounts: list.length && list.length < known.size ? list : undefined });
    (await import("./server")).loadMods(true);
    return {};
  });
}

export async function modSourcesAction(id: string) {
  return wrap(async () => ({ files: (await import("./store")).modSources(String(id)) }));
}

/** A mod's files saved by hand (the manifest and its parts) — built; it stays as it was, on or off. */
export async function saveModAction(manifestText: string, files: Record<string, string>) {
  return wrap(async () => {
    const store = await import("./store");
    const build = await import("./build");
    const manifest = store.normalizeManifest(JSON.parse(String(manifestText)));
    manifest.targets = { ...(manifest.targets ?? {}), ...build.targetsOf(Object.values(files)) };
    store.writeMod(manifest, files, "you");
    const b = await build.buildMod(manifest.id);
    (await import("./server")).loadMods(true);
    return { problems: b.problems };
  });
}

export async function restoreModVersionAction(id: string, version: string) {
  return wrap(async () => {
    (await import("./store")).restoreModVersion(String(id), String(version));
    await (await import("./build")).buildMod(String(id));
    (await import("./server")).loadMods(true);
    return {};
  });
}

export async function removeModAction(id: string) {
  return wrap(async () => {
    (await import("./store")).removeMod(String(id));
    (await import("./server")).loadMods(true);
    return {};
  });
}

export async function setSafeModeAction(on: boolean) {
  return wrap(async () => {
    (await import("./store")).setSafeMode(!!on);
    (await import("./server")).loadMods(true);
    return {};
  });
}
