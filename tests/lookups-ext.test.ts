/**
 * Lookups as an external plugin (zeff-plugins/plugins/lookups-ext, its sources as lambdas, its keys as encrypted plugin settings):
 * every test of the built-in Lookups (tests/lookups.test.ts), run against the plugin — the port is 1:1 when both pass. Skipped where
 * the zeff-plugins repository isn't beside Zeff.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { skipWithoutRepo } from "./plugins-repo";

process.env.ZEFF_LOOKUPS_EXT = "1";
const skip = skipWithoutRepo("lookups-ext");
if (skip) test("Lookups as a plugin", { skip }, () => {});
// eslint-disable-next-line @typescript-eslint/no-require-imports
else require("./lookups.test");

test("switching from the built-in Lookups: the keys come along (encrypted), the plugin on, the built-in off", { skip }, async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { repoPlugin } = await import("./plugins-repo");
  const { setInstalled, isInstalled } = await import("@/plugins/state");
  const reg = await import("@/lib/ext/registry");
  // (a plugins folder of its own: the plugin as the repository has it, switched off)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-lookups-switch-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("lookups-ext"), path.join(dir, "lookups-ext"), { recursive: true });
  reg.scanPlugins(true);
  setInstalled("lookups", true);
  (await import("@/plugins/lookups/config")).saveLookupConfig({ tmdbKey: "tmdb-123456", googleKey: "goog-abcdef" });
  const { switchLookupsToPlugin } = await import("@/plugins/lookups/to-plugin");
  const r = await switchLookupsToPlugin();
  assert.deepEqual(r.keys.sort(), ["GOOGLE_KEY", "TMDB_KEY"]);
  assert.equal(isInstalled("lookups"), false);
  assert.equal(reg.isEnabled("lookups-ext"), true);
  const ps = await import("@/lib/ext/plugin-settings");
  const v = ps.pluginSettings("lookups-ext", reg.getPlugin("lookups-ext")!.manifest);
  assert.deepEqual([v.TMDB_KEY, v.GOOGLE_KEY], ["tmdb-123456", "goog-abcdef"]);
});
