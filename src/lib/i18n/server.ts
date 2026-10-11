import { currentAccountId } from "@/db/accounts";
import { getPref, setPref } from "@/lib/prefs";
import { setFormatResolver } from "@/lib/format";
import { isInstalled } from "@/plugins/state";
import { DEFAULT_LANG, LANGS, LANGUAGES, isLang, translate, type Lang, type Vars } from "./shared";

/**
 * The language of the account this runs for (server side): as set on the Settings page, while its
 * bundle (plugin) is installed — else English.
 */

const PREF = "language";

/** The languages there are: those whose bundle is installed (English always — it's the text itself). */
export const availableLanguages = (): Lang[] => LANGS.filter((l) => l === "en" || isInstalled(LANGUAGES[l].plugin));

/** Per account, for a moment: t() asks for every text of a page. Dropped when it's set. */
const memo = globalThis as unknown as { __zeffLanguage?: Map<string, { at: number; lang: Lang }> };
const langMemo = (memo.__zeffLanguage ??= new Map());

export function getLanguage(): Lang {
  const account = currentAccountId();
  const hit = langMemo.get(account);
  if (hit && Date.now() - hit.at < 2000) return hit.lang;
  const want = getPref<string>(PREF, DEFAULT_LANG);
  const lang = isLang(want) && availableLanguages().includes(want) ? want : DEFAULT_LANG;
  langMemo.set(account, { at: Date.now(), lang });
  return lang;
}

export function setLanguage(lang: string): Lang {
  if (!isLang(lang) || !availableLanguages().includes(lang)) throw new Error("This language isn't installed (Menu → Plugins).");
  setPref(PREF, lang);
  langMemo.clear();
  return lang;
}

/** A text in the account's language. */
export const t = (text: string, vars?: Vars): string => translate(getLanguage(), text, vars);

/** The language for a render (the root layout: <html lang>, the browser's I18nProvider). */
export const applyLanguage = (): Lang => getLanguage();

// Dates, numbers and "ago" on the server: in the account's language, asked at each call.
setFormatResolver(() => {
  const lang = getLanguage();
  return { locale: LANGUAGES[lang].locale, t: (text, vars) => translate(lang, text, vars) };
});
