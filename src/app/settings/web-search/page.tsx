import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { saveWebSearchAction, testWebSearchAction } from "@/plugins/web-search/server-actions";
import { getSearchConfig, searchReady } from "@/plugins/web-search/search";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Web search") };
}

const field = "w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** Settings → Web search: the API behind web_search (Google Programmable Search, or Brave) and its key. */
export default async function WebSearchSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await connection();
  if (!isInstalled("web-search")) return <PluginNotInstalled id="web-search" />;
  const sp = await searchParams;
  const c = getSearchConfig();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
        ← {t("Settings")}
      </Link>
      <h1 className="text-xl font-semibold">{t("Web search")}</h1>
      <p className="text-sm text-zinc-500">{t("Zeff's AI — the Workspace chat and agents over MCP — can search the web and read public pages (web_search, web_fetch). The search uses an official API; nothing is scraped, and pages are only read from the public internet.")}</p>
      {sp.ok && <p className="alert-ok">{sp.ok}</p>}
      {sp.error && <p role="alert" className="alert-error">{sp.error}</p>}
      <form action={saveWebSearchAction} className="card space-y-3 p-4">
        <label className="block text-sm">
          <span className="font-medium">{t("Search with")}</span>
          <select name="provider" defaultValue={c.provider} className={`${field} mt-1`}>
            <option value="google">Google Programmable Search</option>
            <option value="brave">Brave Search</option>
          </select>
        </label>
        <fieldset className="space-y-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="px-1 text-xs font-semibold uppercase text-zinc-500">Google</legend>
          <label className="block text-sm">
            {t("API key")}
            <input name="googleKey" type="password" autoComplete="off" className={`${field} mt-1`} placeholder={c.googleKey ? t("(set — leave empty to keep)") : ""} />
          </label>
          <label className="block text-sm">
            {t("Search engine ID (cx)")}
            <input name="googleCx" defaultValue={c.googleCx} className={`${field} mt-1`} />
          </label>
          <p className="text-xs text-zinc-500">{t("Made once in Google: a Programmable Search Engine that searches the whole web (programmablesearchengine.google.com), and an API key with the Custom Search API switched on (console.cloud.google.com). 100 searches a day are free.")}</p>
        </fieldset>
        <fieldset className="space-y-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="px-1 text-xs font-semibold uppercase text-zinc-500">Brave</legend>
          <label className="block text-sm">
            {t("API key")}
            <input name="braveKey" type="password" autoComplete="off" className={`${field} mt-1`} placeholder={c.braveKey ? t("(set — leave empty to keep)") : ""} />
          </label>
        </fieldset>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary btn-sm">{t("Save")}</button>
          <button formAction={testWebSearchAction} className="btn btn-sm" disabled={!searchReady(c)}>
            {t("Try a search")}
          </button>
          <span className="text-xs text-zinc-500">{searchReady(c) ? t("Ready.") : t("Not set up yet.")}</span>
        </div>
      </form>
    </div>
  );
}
