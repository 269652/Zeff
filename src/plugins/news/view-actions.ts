"use server";

import { formatAgo } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { NewsItem } from "./shared";
import type { NewsView } from "./store";

const VIEWS: NewsView[] = ["foryou", "discover", "latest", "saved", "filtered", "hidden"];

/**
 * What News' app view in the Workspace shows (view-template.meta.ts): the views with their counts, the categories, the funnel, the stories,
 * your taste, the overview, the first page of the feed — the same as News' own page had, for the view, source and category asked.
 */
export async function newsScreenAction(ask: { view?: string; source?: string; category?: string }) {
  const store = await import("./store");
  const { NEWS_PAGE } = await import("./shared");
  const view = (VIEWS as string[]).includes(ask.view ?? "") ? (ask.view as NewsView) : "foryou";
  const sourceId = Number(ask.source) || undefined;
  const category = ask.category ?? "";
  const prefs = store.getPrefs();
  const sources = store.listSources();
  const items = store.listItems({ view, sourceId, category: category || undefined, maxAgeDays: prefs.maxAgeDays, limit: NEWS_PAGE });
  const c = store.counts();
  const labels: Record<NewsView, string> = { foryou: t("For you"), discover: `✨ ${t("Discover")}`, latest: prefs.funnel ? t("Everything (unfiltered)") : t("Latest"), saved: t("Saved"), filtered: t("Filtered out"), hidden: t("Hidden") };
  const count: Record<NewsView, number | null> = { foryou: c.unread, discover: c.discover, latest: null, saved: c.saved, filtered: c.filtered, hidden: c.hidden };
  const views = VIEWS.filter((v) => v !== "filtered" || prefs.funnel || c.filtered > 0).map((v) => ({ id: v, label: labels[v], n: count[v] ?? 0, on: v === view && !sourceId && !category }));
  // The enabled sources by category (a few hundred sources are too many to list one by one).
  const byCategory = new Map<string, number>();
  for (const s of sources.filter((x) => x.enabled)) byCategory.set(s.category || "Your own", (byCategory.get(s.category || "Your own") ?? 0) + 1);
  const categories = [...byCategory].map(([name, n]) => ({ name, value: name === "Your own" ? "" : name, n, on: name === category }));
  const top = view === "foryou" && !sourceId && !category;
  const llm = isInstalled("llm");
  const funnel = top ? funnelOf(store, !!prefs.funnel, llm) : null;
  // The stories on top of For you: what is important and the stories running through what is for you.
  const stories = top ? (await import("./story-groups")).storyGroups(store.listItems({ view: "foryou", limit: 150, maxAgeDays: Math.min(prefs.maxAgeDays, 3) })) : [];
  const storyAgo = Object.fromEntries(stories.flatMap((g) => g.items).map((i) => [i.id, formatAgo(i.publishedAt)]));
  const taste = view === "discover" ? (await import("./taste")).getTaste() : null;
  // The overview (digest): its themes with their sources numbered, its picks with why.
  const digest = view === "foryou" && !sourceId ? (await import("./digest")).getDigest() : null;
  const byId = new Map<number, NewsItem>();
  for (const id of [...(digest?.picks ?? []).map((p) => p.id), ...(digest?.themes ?? []).flatMap((th) => th.ids)]) {
    const it = store.getItem(id);
    if (it) byId.set(id, it);
  }
  const overview = digest
    ? {
        ago: formatAgo(digest.at),
        text: digest.overview,
        themes: digest.themes.map((th) => ({ title: th.title, summary: th.summary, links: th.ids.flatMap((id, k) => { const it = byId.get(id); return it ? [{ n: k + 1, url: it.url, label: it.sourceName, tip: `${it.sourceName}: ${it.title}` }] : []; }) })),
        picks: digest.picks.flatMap((p) => { const it = byId.get(p.id); return it ? [{ url: it.url, title: it.title, why: p.why }] : []; }),
        spoken: [digest.overview, ...digest.themes.map((th) => `${th.title}. ${th.summary}`), ...digest.picks.flatMap((p) => { const it = byId.get(p.id); return it ? [`${it.title}. ${p.why}`] : []; })].join("\n\n"),
      }
    : null;
  // Nothing in the feed: which empty state, and what it says.
  const empty = items.length > 0 || view === "discover" ? "" : sources.length === 0 && prefs.interests.length === 0 ? "starter" : view === "foryou" && prefs.funnel ? "funnel" : view === "foryou" || view === "latest" ? "old" : "none";
  const emptyText = {
    "": "",
    starter: t("Nothing here yet. Pick some sources and say what interests you under"),
    funnel: c.waiting > 0 ? t("The agent hasn't let anything through yet — {n} headlines are waiting for it.", { n: c.waiting }) : t("Nothing new for you right now — the agent looks again after the next fetch."),
    old: t("No news in the last {n} days — click Refresh.", { n: prefs.maxAgeDays }),
    none: t("Nothing here."),
  }[empty];
  return {
    view,
    source: sourceId ?? 0,
    category,
    views,
    categories,
    filtered: !!(category || sourceId),
    funnel,
    stories,
    storyAgo,
    taste: taste ? { text: taste.text, none: t("Nothing written yet — like or save a few articles, then press Discover."), by: t("Written by Zeff from what you like and save."), edit: t("Read and edit it"), pending: taste.pending.length ? ` · ${t("{n} signals waiting to be taken in", { n: taste.pending.length })}` : "" } : null,
    overview,
    lang: prefs.language === "en" ? "en" : "de",
    llm: isInstalled("llm"),
    images: !!prefs.images,
    digestOn: !!prefs.digest,
    items,
    ago: Object.fromEntries(items.map((i) => [i.id, formatAgo(i.publishedAt)])),
    done: items.length < NEWS_PAGE,
    empty,
    emptyText,
    waiting: c.waiting,
    maxAgeDays: prefs.maxAgeDays,
  };
}

type Part = { text: string; tip: string; kind: "head" | "sep" | "good" | "warn" | "plain" | "br" | "link" };
const P = (kind: Part["kind"], text = "", tip = ""): Part => ({ kind, text, tip });

/**
 * The funnel strip on For you, in the words News' page said it: what came in today, what the agent read and cleared, what is kept now — a part
 * each (a head, a separator, a figure with its tip; "br" breaks the line).
 */
function funnelOf(store: typeof import("./store"), on: boolean, llm: boolean) {
  const stats = store.funnelStats();
  const now = store.funnelNow();
  const keptTip = t("Only the newest and the best are kept, besides what you saved or liked");
  const today = [P("head", t("Today")), P("plain", `📥 ${t("{n} in", { n: store.cameInToday() ?? stats.fetched })}`, t("Headlines fetched from your sources today"))];
  const kept = P("plain", `🧹 ${t("{n} kept", { n: now.kept })}`, keptTip);
  const parts: Part[] = on
    ? [
        ...today,
        P("sep", "·"),
        P("plain", `🔎 ${t("{n} read by the agent", { n: stats.judged })}`, t("The best by score that the agent read")),
        P("sep", "·"),
        P("plain", `🧹 ${t("{n} cleared away", { n: stats.cleared })}`, t("Removed by the clearing, read or not: only the newest and the best are kept, besides what you saved or liked")),
        P("br"),
        P("head", t("Now")),
        kept,
        P("sep", "="),
        P("good", `✓ ${t("{n} for you", { n: now.forYou })}`, t("Let through to For you")),
        ...(now.important > 0 ? [P("warn", t("({n} important)", { n: now.important }))] : []),
        P("sep", "+"),
        P("plain", t("{n} waiting for the agent", { n: now.waiting })),
        P("sep", "+"),
        P("link", `⊘ ${t("{n} filtered out", { n: now.filtered })}`),
        P("sep", "+"),
        P("plain", t("{n} seen", { n: now.rest }), t("What you have seen already, or what the agent didn't read before you saw it")),
      ]
    : [...today, P("sep", "→"), P("plain", t("scored for you")), P("sep", "·"), kept];
  return { on, parts, agent: t("Filter with an agent …"), agentTip: llm ? t("An agent reads the news first and lets only what interests you through") : t("Needs the LLM plugin (Menu → Plugins).") };
}

export type NewsScreen = Awaited<ReturnType<typeof newsScreenAction>>;
