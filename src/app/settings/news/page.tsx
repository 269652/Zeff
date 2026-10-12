import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { formatAgo } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { addPresetFormAction, addSourceFormAction, forgetLearningFormAction, removeSourceFormAction, savePrefsFormAction, updateSourceFormAction } from "@/plugins/news/server-actions";
import { formatInterests, PRESETS } from "@/plugins/news/shared";
import { getPrefs, listSources } from "@/plugins/news/store";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("News settings") };
}

const field = "w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** Settings → News: the sources, what you are interested in and what you don't want, and how it personalises. */
export default async function NewsSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await connection();
  if (!isInstalled("news")) return <PluginNotInstalled id="news" />;
  const sp = await searchParams;
  const prefs = getPrefs();
  const sources = listSources();
  const have = new Set(sources.map((s) => s.url));
  const presets = PRESETS.filter((p) => !have.has(p.url));

  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("Settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("News settings")}</h1>
        <p className="text-sm text-zinc-500">{t("Where your news comes from and what makes it yours. Everything is fetched from public feeds; nothing of yours is sent.")}</p>
        <Link href="/news" className="btn btn-sm w-full text-center">
          {t("To the news")}
        </Link>
        {sp.error && <p className="alert-error text-sm">{sp.error}</p>}
        {sp.ok && <p className="alert-ok text-sm">{sp.ok}</p>}
      </div>

      <div className="space-y-4">
        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("What suits you")}</h2>
          <form action={savePrefsFormAction} className="space-y-3 text-sm">
            <label className="block space-y-1">
              <span className="font-medium">{t("Interests")}</span>
              <textarea name="interests" rows={5} defaultValue={formatInterests(prefs.interests)} className={field} placeholder={"TypeScript x2\nFormel 1\nKlimaschutz"} />
              <span className="block text-xs text-zinc-500">{t("One per line. A trailing x2 or x3 means it counts double or triple. Zeff also searches for each one.")}</span>
            </label>
            <label className="block space-y-1">
              <span className="font-medium">{t("Not interested in")}</span>
              <textarea name="mutes" rows={2} defaultValue={prefs.mutes.join("\n")} className={field} placeholder={"Horoskop\nPromi"} />
              <span className="block text-xs text-zinc-500">{t("Items with one of these words are left out.")}</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="space-y-1">
                <span className="font-medium">{t("Language of the searches")}</span>
                <select name="language" defaultValue={prefs.language} className={field}>
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                  <option value="any">{t("Both")}</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-medium">{t("Show the last … days")}</span>
                <input type="number" name="maxAgeDays" min={1} max={30} defaultValue={prefs.maxAgeDays} className={field} />
              </label>
              <label className="space-y-1">
                <span className="font-medium">{t("Items per source")}</span>
                <input type="number" name="perSource" min={5} max={100} defaultValue={prefs.perSource} className={field} />
              </label>
              <label className="space-y-1">
                <span className="font-medium">{t("Keep for … days")}</span>
                <input type="number" name="keepDays" min={3} max={365} defaultValue={prefs.keepDays} className={field} />
              </label>
            </div>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="topicSearch" defaultChecked={prefs.topicSearch} className="mt-1" />
              <span>
                {t("Search for each interest")}
                <span className="block text-xs text-zinc-500">{t("One Google News search per interest (the eight that count most) besides your sources.")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="useWork" defaultChecked={prefs.useWork} className="mt-1" />
              <span>
                {t("Use my work")}
                <span className="block text-xs text-zinc-500">{t("News about what your open todos are about comes first. Only words are compared on this PC; nothing leaves it.")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="digest" defaultChecked={prefs.digest} className="mt-1" />
              <span>
                {t("AI overview")}
                <span className="block text-xs text-zinc-500">{t("After each fetch the AI sums up the best unread items and says why they fit you (needs the LLM plugin; headlines and your interests are sent to the AI you chose).")}</span>
              </span>
            </label>
            <button className="btn btn-primary btn-sm">{t("Save")}</button>
          </form>
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Sources")}</h2>
          {sources.length === 0 && <p className="text-sm text-zinc-500">{t("No sources yet — add some below, or just name your interests above.")}</p>}
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2 text-sm">
                <div className="min-w-0 flex-1 basis-60">
                  <div className={`font-medium ${s.enabled ? "" : "text-zinc-400 line-through"}`}>{s.name}</div>
                  <div className="truncate text-xs text-zinc-400" title={s.url}>
                    {s.url}
                  </div>
                  <div className={`text-xs ${s.lastError ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
                    {s.lastError ? s.lastError : s.lastAt ? t("{n} items · fetched {ago}", { n: s.itemCount, ago: formatAgo(s.lastAt) }) : t("not fetched yet")}
                    {s.votes !== 0 && ` · ${s.votes > 0 ? "+" : ""}${s.votes} ${t("from your votes")}`}
                  </div>
                </div>
                <form action={updateSourceFormAction} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={s.id} />
                  <label className="flex items-center gap-1 text-xs text-zinc-500" title={t("How much you trust it: its good items count more or less")}>
                    {t("Trust")}
                    <select name="weight" defaultValue={String(s.weight)} className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                      <option value="0.5">{t("low")}</option>
                      <option value="1">{t("normal")}</option>
                      <option value="1.5">{t("high")}</option>
                      <option value="2">{t("first")}</option>
                    </select>
                  </label>
                  <button className="btn btn-sm">{t("Set")}</button>
                </form>
                <form action={updateSourceFormAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="toggle" value={s.enabled ? "off" : "on"} />
                  <button className="btn btn-sm">{s.enabled ? t("Pause") : t("Resume")}</button>
                </form>
                <form action={removeSourceFormAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="btn btn-sm" title={t("Removes the source and its items (saved ones stay)")}>
                    {t("Remove")}
                  </button>
                </form>
              </li>
            ))}
          </ul>

          <form action={addSourceFormAction} className="grid gap-2 text-sm sm:grid-cols-[1fr_2fr_auto]">
            <input name="name" placeholder={t("Name (optional)")} className={field} />
            <input name="url" required placeholder="https://example.com/feed.xml" className={field} />
            <button className="btn btn-primary btn-sm">{t("Add source")}</button>
          </form>
          <p className="text-xs text-zinc-500">{t("Any RSS or Atom address works — most news sites, blogs, YouTube channels and subreddits (add .rss to the address) have one.")}</p>

          {presets.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-zinc-500 uppercase">{t("Suggestions")}</p>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <form key={p.url} action={addPresetFormAction}>
                    <input type="hidden" name="url" value={p.url} />
                    <button className="btn btn-sm" title={`${p.about} · ${p.lang.toUpperCase()}`}>
                      + {p.name}
                    </button>
                  </form>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="card space-y-2 p-4 text-sm">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("How it learns")}</h2>
          <p className="text-zinc-600 dark:text-zinc-300">
            {t("Every 👍 and 👎 teaches Zeff the words of that headline and how much you like its source; the order follows at once. It is kept on this PC only.")}
          </p>
          <form action={forgetLearningFormAction}>
            <button className="btn btn-sm">{t("Forget what it learned")}</button>
          </form>
        </section>
      </div>
    </div>
  );
}
