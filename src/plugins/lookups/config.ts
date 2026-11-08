import { getPref, setPref } from "@/lib/prefs";

/** The sources' keys, each of this account. Everyone brings their own: Zeff ships none. Server only. */
export type LookupConfig = { tmdbKey: string; googleKey: string };

const KEY = "lookups.config";

/** What TMDB's terms ask to be shown where its data is. */
export const TMDB_CREDIT = "This product uses the TMDB API but is not endorsed or certified by TMDB.";

export const getLookupConfig = (): LookupConfig => ({ tmdbKey: "", googleKey: "", ...getPref<Partial<LookupConfig>>(KEY, {}) });

/** What is given changes; a key left out stays. */
export function saveLookupConfig(patch: Partial<LookupConfig>): void {
  const cur = getLookupConfig();
  setPref(KEY, { tmdbKey: patch.tmdbKey?.trim() ?? cur.tmdbKey, googleKey: patch.googleKey?.trim() ?? cur.googleKey });
}
