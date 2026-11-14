import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoPlugin } from "./plugins-repo";

/**
 * ZEFF_CORRELATIONS_EXT=1 (tests/correlations-ext.test.ts): the Correlations tests run against its port from the zeff-plugins repository
 * (plugins/correlations-ext) — the built-in switched off, the port on. Once per test file.
 */
export const CORRELATIONS_EXT = process.env.ZEFF_CORRELATIONS_EXT === "1";
let done = false;
export async function useCorrelationsPort(): Promise<void> {
  if (!CORRELATIONS_EXT || done) return;
  done = true;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-correlations-ext-"));
  process.env.ZEFF_PLUGINS_DIR = dir;
  fs.cpSync(repoPlugin("correlations-ext"), path.join(dir, "correlations-ext"), { recursive: true });
  const reg = await import("@/lib/ext/registry");
  reg.scanPlugins(true);
  reg.setEnabled("correlations-ext", true);
  (await import("@/plugins/state")).setInstalled("correlations", false);
}
