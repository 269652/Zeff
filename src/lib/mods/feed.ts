import fs from "node:fs";
import path from "node:path";
import { getMod, modDir, modState, normalizeManifest, setModState, type Mod } from "./store";

/**
 * Patches from a source — the bridge of docs/zeff-kernel.md (stage 2). A mod in a plugin repository (a folder with zeff-mod.json) is a
 * patch to Zeff itself: it runs with Zeff's own rights, so it is installed from a source only as a signed release (the caller checks it:
 * lib/kernel/release.ts), and never merged — what the source signed is what runs. It names the code it was written for (its targets'
 * hashes): once a Zeff update changes that code — the fix that made the patch needless, or another change — the hook is held back by
 * itself (lib/mods/hook.ts), so a patch never lands on code it wasn't written for. Your switch stays yours: a new patch comes on (you
 * clicked "Install" or "Update"), an update keeps it as you had it. Server only.
 */

export type FeedOrigin = { url: string; path: string; sha: string; version: string; key: string };

const safeRel = (rel: string): boolean => !!rel && !rel.split("/").some((x) => x === ".." || x === "" || x.startsWith(".")) && !path.isAbsolute(rel);

/** The patch's files written as its folder (the files before kept as a version), its origin kept, built and loaded. */
export async function installFeedMod(id: string, files: Map<string, Buffer>, origin: FeedOrigin): Promise<{ mod: Mod; from: string | null; problems: string[] }> {
  const raw = files.get("zeff-mod.json");
  if (!raw) throw new Error("The folder has no zeff-mod.json.");
  const manifest = normalizeManifest(JSON.parse(raw.toString("utf8")));
  if (manifest.id !== id) throw new Error(`The folder holds the mod “${manifest.id}”, not “${id}”.`);
  const dir = modDir(id);
  const had = getMod(id);
  const before = modState(id);
  if (had) {
    // The files before, kept as a version (as every save keeps them).
    const v = path.join(dir, ".versions", String(Date.now()));
    fs.mkdirSync(/*turbopackIgnore: true*/ v, { recursive: true });
    for (const e of fs.readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true })) if (e.isFile() && !e.name.startsWith(".")) fs.copyFileSync(path.join(dir, e.name), path.join(v, e.name));
    // What the patch had and its new version doesn't: gone (its dot folders — state, versions, build — stay).
    for (const e of fs.readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true })) if (!e.name.startsWith(".")) fs.rmSync(path.join(dir, e.name), { recursive: true, force: true });
  }
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  for (const [rel, buf] of files) {
    if (!safeRel(rel)) continue;
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(/*turbopackIgnore: true*/ path.join(dir, rel), buf);
  }
  setModState(id, { enabled: had ? before.enabled : true, by: "feed", changedAt: new Date().toISOString(), from: { ...origin, at: new Date().toISOString() }, disabledReason: undefined });
  const { buildMod } = await import("./build");
  const built = await buildMod(id);
  if (!built.ok) setModState(id, { enabled: false, disabledReason: `it didn't build: ${built.problems.slice(0, 3).join("; ")}` });
  (await import("./server")).loadMods(true);
  return { mod: getMod(id)!, from: had?.manifest.version ?? null, problems: built.problems };
}
