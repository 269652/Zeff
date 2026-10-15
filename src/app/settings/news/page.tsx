import { EmptyState } from "@/components/EmptyState";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { formatAgo } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { addSourceFormAction, forgetLearningFormAction, forgetTasteFormAction, saveTasteFormAction, updateTasteFormAction, removeSourceFormAction, savePrefsFormAction, updateSourceFormAction } from "@/plugins/news/server-actions";
import { CatalogBrowser } from "@/plugins/news/CatalogBrowser";
import { discoveries } from "@/plugins/news/auto-discover";
import { FeedFinder } from "@/plugins/news/FeedFinder";
import { formatInterests } from "@/plugins/news/shared";
import { profileTerms } from "@/plugins/news/profile";
import { getPrefs, listSources } from "@/plugins/news/store";
import { getTaste } from "@/plugins/news/taste";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("News settings") };
}

const field = "w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** Settings → News: the sources, what you are interested in and what you don't want, and how it personalises. */
export default async function NewsSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; lang?: string; q?: string }> }) {
  await connection();
  if (!isInstalled("news")) return <PluginNotInstalled id="news" />;
  const sp = await searchParams;
  const prefs = getPrefs();
  const sources = listSources();
  const profile = prefs.useProfile ? await profileTerms() : [];
  const taste = getTaste();
  const have = new Set(sources.map((s) => s.url));

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
        {sp.error && <p role="alert" className="alert-error text-sm">{sp.error}</p>}
        {sp.ok && <p role="status" className="alert-ok text-sm">{sp.ok}</p>}
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
            <div className="grid gap-3 sm:grid-cols-5">
              <label className="space-y-1">
                <span className="font-medium">{t("Feeds per round")}</span>
                <input type="number" name="perRun" min={10} max={1000} defaultValue={prefs.perRun} className={field} title={t("A round fetches this many feeds, the longest-unfetched first; the rest follow in the next rounds")} />
              </label>
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
              <input type="checkbox" name="autoDiscover" defaultChecked={prefs.autoDiscover} className="mt-1" />
              <span>
                {t("Find new feeds by itself")}
                <span className="block text-xs text-zinc-500">{t("Once a day Zeff searches the internet for feeds on two of your interests and adds the best few (category Discovered; you see what it added and can remove it). Interests and the AI's outlet names are sent out for the search.")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="images" defaultChecked={prefs.images} className="mt-1" />
              <span>
                {t("Show pictures")}
                <span className="block text-xs text-zinc-500">{t("Each item's picture is loaded by your browser from the news site it belongs to — that site sees you looked. Off: text only.")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="prefetch" defaultChecked={prefs.prefetch} className="mt-1" />
              <span>
                {t("Read ahead")}
                <span className="block text-xs text-zinc-500">{t("After each fetch Zeff reads the whole text of the best unread items from their pages, so they open here at once. Pages behind a paywall can't be read.")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="useProfile" defaultChecked={prefs.useProfile} className="mt-1" />
              <span>
                {t("Use what Zeff knows about me")}
                <span className="block text-xs text-zinc-500">{t("Your facts, open todos and tickets are matched against the headlines — a story about a hobby you noted, or the thing you work on, comes up without being an interest. Compared on this PC; nothing is sent.")}</span>
                {profile.length > 0 && <span className="mt-1 block text-xs text-zinc-400">{t("Right now: {terms}", { terms: profile.slice(0, 14).map((p) => p.term).join(", ") })}</span>}
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="diversity" defaultChecked={prefs.diversity} className="mt-1" />
              <span>
                {t("Mix it up")}
                <span className="block text-xs text-zinc-500">{t("No run of one source, the same story from several outlets only once near the top, and every seventh place from something unlike what came before — so the feed stays varied while it learns.")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="aiTags" defaultChecked={prefs.aiTags} className="mt-1" />
              <span>
                {t("AI tags and stories")}
                <span className="block text-xs text-zinc-500">{t("The AI tags the best unseen headlines — people, places, companies, topics, and the story each belongs to — so the chips, bubbles and threads are meaningful (needs the LLM plugin; headlines go to the AI you chose). Without it the built-in tagger does what it can.")}</span>
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
          {sources.length === 0 && <EmptyState>{t("No sources yet — add some from the catalog below, or just name your interests above.")}</EmptyState>}
          <details open={sources.length <= 12}>
            <summary className="cursor-pointer text-sm font-medium">{t("Your sources ({n}, {on} on)", { n: sources.length, on: sources.filter((x) => x.enabled).length })}</summary>
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
          </details>

          <form action={addSourceFormAction} className="grid gap-2 text-sm sm:grid-cols-[1fr_2fr_auto]">
            <input name="name" placeholder={t("Name (optional)")} className={field} />
            <input name="url" required placeholder="https://example.com/feed.xml" className={field} />
            <button className="btn btn-primary btn-sm">{t("Add source")}</button>
          </form>
          <p className="text-xs text-zinc-500">{t("Any RSS or Atom address works — most news sites, blogs, YouTube channels and subreddits (add .rss to the address) have one.")}</p>

        </section>

        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Find feeds")}</h2>
          <p className="text-xs text-zinc-500">{t("Zeff searches the internet for sources on a topic: who writes about it (from a news search), which outlets and blogs an AI knows — and checks each site's feeds. Nothing is added until you click.")}</p>
          <FeedFinder />
          {discoveries().length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-zinc-500 uppercase">{t("Found by itself")}</p>
              <ul className="space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                {discoveries().slice(0, 8).map((d) => (
                  <li key={d.url}>
                    <strong>{d.name}</strong> — {d.topic}: {d.why}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section id="taste" className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">✨ {t("Your taste")}</h2>
          <p className="text-xs text-zinc-500">
            {t("A written description of what you like to read. Zeff keeps it: every article you like (👍), save (🔖) or reject (👎) is fed to the AI with the description, which rewrites it. Discover uses it to look for new sources and to pick what matches from the unread news. You can edit it — the AI continues from your version.")}
          </p>
          <form action={saveTasteFormAction} className="space-y-2">
            <textarea name="taste" rows={6} defaultValue={taste.text} placeholder={t("Nothing written yet — like or save a few articles, then press Update.")} className={field} />
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-primary btn-sm">{t("Save my version")}</button>
              <span className="text-xs text-zinc-500">
                {taste.updatedAt ? t("Updated {ago}", { ago: formatAgo(taste.updatedAt) }) : t("not written yet")}
                {taste.pending.length > 0 && ` · ${t("{n} signals waiting to be taken in", { n: taste.pending.length })}`}
              </span>
            </div>
          </form>
          {(taste.likes.length > 0 || taste.avoids.length > 0) && (
            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              {taste.likes.length > 0 && <span>{t("Likes")}: {taste.likes.join(", ")}. </span>}
              {taste.avoids.length > 0 && <span>{t("Avoids")}: {taste.avoids.join(", ")}.</span>}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <form action={updateTasteFormAction}>
              <button className="btn btn-sm" title={t("Takes in the likes and saves not yet in the description (and the ones from before this existed)")}>
                {t("Update from my likes now")}
              </button>
            </form>
            <form action={forgetTasteFormAction}>
              <button className="btn btn-sm">{t("Forget the description")}</button>
            </form>
          </div>
        </section>

        <CatalogBrowser have={have} lang={sp.lang ?? ""} q={sp.q ?? ""} />

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
