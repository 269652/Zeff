import en from "@/plugins/lang-en/bundle.json";

/**
 * Zeff's languages (client-safe). The text in the code is English — the key; a language pack maps it to its language. The packs are
 * runtime plugins (zeff-plugins: plugins/lang-de, plugins/lang-es — contributes.language with its locales file), installed through
 * packages.json like any plugin; English needs none (lang-en, built in, only overrides a wording). A text missing from the pack shows
 * in English. Placeholders: "{n} entries" with { n: 3 }.
 */

export const LANGUAGES = {
  en: { name: "English", native: "English", locale: "en-GB", plugin: "lang-en" },
  de: { name: "German", native: "Deutsch", locale: "de-DE", plugin: "lang-de" },
  es: { name: "Spanish", native: "Español", locale: "es-ES", plugin: "lang-es" },
} as const;
export type Lang = keyof typeof LANGUAGES;
export const LANGS = Object.keys(LANGUAGES) as Lang[];
export const DEFAULT_LANG: Lang = "en";
export const isLang = (v: unknown): v is Lang => typeof v === "string" && v in LANGUAGES;

export type Bundle = Record<string, string>;
export type Vars = Record<string, string | number | null | undefined>;

/**
 * The texts the plugins bring in their own files (zeff-plugin.json → contributes.locales) — the language packs first, then every other
 * plugin's own texts: on the server read from the plugins folder (plugin-strings.ts sets the resolver), in the browser from the script
 * the root layout loads before React starts (/api/i18n/<lang> → window.__zeffStrings).
 */
type Resolver = (lang: Lang) => Bundle;
const g = globalThis as { __zeffStringsResolver?: Resolver; __zeffStrings?: Partial<Record<string, Bundle>> };
export const setPluginStrings = (r: Resolver): void => void (g.__zeffStringsResolver = r);
const pluginStrings = (lang: Lang): Bundle => {
  try {
    return g.__zeffStringsResolver?.(lang) ?? g.__zeffStrings?.[lang] ?? {};
  } catch {
    // (a text asked while the modules are still being loaded — the plugins' folder not known yet: English)
    return {};
  }
};

/** Every text of a language Zeff has now (English: only the wordings lang-en overrides). */
export const bundleOf = (lang: Lang): Bundle => (lang === "en" ? en : pluginStrings(lang));

/** The text in a language: its pack's (or a plugin's own), else the English (the key) — with {placeholders} filled. */
export function translate(lang: Lang, text: string, vars?: Vars): string {
  const s = bundleOf(lang)[text] || text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s;
}

/** A translator for one language. */
export type T = (text: string, vars?: Vars) => string;
export const translator = (lang: Lang): T => (text, vars) => translate(lang, text, vars);
