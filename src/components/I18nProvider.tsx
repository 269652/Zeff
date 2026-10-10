"use client";

import { createContext, useContext, useMemo } from "react";
import { setFormatLanguage } from "@/lib/format";
import { DEFAULT_LANG, LANGUAGES, translate, translator, type Lang, type T } from "@/lib/i18n/shared";

const LangContext = createContext<Lang>(DEFAULT_LANG);

/**
 * The language in the browser (the root layout passes the account's): client components translate
 * with useT(), and dates, numbers and "ago" (src/lib/format.ts) follow it here too.
 */
export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  // Before the children render: they format with it.
  setFormatLanguage(LANGUAGES[lang].locale, (text, vars) => translate(lang, text, vars));
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/** The language in effect. */
export const useLang = (): Lang => useContext(LangContext);

/** Translate in a client component: const t = useT(); t("Save"), t("{n} entries", { n }). */
export function useT(): T {
  const lang = useLang();
  return useMemo(() => translator(lang), [lang]);
}
