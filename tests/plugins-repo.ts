import fs from "node:fs";
import path from "node:path";

/**
 * Where the tests find the plugins that left Zeff for their own repository (zeff-plugins): ZEFF_PLUGINS_REPO, else ../zeff-plugins beside
 * Zeff. `skip`: a reason to skip a test that needs it when it isn't there (a checkout of Zeff alone).
 */
export const PLUGINS_REPO = path.resolve(process.env.ZEFF_PLUGINS_REPO ?? "../zeff-plugins");
export const repoPlugin = (dir: string): string => path.join(PLUGINS_REPO, "plugins", dir);
export const skipWithoutRepo = (dir: string): string | false => (fs.existsSync(path.join(repoPlugin(dir), "zeff-plugin.json")) ? false : `needs the zeff-plugins repository (${repoPlugin(dir)})`);

/**
 * Zeff's languages for a test: the language packs of the zeff-plugins repository read as the plugins' texts (as a Zeff with them
 * installed has them). false: the repository isn't there (a test needing German skips).
 */
export async function loadRepoLanguages(): Promise<boolean> {
  if (!fs.existsSync(path.join(repoPlugin("lang-de"), "bundle.json"))) return false;
  const { setPluginStrings } = await import("../src/lib/i18n/shared");
  const read = (lang: string): Record<string, string> => {
    try {
      return JSON.parse(fs.readFileSync(path.join(repoPlugin(`lang-${lang}`), "bundle.json"), "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const packs: Record<string, Record<string, string>> = { de: read("de"), es: read("es") };
  setPluginStrings((lang) => packs[lang] ?? {});
  (globalThis as { __zeffPluginLanguages?: () => { code: string }[] }).__zeffPluginLanguages = () => [{ code: "de" }, { code: "es" }];
  return true;
}
