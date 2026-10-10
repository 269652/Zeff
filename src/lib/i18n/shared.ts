import de from "@/plugins/lang-de/bundle.json";
import en from "@/plugins/lang-en/bundle.json";
import es from "@/plugins/lang-es/bundle.json";

/**
 * Zeff's languages (client-safe). The text in the code is English — the key; a language bundle
 * (a plugin: lang-de, lang-en, lang-es) maps it to its language. A text missing from the bundle
 * shows in English. Placeholders: "{n} entries" with { n: 3 }.
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

const BUNDLES: Record<Lang, Bundle> = { de, en, es };
export const bundleOf = (lang: Lang): Bundle => BUNDLES[lang] ?? {};

/** The text in a language: its bundle's, else the English (the key) — with {placeholders} filled. */
export function translate(lang: Lang, text: string, vars?: Vars): string {
  const s = bundleOf(lang)[text] || text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s;
}

/** A translator for one language. */
export type T = (text: string, vars?: Vars) => string;
export const translator = (lang: Lang): T => (text, vars) => translate(lang, text, vars);
