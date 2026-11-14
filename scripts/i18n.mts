/**
 * The language bundles against the code: every text passed to t("…") (server) or a useT() t("…")
 * (client) is a key; each language pack (zeff-plugins: plugins/lang-<code>/bundle.json — ZEFF_PLUGINS_REPO, else ../zeff-plugins)
 * maps it to its language; English's few overrides are src/plugins/lang-en/bundle.json.
 *
 *   npm run i18n              what's missing in each bundle, and what's no longer used
 *   npm run i18n -- --write   add the missing keys (empty: shown in English until translated),
 *                             drop the unused ones, sort
 *
 * Keys must be literals — t("Save"), t("{n} entries", { n }) — never t(variable): only literals
 * can be found here (and translated).
 */
import fs from "node:fs";
import path from "node:path";
import { collectKeys } from "../src/lib/i18n/collect";

const ROOT = process.cwd();
const write = process.argv.includes("--write");

const REPO = path.resolve(ROOT, process.env.ZEFF_PLUGINS_REPO ?? "../zeff-plugins");
const bundlePath = (lang: string) => (lang === "en" ? path.join(ROOT, "src", "plugins", "lang-en", "bundle.json") : path.join(REPO, "plugins", `lang-${lang}`, "bundle.json"));

if (process.argv[1] && /i18n\.mts$/.test(process.argv[1])) {
  const keys = collectKeys();
  console.log(`${keys.size} texts in the code.`);
  for (const lang of ["de", "es", "en"]) {
    const file = bundlePath(lang);
    const bundle = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    // English is the text itself: its bundle stays empty unless a wording is overridden.
    const missing = lang === "en" ? [] : [...keys.keys()].filter((k) => !bundle[k]);
    const unused = Object.keys(bundle).filter((k) => !keys.has(k));
    console.log(`  ${lang}: ${missing.length} missing, ${unused.length} unused`);
    if (write) {
      const out: Record<string, string> = {};
      for (const k of [...(lang === "en" ? Object.keys(bundle).filter((k) => keys.has(k)) : keys.keys())].sort((a, b) => a.localeCompare(b))) out[k] = bundle[k] ?? "";
      fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
    }
  }
}
