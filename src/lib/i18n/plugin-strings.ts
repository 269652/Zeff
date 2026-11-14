import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BASE_DIR } from "@/db/accounts";
import { setPluginStrings, type Bundle, type Lang } from "./shared";

/**
 * The texts the runtime plugins bring (zeff-plugin.json → contributes.locales: { "de": "i18n/de.json" }): read from the plugins folder,
 * merged per language (in the order of the folders; the first plugin to have a text keeps it), kept until a plugin's files change.
 * t() on the server reads them through shared.ts; the browser gets them as a script of their own (/api/i18n/<lang>?v=<version>), cached
 * for good — a new version of the texts has a new address. Every installed plugin counts, switched on or not: texts do nothing by
 * themselves. Server only.
 *
 * (It reads the folders itself — only the manifests' locales and language — instead of the plugin registry: t() is imported almost
 * everywhere, also while Zeff's modules are still loading, and the registry's imports would make a cycle of them.)
 */

type Lang2 = { code: string; name: string; native: string; locale: string };
type Found = { id: string; dir: string; locales: Record<string, string>; language?: Lang2 };
type Merged = { sig: string; at: number; plugins: Found[]; byLang: Map<string, { strings: Bundle; version: string }> };
const g = globalThis as { __zeffPluginStrings?: Merged };
/** (t() asks for every text of a page: the folders are looked at again at most every two seconds.) */
const FRESH_MS = 2000;

const root = (): string => (process.env.ZEFF_PLUGINS_DIR ? path.resolve(/*turbopackIgnore: true*/ process.env.ZEFF_PLUGINS_DIR) : path.join(/*turbopackIgnore: true*/ BASE_DIR, "plugins"));

/** The plugins with texts of their own: their folder, their locales (paths inside it) and the language a pack makes Zeff speak. */
function scan(): Found[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(root()).filter((n) => !n.startsWith(".")).sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const dir = path.join(root(), name);
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, "zeff-plugin.json"), "utf8")) as { id?: string; contributes?: { locales?: Record<string, unknown>; language?: Partial<Lang2> } };
      const locales = Object.fromEntries(Object.entries(m.contributes?.locales ?? {}).filter(([k, v]) => /^[a-z]{2}$/.test(k) && typeof v === "string" && !v.split("/").includes(".."))) as Record<string, string>;
      const l = m.contributes?.language;
      const language = l && typeof l.code === "string" && /^[a-z]{2}$/.test(l.code) && locales[l.code] ? { code: l.code, name: String(l.name ?? l.code), native: String(l.native ?? l.code), locale: String(l.locale ?? "") } : undefined;
      return Object.keys(locales).length ? [{ id: String(m.id ?? name), dir, locales, ...(language ? { language } : {}) }] : [];
    } catch {
      return [];
    }
  });
}

function merged(): Merged {
  const last = g.__zeffPluginStrings;
  if (last && Date.now() - last.at < FRESH_MS) return last;
  // (the language packs first: Zeff's own texts — a plugin's own file only adds what the pack doesn't have)
  const plugins = scan().sort((a, b) => Number(!!b.language) - Number(!!a.language));
  const files = plugins.flatMap((p) => Object.entries(p.locales).map(([lang, rel]) => ({ lang, file: path.join(p.dir, ...rel.split("/")) })));
  const sig = files
    .map(({ file }) => {
      try {
        const s = fs.statSync(file);
        return `${file}:${s.size}:${s.mtimeMs}`;
      } catch {
        return `${file}:-`;
      }
    })
    .join("|");
  if (last?.sig === sig) return (g.__zeffPluginStrings = { ...last, plugins, at: Date.now() });
  const byLang = new Map<string, { strings: Bundle; version: string }>();
  for (const { lang, file } of files) {
    let read: unknown;
    try {
      read = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      console.warn(`[i18n] ${file} doesn't hold: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const into = byLang.get(lang)?.strings ?? {};
    for (const [k, v] of Object.entries((read && typeof read === "object" ? read : {}) as Record<string, unknown>)) if (typeof v === "string" && v && !(k in into)) into[k] = v;
    byLang.set(lang, { strings: into, version: "" });
  }
  for (const [lang, m] of byLang) byLang.set(lang, { ...m, version: crypto.createHash("sha1").update(JSON.stringify(m.strings)).digest("hex").slice(0, 12) });
  return (g.__zeffPluginStrings = { sig, at: Date.now(), plugins, byLang });
}

/** The plugins' texts in one language (none: empty). */
export const pluginStringsFor = (lang: string): Bundle => merged().byLang.get(lang)?.strings ?? {};
/** Their version (changes when any text does; "": none) — the browser's script address carries it. */
export const pluginStringsVersion = (lang: string): string => merged().byLang.get(lang)?.version ?? "";
/** The languages runtime plugins make Zeff speak (contributes.language with its locale file). */
export const pluginLanguages = (): (Lang2 & { plugin: string })[] => merged().plugins.flatMap((p) => (p.language ? [{ ...p.language, plugin: p.id }] : []));
/** (Tests: read the folders again now.) */
export const forgetPluginStrings = (): void => void (g.__zeffPluginStrings = undefined);

setPluginStrings((lang: Lang) => pluginStringsFor(lang));
(globalThis as { __zeffPluginLanguages?: typeof pluginLanguages }).__zeffPluginLanguages = pluginLanguages;
