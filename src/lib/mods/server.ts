import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { modsGlobal, setModParts, type ModPart } from "./hook";
import { currentAccountId } from "@/db/accounts";
import { listMods, modState, safeMode, setModState } from "./store";

/**
 * The mods that are on, put to work in this server (docs/mods.md): their built parts read from data/mods/*\/.build and handed to the
 * hooks (lib/mods/hook.ts — every copy of it, the server's, the server renderer's). The browser part is here too: the server renders
 * what the browser then shows, and both must draw the same. Looked at again on every request (cheap: only when a mod's build or state
 * changed is anything read). Server only.
 */

const g = globalThis as unknown as { __zeffModsLoaded?: string; __zeffRequire?: NodeRequire; __zeffModsQueue?: ModPart[] };

/** What decides what is loaded: which mods are on, their builds' times, safe mode. */
function stamp(): string {
  const parts: string[] = [safeMode() ? "safe" : "on"];
  for (const m of listMods()) {
    if (!m.state.enabled) continue;
    if (m.state.accounts?.length) parts.push(`${m.manifest.id}@${m.state.accounts.join(",")}`);
    for (const f of ["server.js", "client.js"]) {
      try {
        parts.push(`${m.manifest.id}/${f}@${fs.statSync(/*turbopackIgnore: true*/ path.join(m.dir, ".build", f)).mtimeMs}`);
      } catch {
        /* (no such part) */
      }
    }
  }
  return parts.join("|");
}

/** The mods on now, loaded (again, when something changed). Returns what failed to load. */
export function loadMods(force = false): string[] {
  const G = modsGlobal();
  if (!G.onDisabled) {
    // A mod whose hooks keep failing is switched off for good — written down, said on the Mods page.
    G.onDisabled = (mod, reason) => {
      try {
        setModState(mod, { enabled: false, disabledReason: reason });
      } catch {
        /* (its folder is gone) */
      }
    };
  }
  G.refresh ??= () => void loadMods();
  // (A mod for some accounts runs only in calls made for one of them.)
  G.account ??= () => currentAccountId();
  const now = stamp();
  if (!force && g.__zeffModsLoaded === now) return [];
  g.__zeffModsLoaded = now;
  G.safe = safeMode();
  g.__zeffRequire ??= createRequire(path.join(/*turbopackIgnore: true*/ process.cwd(), "package.json"));
  const parts: ModPart[] = [];
  const failed: string[] = [];
  if (!G.safe) {
    for (const m of listMods()) {
      if (!m.state.enabled) continue;
      for (const f of ["server.js", "client.js"]) {
        const file = path.join(m.dir, ".build", f);
        if (!fs.existsSync(file)) continue;
        const prev = g.__zeffModsQueue;
        const mine: ModPart[] = [];
        g.__zeffModsQueue = mine;
        try {
          vm.runInThisContext(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8"), { filename: `mod:${m.manifest.id}/${f}` });
          const accounts = m.state.accounts?.length ? m.state.accounts : undefined;
          parts.push(...mine.map((p) => (accounts ? { ...p, accounts } : p)));
        } catch (e) {
          failed.push(`${m.manifest.id}: ${e instanceof Error ? e.message : String(e)}`);
          setModState(m.manifest.id, { enabled: false, disabledReason: `it didn't load: ${e instanceof Error ? e.message : String(e)}` });
        } finally {
          g.__zeffModsQueue = prev;
        }
      }
    }
  }
  // A mod switched on again starts with a clean slate (its failures counted anew).
  for (const id of [...G.disabled.keys()]) {
    if (!modState(id).enabled) continue;
    G.disabled.delete(id);
    G.failures.delete(id);
  }
  setModParts(parts);
  return failed;
}
