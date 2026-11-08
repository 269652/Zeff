import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { canSearch } from "@/plugins/web-search/search";
import type { LookupSource } from "../lookup-point";
import { lookupDetails, lookupSearch, secretsFor } from "./run";
import { listLambdas } from "./store";
import type { LambdaManifest } from "./types";

/**
 * Lookup lambdas as the Workspace's lookup sources: a view's <lookup source="tmdb.movies">, a flow's lookup.search — the lambda's
 * search and details, their output checked. What it still needs (a key it requires, the Web search for one that searches the web) is
 * said instead of searching. Server only.
 */

/** What a lambda still needs before it can run — null: ready. */
export function lambdaMissing(m: LambdaManifest): string | null {
  const have = secretsFor({ secrets: m.requires });
  const lacking = (m.requires ?? []).filter((k) => !have[k]);
  if (lacking.includes("GOOGLE_KEY")) return t("Add a Google API key under Settings → Lookups.");
  if (lacking.includes("TMDB_KEY")) return t("Add the TMDB key under Settings → Lookups.");
  if (lacking.length) return t("Set the secret {names} in the Studio (Secrets).", { names: lacking.join(", ") });
  if (m.zeff?.includes("web.search")) {
    if (!isInstalled("web-search")) return t("Install the Web search plugin (Menu → Plugins).");
    if (!canSearch()) return t("The Claude CLI or a key is needed: Settings → Web search.");
  }
  return null;
}

export function lambdaLookupSources(): LookupSource[] {
  return listLambdas()
    .filter((l) => l.manifest.kind === "lookup")
    .map(({ manifest: m }) => ({
      id: m.name,
      label: m.label,
      what: m.what,
      fields: m.fields ?? {},
      ...(m.credit ? { credit: m.credit } : {}),
      ...(m.slow ? { slow: true } : {}),
      missing: () => lambdaMissing(m),
      search: (q, language) => lookupSearch(m.name, q, language),
      details: (id, language) => lookupDetails(m.name, id, language),
    }));
}
