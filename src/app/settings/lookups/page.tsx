import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { t } from "@/lib/i18n/server";
import { getLookupConfig } from "@/plugins/lookups/config";
import { saveLookupsAction, testTmdbAction } from "@/plugins/lookups/server-actions";
import { TMDB_CREDIT } from "@/plugins/lookups/config";
import { isInstalled } from "@/plugins/state";
import { lookupSources } from "@/plugins/workspace/lookups";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Lookups") };
}

const field = "w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** Settings → Lookups: what a view's <lookup> can search, and the keys that takes. */
export default async function LookupsSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await connection();
  if (!isInstalled("lookups")) return <PluginNotInstalled id="lookups" />;
  const sp = await searchParams;
  const c = getLookupConfig();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
        ← {t("Settings")}
      </Link>
      <h1 className="text-xl font-semibold">{t("Lookups")}</h1>
      <p className="text-sm text-zinc-500">{t("Search fields in your Workspace views: type, pick a suggestion, and its data becomes a row. Ask the Workspace chat for one, e.g. “a field to add films from TMDB”. What you type goes to the service you search.")}</p>
      {sp.ok && <p className="alert-ok">{sp.ok}</p>}
      {sp.error && <p role="alert" className="alert-error">{sp.error}</p>}
      <form action={saveLookupsAction} className="card space-y-3 p-4">
        <fieldset className="space-y-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="px-1 text-xs font-semibold uppercase text-zinc-500">TMDB</legend>
          <label className="block text-sm">
            {t("API key")}
            <input name="tmdbKey" type="password" autoComplete="off" className={`${field} mt-1`} placeholder={c.tmdbKey ? t("(set — leave empty to keep)") : ""} />
          </label>
          <p className="text-xs text-zinc-500">{t("Optional: without a key, films come from Wikidata and Wikipedia (no ratings, not every poster) and series from TVmaze. Free for personal, non-commercial use: an account at themoviedb.org, then Settings → API. The key or the read access token both work.")}</p>
          <p className="text-xs text-zinc-500">{TMDB_CREDIT}</p>
        </fieldset>
        <fieldset className="space-y-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="px-1 text-xs font-semibold uppercase text-zinc-500">Google</legend>
          <label className="block text-sm">
            {t("API key")}
            <input name="googleKey" type="password" autoComplete="off" className={`${field} mt-1`} placeholder={c.googleKey ? t("(set — leave empty to keep)") : ""} />
          </label>
          <p className="text-xs text-zinc-500">{t("For Google Books and the Knowledge Graph: a key from console.cloud.google.com with the Books API and the Knowledge Graph Search API switched on.")}</p>
        </fieldset>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary btn-sm">{t("Save")}</button>
          <button formAction={testTmdbAction} className="btn btn-sm" disabled={!c.tmdbKey}>
            {t("Try TMDB")}
          </button>
        </div>
      </form>
      <section className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold">{t("Sources")}</h2>
        <ul className="space-y-1 text-sm">
          {lookupSources().map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{s.label}</span>
              <code className="text-xs text-zinc-500">{s.id}</code>
              <span className="text-xs text-zinc-500">{s.missing?.() ?? t("Ready.")}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
